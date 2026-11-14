// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
// Cấu hình dùng chung cho Tầng 2. Mọi lời gọi API đều đi qua API Gateway (APISIX) kèm JWT Keycloak.
export const config = {
  keycloakUrl: process.env.NEXT_PUBLIC_KEYCLOAK_URL ?? "http://localhost:8080",
  realm: process.env.NEXT_PUBLIC_KEYCLOAK_REALM ?? "dxos",
  clientId: process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID ?? "dxos-web",
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:9080",
  // S3 API của MinIO, truy cập qua APISIX theo host s3.localhost (trình duyệt tự phân giải *.localhost về máy bạn)
  s3Endpoint: process.env.NEXT_PUBLIC_S3_ENDPOINT ?? "http://s3.localhost:9080",
  iotBucket: process.env.NEXT_PUBLIC_IOT_BUCKET ?? "dxos-iot",
  // Địa chỉ công khai của giao diện, dùng làm nội dung mã QR (vd. https://truyxuat.lang-nghe.vn). Bỏ trống = dùng địa chỉ đang mở.
  publicBaseUrl: (process.env.NEXT_PUBLIC_PUBLIC_BASE_URL ?? "").replace(/\/+$/, ""),
  // Thông tin liên hệ hỗ trợ do đơn vị vận hành đặt (bỏ trống thì trang Trợ giúp chỉ hướng dẫn nhờ quản trị viên của HTX)
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "",
  supportPhone: process.env.NEXT_PUBLIC_SUPPORT_PHONE ?? "",
  supportZalo: process.env.NEXT_PUBLIC_SUPPORT_ZALO ?? "", // số điện thoại Zalo hoặc đường dẫn https
  supportFacebook: process.env.NEXT_PUBLIC_SUPPORT_FACEBOOK ?? "", // đường dẫn https tới trang Facebook
  supportHours: process.env.NEXT_PUBLIC_SUPPORT_HOURS ?? "Giờ hành chính, thứ Hai đến thứ Sáu",
};
