#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 The Làng Nghề Số contributors
# Tạo route APISIX được bảo vệ bằng JWT của Keycloak (plugin openid-connect, bearer_only).
# Dùng: bash scripts/setup-apisix-routes.sh   (chạy sau khi `docker compose up -d`)
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
IOT_BUCKET="${IOT_BUCKET:-dxos-iot}"
DOCS_BUCKET="${DOCS_BUCKET:-dxos-docs}"
ANCHOR_BUCKET="${ANCHOR_BUCKET:-dxos-audit}"
IOT_LOCK_MODE="${IOT_LOCK_MODE:-GOVERNANCE}"
IOT_RETENTION_DAYS="${IOT_RETENTION_DAYS:-1825}"
case "$IOT_LOCK_MODE" in GOVERNANCE|COMPLIANCE) ;; *) echo "IOT_LOCK_MODE phải là GOVERNANCE hoặc COMPLIANCE"; exit 1 ;; esac
if [ "$IOT_LOCK_MODE" = COMPLIANCE ] && [ "${IOT_LOCK_CONFIRM_COMPLIANCE:-}" != yes ]; then
  echo "IOT_LOCK_MODE=COMPLIANCE KHÔNG HOÀN TÁC: mọi tệp IoT ghi sau đó bị khóa $IOT_RETENTION_DAYS ngày, đến cả root cũng không xóa/sửa được"
  echo "(kể cả tệp thử nghiệm). Chỉ dùng khi triển khai thật. Nếu đã chắc chắn, thêm IOT_LOCK_CONFIRM_COMPLIANCE=yes vào .env rồi chạy lại."
  exit 1
fi
[[ "$IOT_RETENTION_DAYS" =~ ^[0-9]+$ ]] && [ "$IOT_RETENTION_DAYS" -ge 1 ] || { echo "IOT_RETENTION_DAYS phải là số ngày nguyên dương"; exit 1; }

export MSYS_NO_PATHCONV=1 # Git Bash trên Windows: không đổi đường dẫn khi gọi docker cp/exec

# Lua kiểm tra vai trò ở cổng gác và policy MinIO của các vai trò nghiệp vụ được SINH từ config/access.json (nguồn duy nhất).
ACCESS_ORIGIN="${FRONTEND_ORIGIN:-http://localhost:3000}"
LUA_TRACE=$(node scripts/gen-access.js lua trace "$ACCESS_ORIGIN")
LUA_WORKFLOW=$(node scripts/gen-access.js lua workflow "$ACCESS_ORIGIN")
[ -n "$LUA_TRACE" ] && [ -n "$LUA_WORKFLOW" ] || { echo "Không sinh được Lua từ config/access.json (cần Node.js trên máy chủ)"; exit 1; }

ADMIN="http://localhost:${APISIX_ADMIN_PORT}/apisix/admin"
FLOWABLE_BASIC=$(printf '%s:%s' "$FLOWABLE_ADMIN_USER" "$FLOWABLE_ADMIN_PASSWORD" | base64 | tr -d '\n')

# Nhật ký kiểm toán: plugin http-logger gửi từng lô yêu cầu về trace-api (/internal/audit) qua mạng nội bộ, kèm khóa AUDIT_INGEST_KEY.
# KHÔNG ghi tiêu đề Authorization (route workflow còn bị proxy-rewrite thay bằng Basic admin của Flowable: ghi vào nhật ký là lộ mật khẩu).
# Danh tính lấy từ tiêu đề X-Audit-User/X-Audit-Roles do Lua của hai route trace/workflow gắn (xem scripts/gen-access.js).
# Lưu ý: trong chuỗi bên dưới các biến $time_iso8601... là biến NGINX, phải giữ nguyên ký tự $ (nên dùng nháy đơn).
AUDIT_LOGGER='"http-logger": { "uri": "http://trace-api:3000/internal/audit", "auth_header": "Bearer '"$AUDIT_INGEST_KEY"'", "batch_max_size": 20, "inactive_timeout": 2, "buffer_duration": 5, "max_retry_count": 3, "retry_delay": 1, "timeout": 3, "include_req_body": false, "include_resp_body": false, "log_format": { "time": "$time_iso8601", "client_ip": "$remote_addr", "method": "$request_method", "uri": "$request_uri", "status": "$status", "route": "$route_name", "request_time": "$request_time", "audit_user": "$http_x_audit_user", "audit_roles": "$http_x_audit_roles" } }'

# Route workflow còn chặn thêm: tuyến quản trị của Flowable (identity, management) với mọi người, và mọi phương thức thay đổi
# (POST/PUT/DELETE) với người không có role editor. Lý do: cổng gác gắn tài khoản admin của Flowable cho mọi yêu cầu, nên nếu không
# chặn thì cả người chỉ-xem (readonly) cũng gọi được Flowable với quyền admin (đã kiểm chứng trước khi sửa).
# Hai route bắt buộc JWT còn có plugin serverless-pre-function chỉ cho qua token có vai trò editor hoặc readonly
# (claim "policy"): token của thiết bị IoT (iot-writer) chỉ dùng để ghi dữ liệu cảm biến, không gọi được các API này.
# Route /api/workflow/* -> Flowable REST (Flowable chỉ nhận qua gateway, gateway tự gắn basic auth nội bộ)
curl -fsS -X PUT "$ADMIN/routes/workflow" -H "X-API-KEY: $APISIX_ADMIN_KEY" -d @- <<JSON
{
  "name": "workflow-api",
  "uri": "/api/workflow/*",
  "plugins": {
    ${AUDIT_LOGGER},
    "serverless-pre-function": { "phase": "rewrite", "functions": ["${LUA_WORKFLOW}"] },
    "cors": {
      "allow_origins": "${FRONTEND_ORIGIN:-http://localhost:3000}",
      "allow_methods": "GET,POST,PUT,DELETE,OPTIONS",
      "allow_headers": "Authorization,Content-Type",
      "max_age": 3600
    },
    "openid-connect": {
      "discovery": "http://keycloak:8080/realms/${KEYCLOAK_REALM}/.well-known/openid-configuration",
      "client_id": "${KEYCLOAK_CLIENT_ID}",
      "client_secret": "${KEYCLOAK_CLIENT_SECRET}",
      "bearer_only": true,
      "use_jwks": true,
      "ssl_verify": false
    },
    "proxy-rewrite": {
      "regex_uri": ["^/api/workflow/(.*)", "/flowable-rest/service/\$1"],
      "headers": { "set": { "Authorization": "Basic ${FLOWABLE_BASIC}" } }
    }
  },
  "upstream": { "type": "roundrobin", "nodes": { "flowable:8080": 1 } }
}
JSON
echo
echo "OK: route /api/workflow/* đã được bảo vệ bằng JWT Keycloak (realm ${KEYCLOAK_REALM})."

# Route NỘI BỘ trace-api -> Flowable (chỉ khớp ở cổng 9081, không publish ra máy chủ). Flowable REST không phân quyền mịn nên việc giới hạn
# làm ở đây bằng danh sách cho phép (apisix/flowable-internal.lua): chỉ bắt đầu quy trình hồ sơ OCOP, xem việc của một tiến trình, hoàn thành việc.
# Cổng gác gắn Basic auth của Flowable; trace-api chỉ giữ FLOWABLE_PROXY_KEY.
[ -n "${FLOWABLE_PROXY_KEY:-}" ] || { echo "Thiếu FLOWABLE_PROXY_KEY trong .env (chạy bash scripts/upgrade.sh để bổ sung khóa còn thiếu)"; exit 1; }
FLOWABLE_ROUTE=$(FLOWABLE_PROXY_KEY="$FLOWABLE_PROXY_KEY" FLOWABLE_BASIC="$FLOWABLE_BASIC" node scripts/gen-flowable-route.js) || { echo "Không sinh được route nội bộ Flowable"; exit 1; }
curl -fsS -X PUT "$ADMIN/routes/flowable-internal" -H "X-API-KEY: $APISIX_ADMIN_KEY" -d "$FLOWABLE_ROUTE" >/dev/null
echo "OK: route nội bộ Flowable (cổng 9081, danh sách cho phép: bắt đầu quy trình OCOP, xem/hoàn thành việc)."

# ---- MinIO: bucket riêng tư + S3/STS trên host s3.localhost (xác thực JWT bằng MinIO OIDC) ----
# Route S3 chặn mọi yêu cầu đổi khóa dữ liệu (?retention, ?legal-hold, ?object-lock, tiêu đề bypass-governance-retention): bản MinIO này
# cho BẤT KỲ tài khoản STS nào (kể cả chỉ đọc) gỡ hạn khóa Governance khi gửi PutObjectRetention rỗng kèm tiêu đề bypass, bất chấp policy
# (đã kiểm chứng). Việc đổi khóa chỉ làm bằng quản trị viên (mc trong container MinIO), không qua cổng gác.
# Client lấy JWT từ Keycloak -> gọi STS AssumeRoleWithWebIdentity (MinIO tự xác thực JWT, claim "policy"
# ánh xạ sang policy MinIO) -> dùng thông tin tạm thời ký SigV4 gọi S3. Gateway giữ nguyên Host và
# đường dẫn để chữ ký hợp lệ. Cổng API của MinIO không publish ra host nên chỉ vào được qua APISIX.
docker exec dxos-minio sh -c "mc alias set local http://localhost:9000 '$MINIO_ROOT_USER' '$MINIO_ROOT_PASSWORD' >/dev/null \
  && mc mb --ignore-existing local/$MINIO_BUCKET \
  && mc anonymous set none local/$MINIO_BUCKET"

# ---- Bucket IoT có Object Lock (WORM: ghi một lần, không sửa/xóa trong thời hạn giữ) ----
# Object Lock chỉ bật được LÚC TẠO bucket (không bật được cho bucket đã có), và kéo theo bật versioning:
#  - mỗi tệp cảm biến ghi vào được tự động khóa $IOT_RETENTION_DAYS ngày theo chế độ $IOT_LOCK_MODE;
#  - ghi đè cùng tên chỉ tạo phiên bản mới, phiên bản cũ vẫn còn và vẫn bị khóa; xóa thường chỉ tạo "dấu xóa";
#  - GOVERNANCE: người thường không phá được, root vẫn gỡ được bằng đặc quyền bypass (dùng để thử/dọn dẹp);
#    COMPLIANCE: kể cả root cũng không phá được cho đến khi hết hạn, KHÔNG hoàn tác (dùng khi triển khai thật).
# Đổi chế độ/số ngày chỉ áp dụng cho tệp ghi SAU đó, tệp đã khóa giữ nguyên hạn cũ.
docker exec dxos-minio sh -c "mc alias set local http://localhost:9000 '$MINIO_ROOT_USER' '$MINIO_ROOT_PASSWORD' >/dev/null \
  && mc mb --ignore-existing --with-lock local/$IOT_BUCKET \
  && mc anonymous set none local/$IOT_BUCKET \
  && mc retention set --default $IOT_LOCK_MODE ${IOT_RETENTION_DAYS}d local/$IOT_BUCKET >/dev/null"
echo "OK: bucket IoT '$IOT_BUCKET' có Object Lock ($IOT_LOCK_MODE, giữ $IOT_RETENTION_DAYS ngày)."

# Tài khoản MinIO CHỈ ĐỌC cho trace-api: tự đối chiếu số liệu cảm biến khi gắn bằng chứng IoT vào công đoạn nung.
# Chỉ được đọc/liệt kê (kể cả các phiên bản, để phát hiện ghi đè/xóa) trên tiền tố iot/ của bucket IoT; không ghi, không xóa.
docker exec dxos-minio sh -c "mc alias set local http://localhost:9000 '$MINIO_ROOT_USER' '$MINIO_ROOT_PASSWORD' >/dev/null \
  && cat > /tmp/trace-iot-read.json <<'POLICY'
{
  \"Version\": \"2012-10-17\",
  \"Statement\": [
    { \"Effect\": \"Allow\", \"Action\": [\"s3:GetObject\", \"s3:GetObjectVersion\"], \"Resource\": [\"arn:aws:s3:::$IOT_BUCKET/iot/*\"] },
    { \"Effect\": \"Allow\", \"Action\": [\"s3:ListBucket\", \"s3:ListBucketVersions\"], \"Resource\": [\"arn:aws:s3:::$IOT_BUCKET\"], \"Condition\": { \"StringLike\": { \"s3:prefix\": [\"iot/*\"] } } }
  ]
}
POLICY
  mc admin policy create local trace-iot-read /tmp/trace-iot-read.json >/dev/null \
  && (mc admin user add local '$TRACE_S3_USER' '$TRACE_S3_PASSWORD' >/dev/null) \
  && (mc admin policy attach local trace-iot-read --user '$TRACE_S3_USER' >/dev/null 2>&1 || true)"
echo "OK: tài khoản chỉ đọc '$TRACE_S3_USER' cho trace-api (chỉ đọc tiền tố iot/ của bucket $IOT_BUCKET, gồm cả các phiên bản)."

# ---- Bucket tệp đính kèm hồ sơ OCOP + tài khoản riêng cho trace-api ----
# trace-api nhận tệp từ người dùng (đã kiểm quyền, loại, cỡ, băm) rồi ghi vào bucket này bằng tài khoản '$TRACE_DOCS_USER' chỉ có
# quyền ghi/đọc/liệt kê trên applications/ (tệp đính kèm), archive/ (kho lạnh vòng đời dữ liệu) và lake/ (hồ dữ liệu phân tích, Parquet) của bucket tệp (KHÔNG xóa: gỡ tệp chỉ đánh dấu trong CSDL, đối tượng giữ làm bằng chứng).
# Người dùng cuối không chạm được bucket này: policy vai trò Deny, và route S3 ở cổng gác chặn đường dẫn /$DOCS_BUCKET.
docker exec dxos-minio sh -c "mc alias set local http://localhost:9000 '$MINIO_ROOT_USER' '$MINIO_ROOT_PASSWORD' >/dev/null \
  && mc mb --ignore-existing local/$DOCS_BUCKET \
  && mc anonymous set none local/$DOCS_BUCKET \
  && cat > /tmp/trace-docs-rw.json <<'POLICY'
{
  \"Version\": \"2012-10-17\",
  \"Statement\": [
    { \"Effect\": \"Allow\", \"Action\": [\"s3:GetObject\", \"s3:PutObject\"], \"Resource\": [\"arn:aws:s3:::$DOCS_BUCKET/applications/*\", \"arn:aws:s3:::$DOCS_BUCKET/archive/*\", \"arn:aws:s3:::$DOCS_BUCKET/lake/*\"] },
    { \"Effect\": \"Allow\", \"Action\": [\"s3:ListBucket\"], \"Resource\": [\"arn:aws:s3:::$DOCS_BUCKET\"], \"Condition\": { \"StringLike\": { \"s3:prefix\": [\"applications/*\", \"archive/*\", \"lake/*\"] } } }
  ]
}
POLICY
  mc admin policy create local trace-docs-rw /tmp/trace-docs-rw.json >/dev/null \
  && (mc admin user add local '$TRACE_DOCS_USER' '$TRACE_DOCS_PASSWORD' >/dev/null) \
  && (mc admin policy attach local trace-docs-rw --user '$TRACE_DOCS_USER' >/dev/null 2>&1 || true)"
echo "OK: bucket tệp '$DOCS_BUCKET' và tài khoản '$TRACE_DOCS_USER' cho trace-api (ghi/đọc applications/, không xóa)."

# ---- Bucket bản neo nhật ký kiểm toán (Object Lock) + tài khoản riêng cho trace-api ----
# trace-api định kỳ ghi băm đầu chuỗi nhật ký vào anchors/ của bucket này; bucket có Object Lock nên bản neo đã ghi không sửa/xóa được
# trong thời hạn giữ, nhờ vậy việc cắt dòng cuối hay tính lại chuỗi nhật ký trong CSDL đều bị phát hiện. Tài khoản '$ANCHOR_S3_USER' chỉ
# ghi/đọc/liệt kê anchors/ (KHÔNG xóa). Người dùng cuối không chạm được: policy vai trò Deny và route S3 ở cổng gác chặn /$ANCHOR_BUCKET.
docker exec dxos-minio sh -c "mc alias set local http://localhost:9000 '$MINIO_ROOT_USER' '$MINIO_ROOT_PASSWORD' >/dev/null \
  && mc mb --ignore-existing --with-lock local/$ANCHOR_BUCKET \
  && mc anonymous set none local/$ANCHOR_BUCKET \
  && mc retention set --default $IOT_LOCK_MODE ${IOT_RETENTION_DAYS}d local/$ANCHOR_BUCKET >/dev/null \
  && cat > /tmp/trace-anchor-rw.json <<'POLICY'
{
  \"Version\": \"2012-10-17\",
  \"Statement\": [
    { \"Effect\": \"Allow\", \"Action\": [\"s3:GetObject\", \"s3:PutObject\"], \"Resource\": [\"arn:aws:s3:::$ANCHOR_BUCKET/anchors/*\"] },
    { \"Effect\": \"Allow\", \"Action\": [\"s3:ListBucket\"], \"Resource\": [\"arn:aws:s3:::$ANCHOR_BUCKET\"], \"Condition\": { \"StringLike\": { \"s3:prefix\": [\"anchors/*\", \"anchors/\"] } } }
  ]
}
POLICY
  mc admin policy create local trace-anchor-rw /tmp/trace-anchor-rw.json >/dev/null \
  && (mc admin user add local '$ANCHOR_S3_USER' '$ANCHOR_S3_PASSWORD' >/dev/null) \
  && (mc admin policy attach local trace-anchor-rw --user '$ANCHOR_S3_USER' >/dev/null 2>&1 || true)"
echo "OK: bucket bản neo '$ANCHOR_BUCKET' (Object Lock $IOT_LOCK_MODE, giữ $IOT_RETENTION_DAYS ngày) và tài khoản '$ANCHOR_S3_USER' cho trace-api (ghi/đọc anchors/, không xóa)."

# Policy MinIO cho các vai trò Keycloak (claim "policy" = tên role = tên policy), tách quyền ghi dữ liệu IoT:
#   admin, editor (bí danh tạm), producer, coop-officer, ocop-officer: SINH từ config/access.json (xem bên dưới)
#   iot-writer  chỉ PutObject vào THƯ MỤC RIÊNG của gateway: iot/${jwt:preferred_username}/* (= service-account-<client>),
#               nên một gateway bị lộ khóa không ghi đè/giả số liệu của gateway khác; không đọc, không liệt kê
#   readonly    GHI ĐÈ policy dựng sẵn của MinIO (MinIO cho phép, đã kiểm chứng): giữ nguyên quyền dựng sẵn (đọc đối tượng ở mọi bucket,
#               cấm admin:CreateUser) và thêm Deny s3:* trên bucket tệp hồ sơ và bucket bản neo, để người chỉ-xem đi thẳng vào console
#               MinIO cũng không đọc được hai bucket nội bộ. Volume mới tạo lại policy dựng sẵn nên bước này chạy mỗi lần thiết lập.
docker exec dxos-minio sh -c "mc alias set local http://localhost:9000 '$MINIO_ROOT_USER' '$MINIO_ROOT_PASSWORD' >/dev/null \
  && cat > /tmp/iot-writer.json <<'POLICY'
{
  \"Version\": \"2012-10-17\",
  \"Statement\": [
    { \"Effect\": \"Allow\", \"Action\": [\"s3:PutObject\"], \"Resource\": [\"arn:aws:s3:::$IOT_BUCKET/iot/\${jwt:preferred_username}/*\"] }
  ]
}
POLICY
  mc admin policy create local iot-writer /tmp/iot-writer.json >/dev/null"
docker exec dxos-minio sh -c "mc alias set local http://localhost:9000 '$MINIO_ROOT_USER' '$MINIO_ROOT_PASSWORD' >/dev/null \
  && cat > /tmp/readonly.json <<'POLICY'
{
  \"Version\": \"2012-10-17\",
  \"Statement\": [
    { \"Effect\": \"Allow\", \"Action\": [\"s3:GetObject\", \"s3:GetBucketLocation\"], \"Resource\": [\"arn:aws:s3:::*\"] },
    { \"Effect\": \"Deny\", \"Action\": [\"admin:CreateUser\"], \"Resource\": [\"arn:aws:s3:::*\"] },
    { \"Effect\": \"Deny\", \"Action\": [\"s3:*\"], \"Resource\": [\"arn:aws:s3:::$DOCS_BUCKET\", \"arn:aws:s3:::$DOCS_BUCKET/*\", \"arn:aws:s3:::$ANCHOR_BUCKET\", \"arn:aws:s3:::$ANCHOR_BUCKET/*\"] }
  ]
}
POLICY
  mc admin policy create local readonly /tmp/readonly.json >/dev/null"
# Policy của admin/editor và các vai trò nghiệp vụ (producer, coop-officer, ocop-officer): SINH từ config/access.json.
# Tên policy = tên role Keycloak. Mọi policy đều Deny ghi/xóa/đổi khóa/bypass trên bucket IoT; vai trò nghiệp vụ chỉ được ĐỌC bucket IoT.
GEN_DIR="scripts/.generated/minio-policies"
GEN_ROLES=$(node scripts/gen-access.js minio "$GEN_DIR" "$IOT_BUCKET" "$MINIO_BUCKET" "$DOCS_BUCKET" "$ANCHOR_BUCKET")
docker exec dxos-minio sh -c "rm -rf /tmp/policies && mkdir -p /tmp/policies"
docker cp "$GEN_DIR/." dxos-minio:/tmp/policies/
docker exec dxos-minio sh -c "mc alias set local http://localhost:9000 '$MINIO_ROOT_USER' '$MINIO_ROOT_PASSWORD' >/dev/null; for f in /tmp/policies/*.json; do n=\${f##*/}; n=\${n%.json}; mc admin policy create local \"\$n\" \"\$f\" >/dev/null || exit 1; done"
# Di chuyển dữ liệu IoT cũ (iot/<ngày>/...) vào thư mục của gateway mặc định (chỉ chạy khi còn dữ liệu cũ, chạy lặp lại an toàn)
# (container MinIO không có grep/awk nên dùng case của shell)
docker exec dxos-minio sh -c "mc ls local/$MINIO_BUCKET/iot/ 2>/dev/null | while read -r _a _b _c _d name; do   case \"\$name\" in [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]/)     mc mv --recursive local/$MINIO_BUCKET/iot/\$name local/$MINIO_BUCKET/iot/service-account-$KEYCLOAK_IOT_CLIENT_ID/\$name >/dev/null;; esac; done"
# Sao chép dữ liệu IoT cũ từ bucket ứng dụng sang bucket có khóa (chỉ khi bucket IoT còn trống, nên chạy lặp lại không tạo thêm phiên bản).
# Bản cũ trong $MINIO_BUCKET/iot/ được GIỮ NGUYÊN: hãy tự xóa sau khi đã kiểm tra bucket mới (xem docs/HUONG-DAN-CHAY.md).
docker exec dxos-minio sh -c "if [ -z \"\$(mc ls local/$IOT_BUCKET/iot/ 2>/dev/null)\" ] && [ -n \"\$(mc ls local/$MINIO_BUCKET/iot/ 2>/dev/null)\" ]; then mc mirror local/$MINIO_BUCKET/iot local/$IOT_BUCKET/iot >/dev/null && echo '  đã sao chép dữ liệu IoT cũ sang $IOT_BUCKET'; fi"
echo "OK: policy MinIO: $GEN_ROLES (sinh từ config/access.json; Deny ghi/xóa/đổi khóa bucket IoT) và 'iot-writer' (chỉ ghi vào thư mục riêng của gateway)."

# Route cũ /api/storage/* (bucket public + JWT ở gateway) đã được thay thế bằng OIDC.
# (không dùng tùy chọn -o trỏ vào thiết bị null: với MSYS_NO_PATHCONV=1 curl.exe của Windows không ghi được và báo lỗi 23)
curl -sS -X DELETE "$ADMIN/routes/storage" -H "X-API-KEY: $APISIX_ADMIN_KEY" >/dev/null || true

curl -fsS -X PUT "$ADMIN/routes/s3" -H "X-API-KEY: $APISIX_ADMIN_KEY" -d @- <<JSON >/dev/null
{
  "name": "s3-sts",
  "uri": "/*",
  "hosts": ["s3.localhost", "apisix"],
  "plugins": {
    ${AUDIT_LOGGER},
    "serverless-pre-function": { "phase": "rewrite", "functions": ["return function(conf, ctx) local a = ngx.req.get_uri_args(); if a['retention'] ~= nil or a['legal-hold'] ~= nil or a['object-lock'] ~= nil or ngx.req.get_headers()['x-amz-bypass-governance-retention'] ~= nil then return 403, {error = 'Khong duoc phep thay doi khoa/giu du lieu (Object Lock) qua cong nay'} end; local p = ngx.var.uri or ''; if p == '/${DOCS_BUCKET}' or p:find('/${DOCS_BUCKET}/', 1, true) == 1 then return 403, {error = 'Kho tep dinh kem chi truy cap qua API nghiep vu'} end; if p == '/${ANCHOR_BUCKET}' or p:find('/${ANCHOR_BUCKET}/', 1, true) == 1 then return 403, {error = 'Kho ban neo chi truy cap qua API nghiep vu'} end end"] }
  },
  "upstream": { "type": "roundrobin", "pass_host": "pass", "nodes": { "minio:9000": 1 } }
}
JSON
echo "OK: S3/STS qua http://s3.localhost:${APISIX_GATEWAY_PORT} (bucket ${MINIO_BUCKET} riêng tư, JWT xác thực bằng MinIO OIDC)."

# ---- Tầng 3: API truy xuất nguồn gốc ----
# /api/trace/*          -> trace-api, bắt buộc JWT Keycloak (phân quyền ghi theo role readwrite nằm trong dịch vụ)
# /api/public/trace/*   -> trace-api (chỉ tuyến /public/:code, không cần đăng nhập, ẩn thông tin nội bộ), giới hạn tần suất
CORS_ORIGIN="${FRONTEND_ORIGIN:-http://localhost:3000}"

curl -fsS -X PUT "$ADMIN/routes/trace" -H "X-API-KEY: $APISIX_ADMIN_KEY" -d @- <<JSON >/dev/null
{
  "name": "trace-api",
  "uri": "/api/trace/*",
  "plugins": {
    ${AUDIT_LOGGER},
    "serverless-pre-function": { "phase": "rewrite", "functions": ["${LUA_TRACE}"] },
    "cors": {
      "allow_origins": "${CORS_ORIGIN}",
      "allow_methods": "GET,POST,PUT,DELETE,OPTIONS",
      "allow_headers": "Authorization,Content-Type",
      "max_age": 3600
    },
    "openid-connect": {
      "discovery": "http://keycloak:8080/realms/${KEYCLOAK_REALM}/.well-known/openid-configuration",
      "client_id": "${KEYCLOAK_CLIENT_ID}",
      "client_secret": "${KEYCLOAK_CLIENT_SECRET}",
      "bearer_only": true,
      "use_jwks": true,
      "ssl_verify": false
    },
    "proxy-rewrite": { "regex_uri": ["^/api/trace/(.*)", "/\$1"] }
  },
  "upstream": { "type": "roundrobin", "nodes": { "trace-api:3000": 1 } }
}
JSON

curl -fsS -X PUT "$ADMIN/routes/trace-public" -H "X-API-KEY: $APISIX_ADMIN_KEY" -d @- <<JSON >/dev/null
{
  "name": "trace-public",
  "uri": "/api/public/trace/*",
  "methods": ["GET", "OPTIONS"],
  "plugins": {
    ${AUDIT_LOGGER},
    "cors": {
      "allow_origins": "${CORS_ORIGIN}",
      "allow_methods": "GET,OPTIONS",
      "allow_headers": "Content-Type",
      "max_age": 3600
    },
    "limit-req": { "rate": 5, "burst": 10, "key_type": "var", "key": "remote_addr", "rejected_code": 429 },
    "proxy-rewrite": { "regex_uri": ["^/api/public/trace/(.*)", "/public/\$1"] }
  },
  "upstream": { "type": "roundrobin", "nodes": { "trace-api:3000": 1 } }
}
JSON
echo "OK: route /api/trace/* (JWT) và /api/public/trace/* (công khai, giới hạn tần suất) đã sẵn sàng."
