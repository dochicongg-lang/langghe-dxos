// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
// Minh họa Zero-Trust CHẠY TRỰC TIẾP cho buổi trình diễn: từng yêu cầu thật gửi qua cổng gác, in kết quả kèm giải thích ngắn,
// cuối cùng cho thấy chính các lần thử đó đã được ghi vào nhật ký kiểm toán. Không thay đổi dữ liệu nào (chỉ đọc hoặc bị từ chối).
// Chạy: node scripts/demo-zero-trust.js
const fs = require("fs");
const http = require("http");
const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split(/\r?\n/).map((l) => l.match(/^([A-Za-z_]\w*)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const PORT = Number(env.APISIX_GATEWAY_PORT ?? 9080);
const GW = `http://localhost:${PORT}`;
const KC = `http://localhost:8080/realms/${env.KEYCLOAK_REALM ?? "dxos"}/protocol/openid-connect/token`;
const MARK = `zt${Date.now()}`;
let fail = 0;

const token = async (user) => {
  const r = await fetch(KC, { method: "POST", body: new URLSearchParams({ grant_type: "password", client_id: env.KEYCLOAK_CLIENT_ID, client_secret: env.KEYCLOAK_CLIENT_SECRET, username: user, password: user }) });
  return (await r.json()).access_token;
};
const call = async (tok, method, path, body) => {
  const r = await fetch(`${GW}${path}${path.includes("?") ? "&" : "?"}probe=${MARK}`, { method, headers: { ...(tok ? { authorization: `Bearer ${tok}` } : {}), "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, text: await r.text() };
};
const s3 = (method, path, headers = {}) =>
  new Promise((resolve, reject) => {
    const rq = http.request({ host: "localhost", port: PORT, path, method, headers: { host: `s3.localhost:${PORT}`, ...headers } }, (res) => {
      let t = "";
      res.on("data", (c) => (t += c));
      res.on("end", () => resolve({ status: res.statusCode, text: t }));
    });
    rq.on("error", reject);
    rq.end();
  });
const show = (title, expectStatus, got, why) => {
  const good = Array.isArray(expectStatus) ? expectStatus.includes(got) : got === expectStatus;
  if (!good) fail++;
  const shown = typeof got === "boolean" ? (got ? "đúng" : "sai") : `HTTP ${got}${good ? "" : ` (mong đợi ${expectStatus})`}`;
  console.log(`${good ? "✓" : "✗"} ${title}\n    -> ${shown}   ${why}`);
};
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

(async () => {
  const [hoa, viewer, tester] = await Promise.all(["hoa", "viewer", "tester"].map(token));
  console.log("== ZERO-TRUST: không tin ai theo mặc định, mọi yêu cầu đều bị kiểm tra ==\n");

  show("1. Gọi API khi KHÔNG có token", 401, (await call(null, "GET", "/api/trace/products")).status, "cổng gác chặn ngay, dịch vụ phía sau không nhận được yêu cầu");
  show("2. Có token hợp lệ của chị Hoa (nghệ nhân)", 200, (await call(hoa, "GET", "/api/trace/products")).status, "cùng đường gọi, có danh tính thì vào được");
  const forged = `${b64({ alg: "none" })}.${b64({ preferred_username: "tester", policy: ["editor"], exp: Math.floor(Date.now() / 1000) + 3600 })}.chu-ky-gia`;
  show("3. Token GIẢ MẠO (tự khai là quản trị 'tester', chữ ký sai)", 401, (await call(forged, "GET", "/api/trace/products")).status, "chữ ký được kiểm với khóa công khai của Keycloak nên không giả được");
  show("4. Tài khoản chỉ-xem (viewer) cố TẠO sản phẩm", 403, (await call(viewer, "POST", "/api/trace/products", { name: "x" })).status, "có đăng nhập nhưng không đủ quyền: phân quyền theo vai trò từ config/access.json");
  show("5. viewer cố XÓA một quy trình trong Flowable", 403, (await call(viewer, "DELETE", "/api/workflow/repository/deployments/khong-co")).status, "cổng gác gắn quyền admin cho Flowable, nên đã chặn mọi thao tác ghi của người không phải quản trị (lỗ hổng đã kiểm chứng và vá)");
  show("6. viewer đọc danh sách người dùng quản trị của Flowable", 403, (await call(viewer, "GET", "/api/workflow/identity/users")).status, "tuyến quản trị của Flowable bị chặn với mọi người");
  show("7. Nghệ nhân (hoa) đọc NHẬT KÝ KIỂM TOÁN", 403, (await call(hoa, "GET", "/api/trace/audit")).status, "chỉ quản trị mới xem được 'ai đã làm gì'");

  console.log("\n== BẢO MẬT DỮ LIỆU: kho lưu trữ và khóa chống sửa ==\n");
  const lock = await s3("PUT", `/${env.IOT_BUCKET ?? "dxos-iot"}/iot/x.txt?retention&probe=${MARK}`, { "x-amz-bypass-governance-retention": "true" });
  show("8. Cố GỠ KHÓA Object Lock bằng tiêu đề bypass (lỗ hổng của MinIO bản này)", 403, lock.status, "MinIO bản đang dùng cho BẤT KỲ tài khoản nào gỡ khóa Governance bằng tiêu đề này; cổng gác chặn nên không còn đường đi");
  const docs = await s3("GET", `/${env.DOCS_BUCKET ?? "dxos-docs"}/applications/x.jpg?probe=${MARK}`);
  show("9. Cố đọc THẲNG kho tệp hồ sơ OCOP qua cổng S3", 403, docs.status, "kho tệp chỉ truy cập qua API sau khi kiểm quyền xem hồ sơ; đường tắt bị chặn");

  console.log("\n== DẤU VẾT: chính các lần thử trên đã được ghi vào nhật ký kiểm toán ==\n");
  let rows = [];
  for (let i = 0; i < 20; i++) {
    const r = await call(tester, "GET", `/api/trace/audit?q=${MARK}&limit=100`);
    rows = JSON.parse(r.text).rows ?? [];
    if (rows.filter((x) => x.status >= 400).length >= 8) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const denied = rows.filter((x) => x.status >= 400).reverse();
  for (const x of denied) console.log(`  #${x.id}  ${x.ts.slice(11, 19)}  ${(x.actor ?? "ẩn danh").padEnd(8)} ${x.actor && !x.verified ? "(tự khai) " : ""}${x.method.padEnd(6)} ${x.path.split("?")[0].padEnd(42)} -> ${x.status}`);
  show(`10. Nhật ký ghi lại ${denied.length} lần bị từ chối ở trên (người dùng ở yêu cầu bị từ chối là "tự khai" vì chưa xác thực được)`, true, denied.length >= 8, "bảng nhật ký chỉ ghi thêm, có chuỗi băm chống sửa lén");
  const ver = JSON.parse((await call(tester, "GET", "/api/trace/audit/verify")).text);
  show(`11. Kiểm tra toàn vẹn chuỗi băm (${ver.rows} dòng)`, true, ver.ok, "mọi dòng nối băm với dòng trước: sửa hay xóa lén sẽ lộ ngay");

  console.log(fail ? `\n${fail} mục không như mong đợi` : "\nTất cả như mong đợi.");
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("LỖI:", e.message);
  process.exit(1);
});
