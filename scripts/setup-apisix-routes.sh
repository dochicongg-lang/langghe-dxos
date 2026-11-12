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
