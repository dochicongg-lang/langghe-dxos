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

# ---- MinIO: bucket riêng tư + S3/STS trên host s3.localhost (xác thực JWT bằng MinIO OIDC) ----
# Client lấy JWT từ Keycloak -> gọi STS AssumeRoleWithWebIdentity (MinIO tự xác thực JWT, claim "policy"
# ánh xạ sang policy MinIO) -> dùng thông tin tạm thời ký SigV4 gọi S3. Gateway giữ nguyên Host và
# đường dẫn để chữ ký hợp lệ. Cổng API của MinIO không publish ra host nên chỉ vào được qua APISIX.
docker exec dxos-minio sh -c "mc alias set local http://localhost:9000 '$MINIO_ROOT_USER' '$MINIO_ROOT_PASSWORD' >/dev/null \
  && mc mb --ignore-existing local/$MINIO_BUCKET \
  && mc anonymous set none local/$MINIO_BUCKET"

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
