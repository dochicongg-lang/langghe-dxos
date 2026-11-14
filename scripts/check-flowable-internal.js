// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
// Kiểm tra THẬT việc giới hạn quyền của trace-api đối với Flowable (route nội bộ của cổng gác, cổng 9081):
//  - từ BÊN TRONG container trace-api (đúng vị trí kẻ chiếm được trace-api sẽ đứng), thử mọi thao tác nguy hiểm mà quyền admin của Flowable
//    cho phép (quản trị engine, tạo/xóa người dùng, triển khai/xóa quy trình, bắt đầu quy trình lạ, claim/delegate việc): tất cả phải bị 403;
//  - không có khóa hoặc sai khóa: 401; route không tồn tại ở cổng công khai 9080; cổng 9081 không publish ra máy chủ;
//  - trace-api không còn giữ mật khẩu admin của Flowable;
//  - ĐỐI CHỨNG DƯƠNG: luồng OCOP đầy đủ (nộp, sơ duyệt, ghi kết quả) vẫn chạy qua route này.
// Chạy: node scripts/check-flowable-internal.js   (sau bash scripts/upgrade.sh)
const fs = require("fs");
const { execFileSync } = require("child_process");
const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split(/\r?\n/).map((l) => l.match(/^([A-Za-z_]\w*)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
let fail = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fail++;
};
const docker = (...a) => execFileSync("docker", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, MSYS_NO_PATHCONV: "1" } }).trim();

// Mỗi phép thử: [mô tả, phương thức, đường dẫn, thân, chế độ khóa, trạng thái mong đợi]
const CASES = [
  ["không có khóa", "GET", "/runtime/tasks?processInstanceId=x", null, "none", [401]],
  ["sai khóa", "GET", "/runtime/tasks?processInstanceId=x", null, "wrong", [401]],
  ["xem việc của MỘT tiến trình (được phép)", "GET", "/runtime/tasks?processInstanceId=khong-co", null, "good", [200]],
  ["liệt kê việc của mọi tiến trình", "GET", "/runtime/tasks", null, "good", [403]],
  ["xem việc với processInstanceId rỗng", "GET", "/runtime/tasks?processInstanceId=", null, "good", [403]],
  ["đọc thông tin engine (management)", "GET", "/management/engine", null, "good", [403]],
  ["đọc danh sách công việc nền (management/jobs)", "GET", "/management/jobs", null, "good", [403]],
  ["đọc danh sách người dùng Flowable", "GET", "/identity/users", null, "good", [403]],
  ["TẠO người dùng Flowable", "POST", "/identity/users", { id: "ke-gian", firstName: "x", password: "Pw-12345-xyz" }, "good", [403]],
  ["XÓA người dùng Flowable", "DELETE", "/identity/users/rest-admin", null, "good", [403]],
  ["đọc các lần triển khai quy trình", "GET", "/repository/deployments", null, "good", [403]],
  ["triển khai quy trình mới", "POST", "/repository/deployments", {}, "good", [403]],
  ["XÓA triển khai quy trình", "DELETE", "/repository/deployments/khong-co", null, "good", [403]],
  ["bắt đầu quy trình LẠ (không phải hồ sơ OCOP)", "POST", "/runtime/process-instances", { processDefinitionKey: "createTimersProcess" }, "good", [403]],
  ["bắt đầu quy trình không khai khóa", "POST", "/runtime/process-instances", {}, "good", [403]],
  ["claim việc", "POST", "/runtime/tasks/khong-co", { action: "claim", assignee: "ke-gian" }, "good", [403]],
  ["delegate việc", "POST", "/runtime/tasks/khong-co", { action: "delegate", assignee: "ke-gian" }, "good", [403]],
  ["thân yêu cầu không phải JSON", "POST", "/runtime/tasks/khong-co", "khong-phai-json", "good", [403]],
  ["đường dẫn con của việc (variables)", "POST", "/runtime/tasks/khong-co/variables", [], "good", [403]],
  ["hoàn thành việc không tồn tại (qua danh sách cho phép, Flowable trả 404)", "POST", "/runtime/tasks/khong-co", { action: "complete" }, "good", [404]],
];

const probe = `
const key = process.env.FLOWABLE_PROXY_KEY, base = process.env.FLOWABLE_URL;
const cases = JSON.parse(process.argv[1]);
(async () => {
  const out = [];
  for (const [, method, path, body, mode] of cases) {
    const headers = { accept: "application/json", "content-type": "application/json" };
    if (mode === "good") headers["x-internal-key"] = key;
    if (mode === "wrong") headers["x-internal-key"] = "sai-" + key;
    const r = await fetch(base + path, { method, headers, body: body === null ? undefined : (typeof body === "string" ? body : JSON.stringify(body)) });
    out.push(r.status);
  }
  console.log(JSON.stringify(out));
})();
`;

(async () => {
  const statuses = JSON.parse(docker("exec", "dxos-trace-api", "node", "-e", probe, JSON.stringify(CASES)));
  CASES.forEach(([desc, method, path, , , want], i) => ok(want.includes(statuses[i]), `từ trong trace-api: ${desc} (${method} ${path.split("?")[0]}) -> ${statuses[i]}${want.includes(statuses[i]) ? "" : `, mong ${want.join("/")}`}`));

  // ---- Từ bên ngoài ----
  const pub = await fetch(`http://localhost:${env.APISIX_GATEWAY_PORT ?? 9080}/flowable-internal/runtime/tasks?processInstanceId=x`, { headers: { "x-internal-key": env.FLOWABLE_PROXY_KEY } });
  ok(pub.status === 404, `route nội bộ KHÔNG tồn tại ở cổng công khai (kể cả khi có đúng khóa): ${pub.status}`);
  let reach = true;
  try {
    await fetch("http://localhost:9081/flowable-internal/runtime/tasks?processInstanceId=x", { headers: { "x-internal-key": env.FLOWABLE_PROXY_KEY }, signal: AbortSignal.timeout(4000) });
  } catch {
    reach = false;
  }
  ok(!reach, "cổng nội bộ 9081 KHÔNG truy cập được từ máy chủ (không được publish)");
  const ports = docker("port", "dxos-apisix");
  ok(!/9081/.test(ports), "docker không publish cổng 9081 của cổng gác");

  // ---- trace-api không còn giữ mật khẩu admin Flowable ----
  const envJson = docker("inspect", "dxos-trace-api", "--format", "{{json .Config.Env}}");
  ok(!envJson.includes(env.FLOWABLE_ADMIN_PASSWORD) && !/FLOWABLE_(USER|PASSWORD)=/.test(envJson), "biến môi trường của trace-api KHÔNG chứa mật khẩu admin Flowable");

  // ---- Đối chứng dương: luồng OCOP đầy đủ ----
  console.log("Chạy luồng OCOP đầy đủ qua route nội bộ (check-ocop-flow.js)...");
  let flowOk = false;
  let flowOut = "";
  try {
    flowOut = execFileSync("node", ["scripts/check-ocop-flow.js"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    flowOk = /TẤT CẢ ĐẠT/.test(flowOut);
  } catch (e) {
    flowOut = String(e.stdout ?? "") + String(e.stderr ?? "");
  }
  ok(flowOk, "luồng OCOP thật (nộp, sơ duyệt, bổ sung, ghi kết quả) vẫn chạy qua route nội bộ");
  if (!flowOk) console.log(flowOut.split("\n").filter((l) => /FAIL|Lỗi/.test(l)).join("\n"));

  console.log(fail ? `\n${fail} KIỂM TRA THẤT BẠI` : "\nTẤT CẢ ĐẠT");
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("Lỗi:", e.message);
  process.exit(2);
});
