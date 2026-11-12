// Cấu hình dùng chung cho Tầng 2. Mọi lời gọi API đều đi qua API Gateway (APISIX) kèm JWT Keycloak.
export const config = {
  keycloakUrl: process.env.NEXT_PUBLIC_KEYCLOAK_URL ?? "http://localhost:8080",
  realm: process.env.NEXT_PUBLIC_KEYCLOAK_REALM ?? "dxos",
  clientId: process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID ?? "dxos-web",
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:9080",
  // S3 API của MinIO, truy cập qua APISIX theo host s3.localhost (trình duyệt tự phân giải *.localhost về máy bạn)
  s3Endpoint: process.env.NEXT_PUBLIC_S3_ENDPOINT ?? "http://s3.localhost:9080",
  iotBucket: process.env.NEXT_PUBLIC_IOT_BUCKET ?? "dxos-data",
};
