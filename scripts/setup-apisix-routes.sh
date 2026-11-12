#!/usr/bin/env bash
# Tạo route APISIX được bảo vệ bằng JWT của Keycloak (plugin openid-connect, bearer_only).
# Dùng: bash scripts/setup-apisix-routes.sh   (chạy sau khi `docker compose up -d`)
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

ADMIN="http://localhost:${APISIX_ADMIN_PORT}/apisix/admin"
FLOWABLE_BASIC=$(printf '%s:%s' "$FLOWABLE_ADMIN_USER" "$FLOWABLE_ADMIN_PASSWORD" | base64 | tr -d '\n')

# Route /api/workflow/* -> Flowable REST (Flowable chỉ nhận qua gateway, gateway tự gắn basic auth nội bộ)
curl -fsS -X PUT "$ADMIN/routes/workflow" -H "X-API-KEY: $APISIX_ADMIN_KEY" -d @- <<JSON
{
  "name": "workflow-api",
  "uri": "/api/workflow/*",
  "plugins": {
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
