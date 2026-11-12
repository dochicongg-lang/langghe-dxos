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

B="$MINIO_BUCKET"
GWDIR="service-account-$KEYCLOAK_IOT_CLIENT_ID" # thư mục riêng của gateway (policy dùng ${jwt:preferred_username})
FILE_DEV="iot/$GWDIR/perm-test-device-$TS.txt"; FILE_SEED="iot/$GWDIR/perm-test-seed-$TS.txt"
check() { # mô tả, kỳ vọng (ok|deny), lệnh...
  local desc=$1 want=$2; shift 2
  if "$@"; then got=ok; else got=deny; fi
  if [ "$got" = "$want" ]; then echo "PASS  $desc"; else echo "FAIL  $desc (mong đợi $want, thực tế $got)"; FAIL=1; fi
}

root "echo seed | mc pipe r/$B/$FILE_SEED"
docker exec dxos-minio sh -c "echo dev > /tmp/p.txt"

echo "== Thiết bị (role iot-writer) =="
check "ghi vào thư mục của chính gateway"  ok   mcas "$DEVICE_CRED" cp /tmp/p.txt "x/$B/$FILE_DEV"
check "đọc iot/"                  deny mcas "$DEVICE_CRED" cat "x/$B/$FILE_SEED"
check "liệt kê iot/"              deny mcas "$DEVICE_CRED" ls "x/$B/iot/"
check "ghi vào thư mục gateway KHÁC (giả mạo)" deny mcas "$DEVICE_CRED" cp /tmp/p.txt "x/$B/iot/service-account-khac/perm-test-$TS.txt"
check "ghi trực tiếp dưới iot/ (ngoài thư mục gateway)" deny mcas "$DEVICE_CRED" cp /tmp/p.txt "x/$B/iot/perm-test-root-$TS.txt"
check "ghi ngoài iot/"            deny mcas "$DEVICE_CRED" cp /tmp/p.txt "x/$B/other-$TS.txt"
check "xóa trong iot/"            deny mcas "$DEVICE_CRED" rm "x/$B/$FILE_SEED"

echo "== Nhân viên (role editor) =="
check "đọc iot/"                  ok   mcas "$EDITOR_CRED" cat "x/$B/$FILE_SEED"
check "ghi vào iot/ (giả mạo số liệu)" deny mcas "$EDITOR_CRED" cp /tmp/p.txt "x/$B/iot/perm-test-forged-$TS.txt"
check "ghi đè tệp trong iot/"     deny mcas "$EDITOR_CRED" cp /tmp/p.txt "x/$B/$FILE_SEED"
check "xóa trong iot/"            deny mcas "$EDITOR_CRED" rm "x/$B/$FILE_SEED"
check "ghi ngoài iot/ (dữ liệu ứng dụng)" ok mcas "$EDITOR_CRED" cp /tmp/p.txt "x/$B/app-data/perm-test-$TS.txt"

echo "== API nghiệp vụ (qua APISIX) =="
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
check "editor xem danh sách (200)"       ok   test "$(code -H "Authorization: Bearer $EDITOR_JWT" "$GW/api/trace/products")" = 200
check "editor gọi workflow (200)"           ok   test "$(code -H "Authorization: Bearer $EDITOR_JWT" "$GW/api/workflow/repository/process-definitions")" = 200
check "không token -> 401"               ok   test "$(code "$GW/api/trace/products")" = 401
check "thiết bị xem danh sách bị chặn"   ok   test "$(code -H "Authorization: Bearer $DEVICE_JWT" "$GW/api/trace/products")" != 200
check "thiết bị tạo sản phẩm bị chặn"    ok   test "$(code -X POST -H "Authorization: Bearer $DEVICE_JWT" -H "Content-Type: application/json" -d '{"name":"x"}' "$GW/api/trace/products")" != 201
check "thiết bị gọi workflow bị chặn"    ok   test "$(code -H "Authorization: Bearer $DEVICE_JWT" "$GW/api/workflow/repository/process-definitions")" != 200

root "mc rm --force r/$B/$FILE_DEV r/$B/$FILE_SEED r/$B/iot/perm-test-forged-$TS.txt r/$B/app-data/perm-test-$TS.txt"
echo
[ "$FAIL" = 0 ] && echo "TẤT CẢ ĐẠT" || echo "CÓ MỤC KHÔNG ĐẠT"
exit "$FAIL"
