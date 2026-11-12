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
