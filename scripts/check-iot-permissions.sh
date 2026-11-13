#!/usr/bin/env bash
# Kiểm tra thật việc tách quyền ghi dữ liệu IoT: thiết bị (iot-writer) chỉ ghi được vào iot/,
# nhân viên (editor) đọc được nhưng KHÔNG ghi/xóa được trong iot/, thiết bị không gọi được API nghiệp vụ.
# Dùng: bash scripts/check-iot-permissions.sh   (sau khi đã chạy setup-keycloak-roles.sh và setup-apisix-routes.sh)
set -uo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
export MSYS_NO_PATHCONV=1

GW="http://localhost:${APISIX_GATEWAY_PORT}"
KC="http://localhost:${KEYCLOAK_PORT}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token"
TS=$(date +%s)
FAIL=0

token() { sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p'; }
EDITOR_JWT=$(curl -s -X POST "$KC" -d grant_type=password -d client_id="$KEYCLOAK_CLIENT_ID" -d client_secret="$KEYCLOAK_CLIENT_SECRET" -d username=tester -d password=tester | token)
DEVICE_JWT=$(curl -s -X POST "$KC" -d grant_type=client_credentials -d client_id="$KEYCLOAK_IOT_CLIENT_ID" -d client_secret="$KEYCLOAK_IOT_CLIENT_SECRET" | token)
VIEWER_JWT=$(curl -s -X POST "$KC" -d grant_type=password -d client_id="$KEYCLOAK_CLIENT_ID" -d client_secret="$KEYCLOAK_CLIENT_SECRET" -d username=viewer -d password=viewer | token)
[ -n "$EDITOR_JWT" ] && [ -n "$DEVICE_JWT" ] || { echo "Không lấy được token (kiểm tra .env và setup-keycloak-roles.sh)"; exit 2; }

# Đổi JWT lấy thông tin tạm của MinIO qua cổng gác (đúng đường frontend/simulator dùng) -> AK:SK:SESSION
sts() {
  local xml; xml=$(curl -s -X POST "http://s3.localhost:${APISIX_GATEWAY_PORT}/" --data-urlencode "WebIdentityToken=$1" -d Action=AssumeRoleWithWebIdentity -d Version=2011-06-15)
  local ak sk st
  ak=$(echo "$xml" | sed -n 's/.*<AccessKeyId>\([^<]*\)<.*/\1/p'); sk=$(echo "$xml" | sed -n 's/.*<SecretAccessKey>\([^<]*\)<.*/\1/p'); st=$(echo "$xml" | sed -n 's/.*<SessionToken>\([^<]*\)<.*/\1/p')
  [ -n "$ak" ] && echo "$ak:$sk:$st"
}
EDITOR_CRED=$(sts "$EDITOR_JWT"); DEVICE_CRED=$(sts "$DEVICE_JWT")
[ -n "$EDITOR_CRED" ] && [ -n "$DEVICE_CRED" ] || { echo "STS thất bại (MinIO không nhận token?)"; exit 2; }

# mc chạy trong container MinIO với thông tin tạm của từng bên; root dùng để chuẩn bị và dọn dẹp
mcas() { local cred=$1; shift; docker exec -e "MC_HOST_x=http://${cred}@localhost:9000" dxos-minio mc "$@" >/dev/null 2>&1; }
root() { docker exec dxos-minio sh -c "mc alias set r http://localhost:9000 '$MINIO_ROOT_USER' '$MINIO_ROOT_PASSWORD' >/dev/null && $*" >/dev/null 2>&1; }

B="${IOT_BUCKET:-dxos-iot}"   # bucket IoT có Object Lock
A="$MINIO_BUCKET"            # bucket dữ liệu ứng dụng (không khóa)
GWDIR="service-account-$KEYCLOAK_IOT_CLIENT_ID" # thư mục riêng của gateway (policy dùng ${jwt:preferred_username})
FILE_DEV="iot/$GWDIR/perm-test-device-$TS.txt"; FILE_SEED="iot/$GWDIR/perm-test-seed-$TS.txt"
check() { # mô tả, kỳ vọng (ok|deny), lệnh...
  local desc=$1 want=$2; shift 2
  if "$@"; then got=ok; else got=deny; fi
  if [ "$got" = "$want" ]; then echo "PASS  $desc"; else echo "FAIL  $desc (mong đợi $want, thực tế $got)"; FAIL=1; fi
}
# Liệt kê các phiên bản của một đối tượng (chạy bằng root) và lấy versionId đầu tiên
rootls() { docker exec dxos-minio sh -c "mc alias set r http://localhost:9000 '$MINIO_ROOT_USER' '$MINIO_ROOT_PASSWORD' >/dev/null && mc ls --versions --json r/$B/$1" 2>/dev/null; }

rootout() { docker exec dxos-minio sh -c "mc alias set r http://localhost:9000 '$MINIO_ROOT_USER' '$MINIO_ROOT_PASSWORD' >/dev/null && $1" 2>/dev/null; }
root "echo seed | mc pipe r/$B/$FILE_SEED"
docker exec dxos-minio sh -c "echo dev > /tmp/p.txt; echo dev2 > /tmp/p2.txt"

echo "== Cấu hình Object Lock của bucket IoT =="
check "bucket $B có Object Lock (giữ mặc định)" ok root "mc retention info --default r/$B"

echo "== Thiết bị (role iot-writer) =="
check "ghi vào thư mục của chính gateway"  ok   mcas "$DEVICE_CRED" cp /tmp/p.txt "x/$B/$FILE_DEV"
check "ghi đè cùng tên: được phép nhưng chỉ tạo phiên bản mới" ok mcas "$DEVICE_CRED" cp /tmp/p2.txt "x/$B/$FILE_DEV"
check "...và bản gốc vẫn còn (có ít nhất 2 phiên bản)" ok test "$(rootls "$FILE_DEV" | wc -l)" -ge 2
check "đọc iot/"                  deny mcas "$DEVICE_CRED" cat "x/$B/$FILE_SEED"
check "liệt kê iot/"              deny mcas "$DEVICE_CRED" ls "x/$B/iot/"
check "ghi vào thư mục gateway KHÁC (giả mạo)" deny mcas "$DEVICE_CRED" cp /tmp/p.txt "x/$B/iot/service-account-khac/perm-test-$TS.txt"
check "ghi trực tiếp dưới iot/ (ngoài thư mục gateway)" deny mcas "$DEVICE_CRED" cp /tmp/p.txt "x/$B/iot/perm-test-root-$TS.txt"
check "ghi ngoài iot/ trong bucket IoT" deny mcas "$DEVICE_CRED" cp /tmp/p.txt "x/$B/other-$TS.txt"
check "ghi vào bucket dữ liệu ứng dụng" deny mcas "$DEVICE_CRED" cp /tmp/p.txt "x/$A/other-$TS.txt"
check "xóa trong bucket IoT"      deny mcas "$DEVICE_CRED" rm "x/$B/$FILE_SEED"

echo "== Nhân viên (role editor) =="
check "đọc bucket IoT"            ok   mcas "$EDITOR_CRED" cat "x/$B/$FILE_SEED"
check "ghi vào bucket IoT (giả mạo số liệu)" deny mcas "$EDITOR_CRED" cp /tmp/p.txt "x/$B/iot/perm-test-forged-$TS.txt"
check "ghi đè tệp trong bucket IoT" deny mcas "$EDITOR_CRED" cp /tmp/p.txt "x/$B/$FILE_SEED"
check "xóa trong bucket IoT"      deny mcas "$EDITOR_CRED" rm "x/$B/$FILE_SEED"
check "xóa bằng đặc quyền bypass" deny mcas "$EDITOR_CRED" rm --bypass "x/$B/$FILE_SEED"
check "đổi cấu hình khóa của bucket" deny mcas "$EDITOR_CRED" retention set --default GOVERNANCE 1d "x/$B"
check "ghi dữ liệu ứng dụng ở bucket thường" ok mcas "$EDITOR_CRED" cp /tmp/p.txt "x/$A/app-data/perm-test-$TS.txt"

echo "== Đối tượng đã khóa (Object Lock) =="
VID=$(rootls "$FILE_SEED" | sed -n 's/.*"versionId":"\([^"]*\)".*/\1/p' | head -1)
check "có versionId của tệp thử"  ok   test -n "$VID"
check "root xóa vĩnh viễn phiên bản còn hạn khóa (không bypass) bị từ chối" deny root "mc rm --version-id $VID r/$B/$FILE_SEED"

echo "== Chống gỡ hạn khóa qua cổng gác (MinIO bản này cho mọi tài khoản STS gỡ khóa Governance bằng tiêu đề bypass) =="
RET='<Retention xmlns="http://s3.amazonaws.com/doc/2006-03-01/"></Retention>'
MD5=$(printf '%s' "$RET" | openssl dgst -md5 -binary | base64)
unlock() { # tên-vai-trò cred ; gửi PutObjectRetention rỗng + bypass qua APISIX, in mã HTTP
  local ak sk st; IFS=: read -r ak sk st <<< "$2"
  curl -s -o /dev/null -w "%{http_code}" -X PUT --aws-sigv4 "aws:amz:us-east-1:s3" --user "$ak:$sk" \
    -H "x-amz-security-token: $st" -H "x-amz-bypass-governance-retention: true" -H "Content-MD5: $MD5" \
    --data "$RET" "http://s3.localhost:${APISIX_GATEWAY_PORT}/$B/$FILE_SEED?retention"
}
check "editor không gỡ được hạn khóa qua cổng gác"  ok test "$(unlock editor "$EDITOR_CRED")" = 403
check "thiết bị không gỡ được hạn khóa qua cổng gác" ok test "$(unlock device "$DEVICE_CRED")" = 403
check "hạn khóa của tệp thử vẫn còn nguyên"         ok test -n "$(rootout "mc retention info r/$B/$FILE_SEED" | sed -n -e '/GOVERNANCE/p' -e '/COMPLIANCE/p')"

echo "== API nghiệp vụ (qua APISIX) =="
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
check "editor xem danh sách (200)"       ok   test "$(code -H "Authorization: Bearer $EDITOR_JWT" "$GW/api/trace/products")" = 200
check "editor gọi workflow (200)"           ok   test "$(code -H "Authorization: Bearer $EDITOR_JWT" "$GW/api/workflow/repository/process-definitions")" = 200
check "không token -> 401"               ok   test "$(code "$GW/api/trace/products")" = 401
check "thiết bị xem danh sách bị chặn"   ok   test "$(code -H "Authorization: Bearer $DEVICE_JWT" "$GW/api/trace/products")" != 200
check "thiết bị tạo sản phẩm bị chặn"    ok   test "$(code -X POST -H "Authorization: Bearer $DEVICE_JWT" -H "Content-Type: application/json" -d '{"name":"x"}' "$GW/api/trace/products")" != 201
check "viewer (chỉ xem) đọc định nghĩa quy trình (200)" ok test "$(code -H "Authorization: Bearer $VIEWER_JWT" "$GW/api/workflow/repository/process-definitions")" = 200
check "viewer không DELETE được triển khai workflow"   ok test "$(code -X DELETE -H "Authorization: Bearer $VIEWER_JWT" "$GW/api/workflow/repository/deployments/khong-ton-tai")" = 403
check "viewer không khởi chạy được quy trình (POST)"    ok test "$(code -X POST -H "Authorization: Bearer $VIEWER_JWT" -H "Content-Type: application/json" -d '{}' "$GW/api/workflow/runtime/process-instances")" = 403
check "viewer không đọc được người dùng Flowable"       ok test "$(code -H "Authorization: Bearer $VIEWER_JWT" "$GW/api/workflow/identity/users")" = 403
check "editor cũng không vào được tuyến quản trị Flowable" ok test "$(code -H "Authorization: Bearer $EDITOR_JWT" "$GW/api/workflow/management/engine")" = 403
check "thiết bị gọi workflow bị chặn"    ok   test "$(code -H "Authorization: Bearer $DEVICE_JWT" "$GW/api/workflow/repository/process-definitions")" != 200

echo "== Vai trò nghiệp vụ và sở hữu (persona hoa=producer, tuan=coop-officer, ocop=ocop-officer; cùng HTX htx-demo) =="
pw_token() { curl -s -X POST "$KC" -d grant_type=password -d client_id="$KEYCLOAK_CLIENT_ID" -d client_secret="$KEYCLOAK_CLIENT_SECRET" -d username="$1" -d password="$1" | token; }
HOA_JWT=$(pw_token hoa); TUAN_JWT=$(pw_token tuan); OCOP_JWT=$(pw_token ocop)
[ -n "$HOA_JWT" ] && [ -n "$TUAN_JWT" ] && [ -n "$OCOP_JWT" ] || { echo "Không lấy được token persona (chạy bash scripts/setup-keycloak-roles.sh)"; exit 2; }
PCODE="G1TEST-$TS"
api() { # jwt phương-thức đường-dẫn [json] -> mã HTTP (qua cổng gác)
  curl -s -o /dev/null -w "%{http_code}" -X "$2" -H "Authorization: Bearer $1" -H "Content-Type: application/json" ${4:+-d "$4"} "$GW/api/trace/$3"
}
EV='{"stage":"tao-hinh","note":"kiem tra phan quyen"}'
check "hoa (producer) tạo sản phẩm của mình"               ok test "$(api "$HOA_JWT" POST products "{\"code\":\"$PCODE\",\"name\":\"Kiem tra G1\"}")" = 201
check "hoa thêm công đoạn vào sản phẩm của mình"          ok test "$(api "$HOA_JWT" POST "products/$PCODE/events" "$EV")" = 201
check "hoa KHÔNG thêm được vào sản phẩm của người khác (mẫu GOM-BT-0001)" ok test "$(api "$HOA_JWT" POST products/GOM-BT-0001/events "$EV")" = 403
check "hoa xem được sản phẩm cùng HTX"                     ok test "$(api "$HOA_JWT" GET products/GOM-BT-0001)" = 200
check "tuan (coop-officer) thêm công đoạn vào sản phẩm của hoa (cùng HTX)" ok test "$(api "$TUAN_JWT" POST "products/$PCODE/events" "$EV")" = 201
check "tuan xem danh sách sản phẩm (200)"                  ok test "$(api "$TUAN_JWT" GET products)" = 200
check "ocop (ocop-officer) xem được sản phẩm"              ok test "$(api "$OCOP_JWT" GET "products/$PCODE")" = 200
check "ocop KHÔNG tạo được sản phẩm"                       ok test "$(api "$OCOP_JWT" POST products '{"name":"x"}')" = 403
check "ocop KHÔNG thêm được công đoạn"                     ok test "$(api "$OCOP_JWT" POST "products/$PCODE/events" "$EV")" = 403
check "viewer (readonly) KHÔNG tạo được sản phẩm"          ok test "$(api "$VIEWER_JWT" POST products '{"name":"x"}')" = 403
check "viewer KHÔNG thêm được công đoạn"                   ok test "$(api "$VIEWER_JWT" POST "products/$PCODE/events" "$EV")" = 403
check "thiết bị (iot-writer) không dùng được /me"          ok test "$(api "$DEVICE_JWT" GET me)" != 200
check "/me của hoa có HTX và quyền theo phạm vi"           ok test "$(curl -s -H "Authorization: Bearer $HOA_JWT" "$GW/api/trace/me" | grep -c '"coop":"htx-demo".*"product.update":"own"')" = 1
check "người chưa đăng nhập không đọc được sản phẩm nội bộ" ok test "$(curl -s -o /dev/null -w "%{http_code}" "$GW/api/trace/products/$PCODE")" = 401
check "bản công khai không lộ chủ sở hữu/HTX"              ok test "$(curl -s "$GW/api/public/trace/$PCODE" | grep -c 'owner\|"coop"\|created_by')" = 0
check "hoa đọc được định nghĩa quy trình (200)"            ok test "$(code -H "Authorization: Bearer $HOA_JWT" "$GW/api/workflow/repository/process-definitions")" = 200
check "hoa KHÔNG thay đổi được quy trình (POST) "          ok test "$(code -X POST -H "Authorization: Bearer $HOA_JWT" -H "Content-Type: application/json" -d '{}' "$GW/api/workflow/runtime/process-instances")" = 403
# MinIO: vai trò nghiệp vụ chỉ ĐỌC được bucket IoT, không ghi (đối chiếu: nhân viên admin cũng không ghi được)
HOA_CRED=$(sts "$HOA_JWT"); [ -n "$HOA_CRED" ] || { echo "STS thất bại cho hoa (thiếu policy MinIO producer?)"; FAIL=1; }
check "producer đọc được số liệu bucket IoT"               ok mcas "$HOA_CRED" ls "x/$B/iot/"
check "producer KHÔNG ghi được vào thư mục gateway"        deny mcas "$HOA_CRED" cp /tmp/p.txt "x/$B/iot/$GWDIR/perm-test-producer-$TS.txt"
check "producer KHÔNG xóa/đổi khóa được ở bucket IoT"      deny mcas "$HOA_CRED" rm "x/$B/$FILE_SEED"
# Dọn sản phẩm thử
docker exec dxos-postgres psql -U "$POSTGRES_USER" -d "$TRACE_DB" -t -c "DELETE FROM products WHERE code='$PCODE';" >/dev/null 2>&1

# Dọn tệp thử: bucket IoT bị khóa nên cần đặc quyền bypass (chỉ có ở chế độ GOVERNANCE).
root "mc rm --versions --force --bypass r/$B/$FILE_DEV r/$B/$FILE_SEED; mc rm --force r/$A/app-data/perm-test-$TS.txt"
if [ "${IOT_LOCK_MODE:-GOVERNANCE}" = COMPLIANCE ]; then echo "(COMPLIANCE: các tệp perm-test-* trong $B sẽ tồn tại đến khi hết hạn giữ, không dọn được)"; fi
echo
[ "$FAIL" = 0 ] && echo "TẤT CẢ ĐẠT" || echo "CÓ MỤC KHÔNG ĐẠT"
exit "$FAIL"
