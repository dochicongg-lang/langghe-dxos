// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
// Kiểm tra THẬT nhắc hạn, leo thang và thông báo qua cổng gác + Keycloak + trace-api + PostgreSQL:
//  - hồ sơ chờ sơ duyệt 13 ngày làm việc => nhắc cán bộ HTX (và CHỈ họ); quá 15 ngày => leo thang tới quản trị và cán bộ đầu mối OCOP;
//  - quét lặp lại không tạo thêm thông báo (mỗi sự việc đúng một lần); hồ sơ cần bổ sung lâu => nhắc người nộp;
//  - kết quả OCOP sắp hết hiệu lực => nhắc gia hạn chủ hồ sơ và cán bộ HTX;
//  - đã đọc theo TỪNG người (người khác vẫn thấy chưa đọc); thông báo của HTX khác không lộ; chỉ quản trị quét tay được.
// Thời gian được mô phỏng bằng cách lùi mốc thời gian trong lịch sử hồ sơ thử (UPDATE thẳng CSDL, chỉ dùng cho bài thử này).
// Chạy: node scripts/check-notifications.js   (sau bash scripts/upgrade.sh). Hồ sơ thử ở lại (có chữ "thử"), thông báo thử được dọn.
const fs = require("fs");
const { execFileSync } = require("child_process");
const { workingDaysBetween } = require("../services/trace-api/reminders");
const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split(/\r?\n/).map((l) => l.match(/^([A-Za-z_]\w*)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const GW = `http://localhost:${Number(env.APISIX_GATEWAY_PORT ?? 9080)}`;
const KC = `http://localhost:8080/realms/${env.KEYCLOAK_REALM ?? "dxos"}/protocol/openid-connect/token`;
const DAY = 86_400_000;
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
/** Ngày d sao cho đúng n ngày làm việc đã trôi qua tới hôm nay. */
const workingDaysAgo = (n) => {
  const now = new Date();
  for (let k = 0; k < 60; k++) {
    const d = new Date(now.getTime() - k * DAY);
    if (workingDaysBetween(d, now) === n) return d;
  }
  throw new Error("không tính được ngày");
};
const setSince = (code, d, toState) =>
  psql(`UPDATE ocop_application_history SET created_at = '${d.toISOString()}' WHERE application_id = (SELECT id FROM ocop_applications WHERE code = '${code}') AND to_state = '${toState}' AND action <> 'archive'`);
const mine = async (tok, code) => (await api(tok, "GET", "/notifications")).json.notifications.filter((n) => n.link === `/ocop/${code}`);

(async () => {
  const [hoa, tuan, ocop, tester, viewer] = await Promise.all(["hoa", "tuan", "ocop", "tester", "viewer"].map(token));
  const DOCS = ["phieu-dang-ky", "bao-cao-tu-danh-gia", "giay-phep-kinh-doanh", "anh-san-pham", "san-pham-mau"];
  const mk = async (name) => {
    const c = await api(hoa, "POST", "/applications", { product_name: name, product_group: "thu-cong-my-nghe", description: "Thử nhắc hạn", self_score: { A: 30, B: 20, C: 25 }, documents: DOCS });
    await api(hoa, "POST", `/applications/${c.json.code}/actions`, { action: "submit" });
    return c.json.code;
  };
  const A = await mk("Thử nhắc hạn A (thử)");

  // ---- phân quyền ----
  ok((await api(hoa, "POST", "/notifications/scan")).status === 403, "producer không quét tay được (403)");
  ok((await api(tuan, "POST", "/notifications/scan")).status === 403, "cán bộ HTX không quét tay được (403)");
  ok((await fetch(`${GW}/api/trace/notifications`)).status === 401, "không token -> 401");

  // ---- 13 ngày làm việc: nhắc cán bộ HTX ----
  setSince(A, workingDaysAgo(13), "in_review");
  const s1 = await api(tester, "POST", "/notifications/scan");
  ok(s1.status === 200 && s1.json.created >= 1, `quản trị quét tay: ${s1.json?.created} thông báo mới`);
  const tuanA = await mine(tuan, A);
  ok(tuanA.length === 1 && tuanA[0].kind === "review_due" && tuanA[0].level === "warn" && /Còn 2 ngày làm việc/.test(tuanA[0].body), `cán bộ HTX thấy nhắc sắp hết hạn: "${tuanA[0]?.title}"`);
  ok((await mine(hoa, A)).length === 0, "người nộp (producer) KHÔNG thấy thông báo dành cho cán bộ HTX");
  ok((await mine(ocop, A)).length === 0 && (await mine(tester, A)).length === 0, "cán bộ đầu mối và quản trị chưa bị làm phiền khi mới sắp hết hạn");
  const s2 = await api(tester, "POST", "/notifications/scan");
  ok(s2.json.created === 0, "quét lặp lại KHÔNG tạo thêm thông báo (mỗi sự việc đúng một lần)");

  // ---- quá hạn: leo thang ----
  setSince(A, workingDaysAgo(16), "in_review");
  const s3 = await api(tester, "POST", "/notifications/scan");
  ok(s3.json.created === 3, `quá 15 ngày làm việc: leo thang 3 thông báo (HTX, quản trị, đầu mối OCOP): ${s3.json.created}`);
  const levels = async (tok) => (await mine(tok, A)).filter((n) => n.kind === "review_overdue").map((n) => n.level);
  ok((await levels(tester)).join() === "alert" && (await levels(ocop)).join() === "alert" && (await levels(tuan)).join() === "alert", "quản trị, cán bộ đầu mối và cán bộ HTX đều thấy cảnh báo quá hạn (mức alert)");
  ok((await levels(hoa)).length === 0, "người nộp vẫn không thấy thông báo nội bộ về quá hạn của HTX");

  // ---- đã đọc theo từng người ----
  const before = (await api(tuan, "GET", "/notifications")).json.unread;
  const target = (await mine(tuan, A)).find((n) => n.kind === "review_overdue");
  ok((await api(tuan, "POST", `/notifications/${target.id}/read`)).json.marked === 1, "tuan đánh dấu đã đọc một thông báo");
  ok((await api(tuan, "GET", "/notifications")).json.unread === before - 1, "số chưa đọc của tuan giảm đúng 1");
  const adminSees = (await mine(tester, A)).find((n) => n.kind === "review_overdue");
  ok(adminSees && adminSees.read === false, "quản trị vẫn thấy thông báo của mình là CHƯA đọc (trạng thái đọc theo từng người)");
  ok((await api(hoa, "POST", `/notifications/${target.id}/read`)).status === 404, "người không được thấy thông báo thì không đánh dấu đọc được (404, không lộ sự tồn tại)");

  // ---- thông báo của HTX khác không lộ ----
  psql(`INSERT INTO notifications (dedupe_key, kind, level, title, body, for_role, for_coop) VALUES ('thu-nghiem:htx-khac:${A}', 'review_due', 'warn', 'Thông báo của HTX khác (thử)', 'không được lộ', 'coop-officer', 'htx-khac')`);
  const tuanAll = (await api(tuan, "GET", "/notifications")).json.notifications;
  ok(!tuanAll.some((n) => n.title.includes("HTX khác")), "cán bộ HTX KHÔNG thấy thông báo gắn với HTX khác");

  // ---- cần bổ sung lâu: nhắc người nộp ----
  const B = await mk("Thử nhắc hạn B (thử)");
  ok((await api(tuan, "POST", `/applications/${B}/actions`, { action: "revise", note: "Bổ sung ảnh (thử)" })).status === 200, "tuan yêu cầu bổ sung hồ sơ B");
  setSince(B, new Date(Date.now() - 8 * DAY), "needs_revision");
  await api(tester, "POST", "/notifications/scan");
  const hoaB = await mine(hoa, B);
  ok(hoaB.length === 1 && hoaB[0].kind === "revision_waiting", `người nộp được nhắc bổ sung hồ sơ sau 8 ngày: "${hoaB[0]?.title}"`);
  ok((await mine(tuan, B)).length === 0, "cán bộ HTX không bị nhắc thay người nộp");

  // ---- gia hạn kết quả OCOP ----
  const rec = psql(`SELECT a.code || '|' || r.id || '|' || r.valid_until FROM ocop_applications a JOIN ocop_results r ON r.application_id = a.id WHERE a.state = 'recognized' AND r.recognized AND a.owner_username = 'hoa' ORDER BY r.id DESC LIMIT 1`).split("|");
  if (rec.length === 3) {
    const [code, rid, original] = rec;
    const soon = new Date(Date.now() + 100 * DAY).toISOString().slice(0, 10);
    psql(`UPDATE ocop_results SET valid_until = '${soon}' WHERE id = ${rid}`);
    try {
      await api(tester, "POST", "/notifications/scan");
      const owner = (await mine(hoa, code)).filter((n) => n.kind === "renewal_last_call");
      const coop = (await mine(tuan, code)).filter((n) => n.kind === "renewal_last_call");
      ok(owner.length === 1 && owner[0].level === "alert" && coop.length === 1, "kết quả OCOP còn 100 ngày: nhắc gấp gia hạn tới chủ hồ sơ và cán bộ HTX");
    } finally {
      psql(`UPDATE ocop_results SET valid_until = '${original}' WHERE id = ${rid}`);
      psql(`DELETE FROM notifications WHERE dedupe_key LIKE '%:${code}:%'`);
    }
  } else {
    ok(false, "không có hồ sơ đã công nhận của hoa để thử gia hạn (chạy node scripts/seed-demo.js)");
  }

  // ---- dọn ----
  // trả mốc thời gian về hiện tại: hồ sơ thử không được ở lại trạng thái "đã chờ nhiều ngày" (bộ quét thật sẽ cứ tạo cảnh báo cho quản trị)
  psql(`UPDATE ocop_application_history SET created_at = now() WHERE application_id IN (SELECT id FROM ocop_applications WHERE code IN ('${A}', '${B}')) AND to_state IN ('in_review', 'needs_revision') AND action <> 'archive'`);
  psql(`DELETE FROM notifications WHERE dedupe_key LIKE '%${A}%' OR dedupe_key LIKE '%${B}%'`);
  ok(Number(psql(`SELECT count(*) FROM notifications WHERE dedupe_key LIKE '%${A}%' OR dedupe_key LIKE '%${B}%'`)) === 0, "đã dọn thông báo thử");
  void viewer;

  console.log(fail ? `\n${fail} KIỂM TRA THẤT BẠI` : "\nTẤT CẢ ĐẠT");
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("Lỗi:", e.message);
  process.exit(2);
});
