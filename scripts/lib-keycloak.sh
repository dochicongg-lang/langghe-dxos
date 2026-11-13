#!/usr/bin/env bash
# Hàm dùng chung cho các script Keycloak (được `source`, không chạy trực tiếp).
# Yêu cầu: đã nạp .env (set -a; . ./.env) và Keycloak đang chạy.

export MSYS_NO_PATHCONV=1 # Git Bash trên Windows: không đổi đường dẫn /opt/... thành đường dẫn Windows
R="${KEYCLOAK_REALM:?}"

kc() { docker exec dxos-keycloak /opt/keycloak/bin/kcadm.sh "$@"; }

kc_login() {
  kc config credentials --server http://localhost:8080 --realm master --user "$KEYCLOAK_ADMIN" --password "$KEYCLOAK_ADMIN_PASSWORD" >/dev/null
}

ensure_role() { # tên, mô tả
  if kc get "roles/$1" -r "$R" >/dev/null 2>&1; then
    kc update "roles/$1" -r "$R" -s "description=$2" >/dev/null
  else
    kc create roles -r "$R" -s "name=$1" -s "description=$2" >/dev/null
  fi
}

ensure_user() { # tên, mật khẩu, vai trò (user thử cho môi trường phát triển)
  local u="$1" pw="$2" role="$3"
  if [ -z "$(kc get users -r "$R" -q "username=$u" --fields id --format csv --noquotes | tr -d '\r')" ]; then
    kc create users -r "$R" -s "username=$u" -s enabled=true -s emailVerified=true -s "email=$u@dxos.local" \
      -s "firstName=$u" -s "lastName=User" >/dev/null
    kc set-password -r "$R" --username "$u" --new-password "$pw"
  fi
  kc add-roles -r "$R" --uusername "$u" --rolename "$role"
}

# Cho phép thuộc tính người dùng tùy chỉnh (Keycloak 26 mặc định bỏ thuộc tính không khai báo trong user profile)
enable_unmanaged_attributes() {
  kc update users/profile -r "$R" -s unmanagedAttributePolicy=ENABLED >/dev/null
}

set_user_attr() { # tên-người-dùng, tên-thuộc-tính, giá-trị
  local id
  id=$(kc get users -r "$R" -q "username=$1" --fields id --format csv --noquotes | tr -d '\r')
  [ -n "$id" ] || { echo "Không có người dùng $1"; return 1; }
  kc update "users/$id" -r "$R" -s "attributes.$2=[\"$3\"]" >/dev/null
}

# Đưa thuộc tính người dùng "coop" (mã HTX) vào JWT cho client web và client API (claim "coop")
ensure_coop_mapper() {
  local cid id
  for cid in "$KEYCLOAK_CLIENT_ID" dxos-web; do
    id=$(kc get clients -r "$R" -q "clientId=$cid" --fields id --format csv --noquotes | tr -d '\r')
    [ -n "$id" ] || continue
    if ! kc get "clients/$id/protocol-mappers/models" -r "$R" --fields name --format csv --noquotes | tr -d '\r' | grep -qx coop; then
      kc create "clients/$id/protocol-mappers/models" -r "$R" -s name=coop -s protocol=openid-connect \
        -s protocolMapper=oidc-usermodel-attribute-mapper -s 'config."user.attribute"=coop' -s 'config."claim.name"=coop' \
        -s 'config."jsonType.label"=String' -s 'config."access.token.claim"=true' -s 'config."id.token.claim"=false' \
        -s 'config."userinfo.token.claim"=true' >/dev/null
    fi
  done
}

# Tạo (hoặc cập nhật khóa của) client gateway IoT: service account, chỉ có role iot-writer.
# Token có audience = client của MinIO/APISIX và claim "policy"; MinIO chỉ cho ghi vào iot/service-account-<client>/.
ensure_iot_client() { # clientId, secret
  local cid="$1" secret="$2" id
  id=$(kc get clients -r "$R" -q "clientId=$cid" --fields id --format csv --noquotes | tr -d '\r')
  if [ -z "$id" ]; then
    kc create clients -r "$R" -s "clientId=$cid" -s enabled=true -s publicClient=false \
      -s serviceAccountsEnabled=true -s standardFlowEnabled=false -s directAccessGrantsEnabled=false \
      -s "secret=$secret" >/dev/null
    id=$(kc get clients -r "$R" -q "clientId=$cid" --fields id --format csv --noquotes | tr -d '\r')
    kc create "clients/$id/protocol-mappers/models" -r "$R" -s name=audience-dxos-api -s protocol=openid-connect \
      -s protocolMapper=oidc-audience-mapper -s "config.\"included.client.audience\"=$KEYCLOAK_CLIENT_ID" \
      -s 'config."access.token.claim"=true' -s 'config."id.token.claim"=false' >/dev/null
    kc create "clients/$id/protocol-mappers/models" -r "$R" -s name=minio-policy -s protocol=openid-connect \
      -s protocolMapper=oidc-usermodel-realm-role-mapper -s 'config."claim.name"=policy' -s 'config.multivalued=true' \
      -s 'config."jsonType.label"=String' -s 'config."access.token.claim"=true' -s 'config."id.token.claim"=true' \
      -s 'config."userinfo.token.claim"=true' >/dev/null
  else
    kc update "clients/$id" -r "$R" -s "secret=$secret" >/dev/null
  fi
  kc add-roles -r "$R" --uusername "service-account-$cid" --rolename iot-writer
}
