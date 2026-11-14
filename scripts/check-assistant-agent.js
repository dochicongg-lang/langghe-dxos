// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
// Kiểm tra THẬT trợ lý hỏi đáp (tra cứu có nguồn) và tác tử đề xuất có người duyệt, qua cổng gác + Keycloak + trace-api + PostgreSQL:
//  Trợ lý: trả lời đúng số liệu lấy từ cấu hình (đối chiếu với tệp cấu hình thật), luôn kèm nguồn, câu hỏi ngoài phạm vi thì nói chưa có (không đoán).
//  Tác tử: mẻ nung cần xem lại hoặc cảnh báo tạo ĐỀ XUẤT (không tự hành động); tự kích hoạt khi thêm công đoạn nung có bằng chứng IoT;
//          chỉ người có quyền duyệt (đúng HTX) thấy và quyết định; duyệt mới gửi thông báo, từ chối thì không; không duyệt hai lần.
// Đề xuất thật của các mẻ mẫu GOM-BT-0002 và GOM-BT-0003 được GIỮ (đang chờ duyệt); dữ liệu thử của bài này được dọn.
// Chạy: node scripts/check-assistant-agent.js   (sau bash scripts/upgrade.sh và node scripts/seed-demo.js; tuan không được còn OTP: bash scripts/reset-otp.sh)
const fs = require("fs");
const { execFileSync } = require("child_process");
const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split(/\r?\n/).map((l) => l.match(/^([A-Za-z_]\w*)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const GW = `http://localhost:${Number(env.APISIX_GATEWAY_PORT ?? 9080)}`;
const KC = `http://localhost:8080/realms/${env.KEYCLOAK_REALM ?? "dxos"}/protocol/openid-connect/token`;
const ocopCfg = JSON.parse(fs.readFileSync("config/ocop-profiles.json", "utf8"));
const P = ocopCfg.profiles[ocopCfg.defaultProfile];
let fail = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fail++;
};
const psql = (sql) => execFileSync("docker", ["exec", "dxos-postgres", "psql", "-U", env.POSTGRES_USER ?? "postgres", "-d", env.TRACE_DB ?? "traceability", "-tAc", sql], { encoding: "utf8" }).trim();
const token = async (user) => {
  const r = await fetch(KC, { method: "POST", body: new URLSearchParams({ grant_type: "password", client_id: env.KEYCLOAK_CLIENT_ID, client_secret: env.KEYCLOAK_CLIENT_SECRET, username: user, password: user }) });
  const j = await r.json();
  if (!j.access_token) throw new Error(`không lấy được token của ${user} (nếu là tuan: bash scripts/reset-otp.sh)`);
  return j.access_token;
};
const api = async (tok, method, path, body) => {
  const r = await fetch(`${GW}/api/trace${path}`, { method, headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};

(async () => {
  const [hoa, tuan, tester, viewer] = await Promise.all(["hoa", "tuan", "tester", "viewer"].map(token));
  const ask = async (tok, q) => (await api(tok, "POST", "/assistant/ask", { question: q })).json;

  // ================= Trợ lý =================
  ok((await fetch(`${GW}/api/trace/assistant/ask`, { method: "POST", body: "{}" })).status === 401, "không token -> 401");
  const star4 = P.scoring.stars.find((s) => s.stars === 4);
  let r = await ask(hoa, "bao nhieu diem thi duoc 4 sao");
  ok(r.matched && r.answer.includes(`4 sao từ ${star4.min} đến ${Math.floor(star4.max)}`) && r.sources.length >= 1, `hạng 4 sao: "${star4.min} đến ${Math.floor(star4.max)} điểm" khớp cấu hình (gõ không dấu), kèm nguồn`);
  r = await ask(viewer, "Kết quả OCOP có hiệu lực bao lâu?");
  ok(r.matched && r.answer.includes(`${P.validityMonths} tháng`), `hiệu lực ${P.validityMonths} tháng khớp cấu hình (người chỉ-xem cũng hỏi được)`);
  r = await ask(hoa, "Hạn sơ duyệt hồ sơ của hợp tác xã là bao nhiêu ngày làm việc?");
  ok(r.matched && r.answer.includes(`${P.communeReviewWorkingDays} ngày làm việc`), `hạn sơ duyệt ${P.communeReviewWorkingDays} ngày làm việc khớp cấu hình`);
  const craft = P.groups.find((g) => g.key === "thu-cong-my-nghe");
  const required = P.checklist.filter((c) => c.required && (!c.onlyGroups || c.onlyGroups.includes(craft.key)) && !(c.exceptGroups && c.exceptGroups.includes(craft.key)));
  r = await ask(hoa, "Hồ sơ OCOP nhóm hàng thủ công mỹ nghệ cần giấy tờ gì?");
  ok(r.matched && required.every((c) => r.answer.includes(c.label)), `liệt kê đủ ${required.length} giấy tờ bắt buộc của nhóm thủ công đúng như cấu hình`);
  r = await ask(hoa, "Xác nhận của nền tảng khác gì kết quả OCOP chính thức");
  ok(r.matched && /chưa phải giấy chứng nhận/.test(r.answer), "giải thích đúng ranh giới xác nhận của nền tảng và kết quả chính thức");
  r = await ask(hoa, "Thời tiết ngày mai ở Hà Nội thế nào?");
  ok(r.matched === false && r.sources.length === 0, "câu hỏi ngoài phạm vi: nói chưa có thông tin, không đoán, không trích nguồn");
  r = await ask(hoa, "giá vàng hôm nay");
  ok(r.matched === false, "câu hỏi lạ chứa từ thông dụng cũng bị từ chối (không khớp nhầm)");

  // ================= Tác tử =================
  ok((await api(hoa, "GET", "/agent/proposals")).status === 403, "producer không xem được đề xuất của tác tử (403)");
  ok((await api(viewer, "GET", "/agent/proposals")).status === 403, "viewer không xem được đề xuất (403)");
  ok((await api(tuan, "POST", "/agent/scan")).status === 403, "cán bộ HTX không quét tay được (403)");
  const scan = await api(tester, "POST", "/agent/scan");
  ok(scan.status === 200 && scan.json.scanned >= 3, `quản trị quét các mẻ nung: ${scan.json?.scanned} mẻ, ${scan.json?.created} đề xuất mới`);
  const list = (await api(tester, "GET", "/agent/proposals")).json.proposals;
  const mine = list.filter((p) => ["GOM-BT-0002", "GOM-BT-0003"].includes(p.subject) && p.status === "pending");
  ok(mine.length >= 2, `có đề xuất chờ duyệt cho mẻ quá nhiệt (GOM-BT-0002) và gia nhiệt nhanh (GOM-BT-0003): ${mine.map((p) => `${p.subject}/${p.severity}`).join(", ")}`);
  ok(!list.some((p) => p.subject === "GOM-BT-0001"), "mẻ đạt chuẩn (GOM-BT-0001) KHÔNG có đề xuất");
  const over = mine.find((p) => p.subject === "GOM-BT-0002");
  ok(over.severity === "alert" && /Căn cứ/.test(over.rationale) && over.status === "pending", `đề xuất nêu lý do và căn cứ, đang chờ duyệt: "${over.title}"`);
  ok((await api(tester, "POST", "/agent/scan")).json.created === 0, "quét lặp lại KHÔNG tạo thêm đề xuất (mỗi sự kiện một đề xuất)");
  ok(Number(psql(`SELECT count(*) FROM notifications WHERE kind = 'agent_kiln' AND link = '/trace/GOM-BT-0002'`)) === 0, "tác tử KHÔNG tự gửi thông báo khi chưa có người duyệt");

  // ---- tự kích hoạt khi thêm công đoạn nung có bằng chứng IoT ----
  const [deviceId, from, to] = psql(`SELECT iot->>'deviceId' || '|' || (iot->>'from') || '|' || (iot->>'to') FROM trace_events e JOIN products p ON p.id = e.product_id WHERE p.code = 'GOM-BT-0003' AND e.iot IS NOT NULL ORDER BY e.id LIMIT 1`).split("|");
  const win = { deviceId, from, to };
  const before = Number(psql("SELECT count(*) FROM agent_proposals"));
  const add = await api(tester, "POST", "/products/GOM-BT-0003/events", { stage: "nung-hoan-thien", note: "Thử tác tử (thử)", location: "Lò thử", iot: win });
  ok(add.status === 201 || add.status === 200, `thêm công đoạn nung có bằng chứng IoT cho GOM-BT-0003 (HTTP ${add.status})`);
  const auto = Number(psql("SELECT count(*) FROM agent_proposals")) - before;
  ok(auto === 1, `tác tử TỰ tạo đúng 1 đề xuất cho mẻ vừa thêm (không cần quét tay): +${auto}`);
  const newest = (await api(tester, "GET", "/agent/proposals")).json.proposals.find((p) => p.subject === "GOM-BT-0003" && p.status === "pending" && !mine.some((m) => m.id === p.id));
  ok(Boolean(newest), "đề xuất mới xuất hiện trong danh sách của quản trị");

  // ---- duyệt: chỉ khi duyệt mới có thông báo; không duyệt hai lần ----
  const ap = await api(tester, "POST", `/agent/proposals/${newest.id}/decide`, { decision: "approve", note: "Đã xem, đồng ý" });
  ok(ap.status === 200 && ap.json.status === "approved", "quản trị duyệt đề xuất");
  // người nhận: cán bộ HTX của HTX sở hữu sản phẩm, hoặc quản trị nếu sản phẩm chưa gắn HTX
  const productCoop = psql("SELECT coalesce(c.code, '') FROM products p LEFT JOIN cooperatives c ON c.id = p.coop_id WHERE p.code = 'GOM-BT-0003'");
  const receiver = productCoop ? tuan : tester;
  const notice = (await api(receiver, "GET", "/notifications")).json.notifications.find((n) => n.kind === "agent_kiln" && n.link === "/trace/GOM-BT-0003");
  ok(Boolean(notice) && notice.title.includes("GOM-BT-0003"), `duyệt xong mới có thông báo: "${notice?.title}"`);
  ok((await api(tester, "POST", `/agent/proposals/${newest.id}/decide`, { decision: "reject" })).status === 409, "duyệt lần hai bị từ chối (409)");
  ok((await api(tester, "POST", `/agent/proposals/${over.id}/decide`, { decision: "xoa" })).status === 400, "quyết định không hợp lệ -> 400");

  // ---- phạm vi theo HTX (dùng đề xuất tổng hợp của hai HTX khác nhau) ----
  const act = JSON.stringify({ type: "notify", for_role: "coop-officer", for_coop: "htx-demo", level: "warn", title: "Thông báo thử của đề xuất (thử)", body: "thử", link: "/trace/GOM-BT-0003" });
  psql(`INSERT INTO agent_proposals (dedupe_key, kind, severity, title, rationale, subject, coop, action) VALUES ('thu:htx-demo', 'kiln_review', 'warn', 'Đề xuất HTX demo (thử)', 'thử', 'GOM-BT-0003', 'htx-demo', '${act}'), ('thu:htx-khac', 'kiln_review', 'warn', 'Đề xuất HTX khác (thử)', 'thử', 'GOM-BT-0003', 'htx-khac', '${act}'), ('thu:reject', 'kiln_review', 'warn', 'Đề xuất sẽ từ chối (thử)', 'thử', 'GOM-BT-0003', 'htx-demo', '${act}')`);
  const tuanList = (await api(tuan, "GET", "/agent/proposals")).json.proposals;
  ok(tuanList.some((p) => p.title.includes("HTX demo")) && !tuanList.some((p) => p.title.includes("HTX khác")), "cán bộ HTX chỉ thấy đề xuất của HTX mình");
  const idOf = (key) => Number(psql(`SELECT id FROM agent_proposals WHERE dedupe_key = '${key}'`));
  ok((await api(tuan, "POST", `/agent/proposals/${idOf("thu:htx-khac")}/decide`, { decision: "approve" })).status === 404, "cán bộ HTX không duyệt được đề xuất của HTX khác (404, không lộ sự tồn tại)");
  ok((await api(tuan, "POST", `/agent/proposals/${idOf("thu:htx-demo")}/decide`, { decision: "approve" })).json.status === "approved", "cán bộ HTX duyệt đề xuất của HTX mình");
  ok((await api(tuan, "GET", "/notifications")).json.notifications.some((n) => n.title.includes("Thông báo thử của đề xuất")), "cán bộ HTX nhận thông báo sau khi duyệt");
  const before2 = Number(psql("SELECT count(*) FROM notifications WHERE kind = 'agent_kiln'"));
  ok((await api(tuan, "POST", `/agent/proposals/${idOf("thu:reject")}/decide`, { decision: "reject", note: "Không cần" })).json.status === "rejected", "cán bộ HTX từ chối một đề xuất");
  ok(Number(psql("SELECT count(*) FROM notifications WHERE kind = 'agent_kiln'")) === before2, "từ chối thì KHÔNG có thông báo nào được gửi");

  // ---- dọn dữ liệu thử (giữ nguyên hai đề xuất thật của các mẻ mẫu) ----
  psql(`DELETE FROM notifications WHERE dedupe_key IN (SELECT 'agent:' || id FROM agent_proposals WHERE dedupe_key LIKE 'thu:%' OR id = ${newest.id})`);
  psql(`DELETE FROM agent_proposals WHERE dedupe_key LIKE 'thu:%' OR id = ${newest.id}`);
  psql(`DELETE FROM trace_events WHERE note = 'Thử tác tử (thử)'`);
  ok(Number(psql("SELECT count(*) FROM agent_proposals WHERE status = 'pending' AND subject IN ('GOM-BT-0002','GOM-BT-0003')")) >= 2, "đã dọn dữ liệu thử; hai đề xuất thật của mẻ mẫu vẫn đang chờ duyệt");

  console.log(fail ? `\n${fail} KIỂM TRA THẤT BẠI` : "\nTẤT CẢ ĐẠT");
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("Lỗi:", e.message);
  process.exit(2);
});
