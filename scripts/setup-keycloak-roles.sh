#!/usr/bin/env bash
# Áp dụng mô hình vai trò mới cho realm Keycloak ĐANG CHẠY (realm chỉ được import khi chưa tồn tại,
# nên sửa keycloak/dxos-realm.json không tự cập nhật realm cũ). Chạy lặp lại an toàn.
#
#   editor     nhân viên: tạo/sửa dữ liệu ứng dụng; MinIO đọc/ghi nhưng KHÔNG ghi/xóa trong iot/
#   readonly   chỉ xem
#   iot-writer thiết bị: chỉ ghi vào iot/ (client riêng `dxos-iot`), không đọc, không gọi API nghiệp vụ
#
# Dùng: bash scripts/setup-keycloak-roles.sh   (sau `docker compose up -d`)
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
export MSYS_NO_PATHCONV=1 # Git Bash trên Windows: không đổi đường dẫn /opt/... thành đường dẫn Windows

kc() { docker exec dxos-keycloak /opt/keycloak/bin/kcadm.sh "$@"; }
R="$KEYCLOAK_REALM"

kc config credentials --server http://localhost:8080 --realm master --user "$KEYCLOAK_ADMIN" --password "$KEYCLOAK_ADMIN_PASSWORD" >/dev/null

ensure_role() { # tên, mô tả
  if kc get "roles/$1" -r "$R" >/dev/null 2>&1; then
    kc update "roles/$1" -r "$R" -s "description=$2" >/dev/null
  else
    kc create roles -r "$R" -s "name=$1" -s "description=$2" >/dev/null
  fi
}
ensure_role editor "Nhân viên: tạo/sửa dữ liệu ứng dụng; MinIO đọc/ghi mọi bucket NHƯNG KHÔNG ghi/xóa trong iot/"
ensure_role readonly "Chỉ xem; MinIO policy readonly (đọc mọi bucket)"
ensure_role iot-writer "Thiết bị IoT: chỉ ghi (PutObject) vào iot/, không đọc, không gọi API nghiệp vụ"

# Client riêng cho thiết bị IoT (service account, không đăng nhập bằng người dùng)
IOT_ID=$(kc get clients -r "$R" -q "clientId=$KEYCLOAK_IOT_CLIENT_ID" --fields id --format csv --noquotes | tr -d '\r')
if [ -z "$IOT_ID" ]; then
  kc create clients -r "$R" -s "clientId=$KEYCLOAK_IOT_CLIENT_ID" -s enabled=true -s publicClient=false \
    -s serviceAccountsEnabled=true -s standardFlowEnabled=false -s directAccessGrantsEnabled=false \
    -s "secret=$KEYCLOAK_IOT_CLIENT_SECRET" >/dev/null
  IOT_ID=$(kc get clients -r "$R" -q "clientId=$KEYCLOAK_IOT_CLIENT_ID" --fields id --format csv --noquotes | tr -d '\r')
  # Token phải có audience = client của MinIO/APISIX (dxos-api) và claim "policy" (tên role -> policy MinIO)
  kc create "clients/$IOT_ID/protocol-mappers/models" -r "$R" -s name=audience-dxos-api -s protocol=openid-connect \
    -s protocolMapper=oidc-audience-mapper -s "config.\"included.client.audience\"=$KEYCLOAK_CLIENT_ID" \
    -s 'config."access.token.claim"=true' -s 'config."id.token.claim"=false' >/dev/null
  kc create "clients/$IOT_ID/protocol-mappers/models" -r "$R" -s name=minio-policy -s protocol=openid-connect \
    -s protocolMapper=oidc-usermodel-realm-role-mapper -s 'config."claim.name"=policy' -s 'config.multivalued=true' \
    -s 'config."jsonType.label"=String' -s 'config."access.token.claim"=true' -s 'config."id.token.claim"=true' \
    -s 'config."userinfo.token.claim"=true' >/dev/null
else
  kc update "clients/$IOT_ID" -r "$R" -s "secret=$KEYCLOAK_IOT_CLIENT_SECRET" >/dev/null
fi

IOT_USER="service-account-$KEYCLOAK_IOT_CLIENT_ID"
kc add-roles -r "$R" --uusername "$IOT_USER" --rolename iot-writer
kc add-roles -r "$R" --uusername tester --rolename editor

# Gỡ quyền cũ: `readwrite` (MinIO đọc/ghi mọi thứ, gồm cả iot/) không còn dùng
for u in tester "service-account-$KEYCLOAK_CLIENT_ID"; do
  kc remove-roles -r "$R" --uusername "$u" --rolename readwrite >/dev/null 2>&1 || true
done
kc delete roles/readwrite -r "$R" >/dev/null 2>&1 || true

echo "OK: realm $R có role editor / readonly / iot-writer; client thiết bị '$KEYCLOAK_IOT_CLIENT_ID' chỉ có iot-writer; role readwrite đã gỡ."
