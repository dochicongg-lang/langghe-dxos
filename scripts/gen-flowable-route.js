// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
// Sinh JSON route nội bộ Flowable cho APISIX (in ra stdout). Dùng bởi scripts/setup-apisix-routes.sh.
//   FLOWABLE_PROXY_KEY=<khóa> FLOWABLE_BASIC=<base64 user:mật-khẩu Flowable> node scripts/gen-flowable-route.js
// Route chỉ khớp ở cổng NỘI BỘ 9081 (không publish ra máy chủ, xem docker-compose.yml và apisix/config.yaml): vars server_port == 9081.
// Quyền được giới hạn bằng apisix/flowable-internal.lua (danh sách cho phép); Basic auth của Flowable gắn ở đây nên trace-api không giữ mật khẩu.
const fs = require("fs");
const path = require("path");

const INTERNAL_PORT = "9081";
const TEMPLATE = path.join(__dirname, "..", "apisix", "flowable-internal.lua");

/** Dựng định nghĩa route từ khóa nội bộ và chuỗi Basic (hàm thuần, có test). */
function buildRoute(key, basic, template = fs.readFileSync(TEMPLATE, "utf8")) {
  if (!/^[A-Za-z0-9_-]{24,}$/.test(String(key ?? ""))) throw new Error("FLOWABLE_PROXY_KEY phải dài ít nhất 24 ký tự chữ, số, gạch ngang hoặc gạch dưới");
  if (!basic) throw new Error("thiếu FLOWABLE_BASIC");
  if (!template.includes("__KEY__")) throw new Error("khuôn Lua thiếu chỗ thay __KEY__");
  const lua = template.split("__KEY__").join(key);
  return {
    name: "flowable-internal",
    uri: "/flowable-internal/*",
    hosts: ["apisix"], // APISIX khớp tên miền TRƯỚC khi xét độ ưu tiên: route S3 khai host "apisix" nên route này phải khai cùng host để được so sánh với nó
    priority: 100, // cao hơn route S3 (khớp host "apisix" mà trace-api dùng để gọi), nếu không yêu cầu bị chuyển nhầm sang MinIO
    vars: [["server_port", "==", INTERNAL_PORT]],
    plugins: {
      "serverless-pre-function": { phase: "rewrite", functions: [lua] },
      "proxy-rewrite": {
        regex_uri: ["^/flowable-internal/(.*)", "/flowable-rest/service/$1"],
        headers: { set: { Authorization: `Basic ${basic}` } },
      },
    },
    upstream: { type: "roundrobin", nodes: { "flowable:8080": 1 } },
  };
}

module.exports = { buildRoute, INTERNAL_PORT };

if (require.main === module) {
  try {
    process.stdout.write(JSON.stringify(buildRoute(process.env.FLOWABLE_PROXY_KEY, process.env.FLOWABLE_BASIC)));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
