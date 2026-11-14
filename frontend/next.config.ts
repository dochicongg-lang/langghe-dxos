// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Ẩn nút công cụ phát triển (N · Insight) ở góc màn hình khi chạy npm run dev; bản đóng gói vốn không có.
  devIndicators: false,
  // Tắt kiểm tra tự động "Instant Insight" ở chế độ dev (nó báo một cảnh báo kỹ thuật ở trang Sản phẩm, người dùng không cần thấy).
  experimental: { instantInsights: { validationLevel: "manual-warning" } },
  // Trang công khai (quét QR) gọi API cùng nguồn gốc với chính nó: Next chuyển tiếp /api/public/trace/* tới cổng gác APISIX.
  // Nhờ vậy điện thoại chỉ cần vào được cổng 3000 của máy chạy giao diện (không phải mở thêm cổng 9080 hay cấu hình CORS theo địa chỉ LAN).
  // PUBLIC_API_PROXY_TARGET: địa chỉ cổng gác nhìn từ máy chủ Next (mặc định http://localhost:9080).
  async rewrites() {
    const target = process.env.PUBLIC_API_PROXY_TARGET ?? `http://localhost:${process.env.APISIX_GATEWAY_PORT ?? 9080}`;
    return [{ source: "/api/public/trace/:code", destination: `${target}/api/public/trace/:code` }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
