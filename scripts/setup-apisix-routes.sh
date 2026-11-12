#!/usr/bin/env bash
# Tạo route APISIX được bảo vệ bằng JWT của Keycloak (plugin openid-connect, bearer_only).
# Dùng: bash scripts/setup-apisix-routes.sh   (chạy sau khi `docker compose up -d`)
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

ADMIN="http://localhost:${APISIX_ADMIN_PORT}/apisix/admin"
FLOWABLE_BASIC=$(printf '%s:%s' "$FLOWABLE_ADMIN_USER" "$FLOWABLE_ADMIN_PASSWORD" | base64 | tr -d '\n')

# Hai route bắt buộc JWT còn có plugin serverless-pre-function chỉ cho qua token có vai trò editor hoặc readonly
# (claim "policy"): token của thiết bị IoT (iot-writer) chỉ dùng để ghi dữ liệu cảm biến, không gọi được các API này.
# Route /api/workflow/* -> Flowable REST (Flowable chỉ nhận qua gateway, gateway tự gắn basic auth nội bộ)
curl -fsS -X PUT "$ADMIN/routes/workflow" -H "X-API-KEY: $APISIX_ADMIN_KEY" -d @- <<JSON
{
  "name": "workflow-api",
  "uri": "/api/workflow/*",
  "plugins": {
    "serverless-pre-function": { "phase": "rewrite", "functions": ["return function(conf, ctx) local core = require('apisix.core'); local h = core.request.header(ctx, 'Authorization'); if not h then return end; local p = h:match('^[Bb]earer%s+[%w%-_]+%.([%w%-_]+)%.'); local ok = false; if p then p = p:gsub('%-', '+'):gsub('_', '/'); p = p .. string.rep('=', (4 - #p % 4) % 4); local d = ngx.decode_base64(p); local c = d and core.json.decode(d); if c and type(c.policy) == 'table' then for _, r in ipairs(c.policy) do if r == 'editor' or r == 'readonly' then ok = true end end end end; if not ok then ngx.header['Access-Control-Allow-Origin'] = '${FRONTEND_ORIGIN:-http://localhost:3000}'; return 403, {error = 'Can vai tro editor hoac readonly. Neu vua doi vai tro, hay dang xuat roi dang nhap lai.'} end end"] },
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

# ---- MinIO: bucket riêng tư + S3/STS trên host s3.localhost (xác thực JWT bằng MinIO OIDC) ----
# Client lấy JWT từ Keycloak -> gọi STS AssumeRoleWithWebIdentity (MinIO tự xác thực JWT, claim "policy"
# ánh xạ sang policy MinIO) -> dùng thông tin tạm thời ký SigV4 gọi S3. Gateway giữ nguyên Host và
# đường dẫn để chữ ký hợp lệ. Cổng API của MinIO không publish ra host nên chỉ vào được qua APISIX.
docker exec dxos-minio sh -c "mc alias set local http://localhost:9000 '$MINIO_ROOT_USER' '$MINIO_ROOT_PASSWORD' >/dev/null \
  && mc mb --ignore-existing local/$MINIO_BUCKET \
  && mc anonymous set none local/$MINIO_BUCKET"

# Tài khoản MinIO CHỈ ĐỌC cho trace-api: tự đối chiếu số liệu cảm biến khi gắn bằng chứng IoT vào công đoạn nung.
# Chỉ được GetObject và ListBucket trên tiền tố iot/ của bucket; không ghi, không xóa, không đọc phần khác.
docker exec dxos-minio sh -c "mc alias set local http://localhost:9000 '$MINIO_ROOT_USER' '$MINIO_ROOT_PASSWORD' >/dev/null \
  && cat > /tmp/trace-iot-read.json <<'POLICY'
{
  \"Version\": \"2012-10-17\",
  \"Statement\": [
    { \"Effect\": \"Allow\", \"Action\": [\"s3:GetObject\"], \"Resource\": [\"arn:aws:s3:::$MINIO_BUCKET/iot/*\"] },
    { \"Effect\": \"Allow\", \"Action\": [\"s3:ListBucket\"], \"Resource\": [\"arn:aws:s3:::$MINIO_BUCKET\"], \"Condition\": { \"StringLike\": { \"s3:prefix\": [\"iot/*\"] } } }
  ]
}
POLICY
  mc admin policy create local trace-iot-read /tmp/trace-iot-read.json >/dev/null \
  && (mc admin user add local '$TRACE_S3_USER' '$TRACE_S3_PASSWORD' >/dev/null) \
  && (mc admin policy attach local trace-iot-read --user '$TRACE_S3_USER' >/dev/null 2>&1 || true)"
echo "OK: tài khoản chỉ đọc '$TRACE_S3_USER' cho trace-api (chỉ đọc tiền tố iot/ của bucket $MINIO_BUCKET)."

# Policy MinIO cho các vai trò Keycloak (claim "policy" = tên role = tên policy), tách quyền ghi dữ liệu IoT:
#   editor      đọc/ghi mọi bucket NHƯNG bị Deny ghi/xóa trong iot/  (khác policy dựng sẵn "readwrite" cho phép tất cả)
#   iot-writer  chỉ PutObject vào THƯ MỤC RIÊNG của gateway: iot/${jwt:preferred_username}/* (= service-account-<client>),
#               nên một gateway bị lộ khóa không ghi đè/giả số liệu của gateway khác; không đọc, không liệt kê
#   readonly    dùng policy dựng sẵn của MinIO (đọc mọi bucket)
docker exec dxos-minio sh -c "mc alias set local http://localhost:9000 '$MINIO_ROOT_USER' '$MINIO_ROOT_PASSWORD' >/dev/null \
  && cat > /tmp/editor.json <<'POLICY'
{
  \"Version\": \"2012-10-17\",
  \"Statement\": [
    { \"Effect\": \"Allow\", \"Action\": [\"s3:*\"], \"Resource\": [\"arn:aws:s3:::*\"] },
    { \"Effect\": \"Deny\", \"Action\": [\"s3:PutObject\", \"s3:DeleteObject\", \"s3:DeleteObjectVersion\", \"s3:AbortMultipartUpload\"], \"Resource\": [\"arn:aws:s3:::$MINIO_BUCKET/iot/*\"] }
  ]
}
POLICY
  cat > /tmp/iot-writer.json <<'POLICY'
{
  \"Version\": \"2012-10-17\",
  \"Statement\": [
    { \"Effect\": \"Allow\", \"Action\": [\"s3:PutObject\"], \"Resource\": [\"arn:aws:s3:::$MINIO_BUCKET/iot/\${jwt:preferred_username}/*\"] }
  ]
}
POLICY
  mc admin policy create local editor /tmp/editor.json >/dev/null \
  && mc admin policy create local iot-writer /tmp/iot-writer.json >/dev/null"
# Di chuyển dữ liệu IoT cũ (iot/<ngày>/...) vào thư mục của gateway mặc định (chỉ chạy khi còn dữ liệu cũ, chạy lặp lại an toàn)
# (container MinIO không có grep/awk nên dùng case của shell)
docker exec dxos-minio sh -c "mc ls local/$MINIO_BUCKET/iot/ 2>/dev/null | while read -r _a _b _c _d name; do   case \"\$name\" in [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]/)     mc mv --recursive local/$MINIO_BUCKET/iot/\$name local/$MINIO_BUCKET/iot/service-account-$KEYCLOAK_IOT_CLIENT_ID/\$name >/dev/null;; esac; done"
echo "OK: policy MinIO 'editor' (không ghi/xóa iot/) và 'iot-writer' (chỉ ghi vào thư mục riêng của gateway)."

# Route cũ /api/storage/* (bucket public + JWT ở gateway) đã được thay thế bằng OIDC.
curl -sS -o /dev/null -X DELETE "$ADMIN/routes/storage" -H "X-API-KEY: $APISIX_ADMIN_KEY" || true

curl -fsS -X PUT "$ADMIN/routes/s3" -H "X-API-KEY: $APISIX_ADMIN_KEY" -d @- <<JSON >/dev/null
{
  "name": "s3-sts",
  "uri": "/*",
  "hosts": ["s3.localhost", "apisix"],
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
    "serverless-pre-function": { "phase": "rewrite", "functions": ["return function(conf, ctx) local core = require('apisix.core'); local h = core.request.header(ctx, 'Authorization'); if not h then return end; local p = h:match('^[Bb]earer%s+[%w%-_]+%.([%w%-_]+)%.'); local ok = false; if p then p = p:gsub('%-', '+'):gsub('_', '/'); p = p .. string.rep('=', (4 - #p % 4) % 4); local d = ngx.decode_base64(p); local c = d and core.json.decode(d); if c and type(c.policy) == 'table' then for _, r in ipairs(c.policy) do if r == 'editor' or r == 'readonly' then ok = true end end end end; if not ok then ngx.header['Access-Control-Allow-Origin'] = '${FRONTEND_ORIGIN:-http://localhost:3000}'; return 403, {error = 'Can vai tro editor hoac readonly. Neu vua doi vai tro, hay dang xuat roi dang nhap lai.'} end end"] },
    "cors": {
      "allow_origins": "${CORS_ORIGIN}",
      "allow_methods": "GET,POST,OPTIONS",
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
