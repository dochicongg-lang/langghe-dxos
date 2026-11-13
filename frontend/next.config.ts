import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
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
