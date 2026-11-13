// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const ocop = require("../ocop");
const access = require("../access");
const { createFlowableClient, FlowableError } = require("../flowable");

const ROOT = path.join(__dirname, "..", "..", "..");
const CFG = ocop.loadProfiles(path.join(ROOT, "config", "ocop-profiles.json"));
const P = ocop.getProfile(CFG);
const ACC = access.load(path.join(ROOT, "config", "access.json"));

test("cấu hình OCOP của repo hợp lệ và tổng điểm các phần = 100", () => {
  assert.equal(P.id, "hanoi-2026");
  assert.equal(P.scoring.parts.reduce((s, x) => s + x.max, 0), 100);
  assert.equal(P.validityMonths, 36);
  assert.equal(P.verified, false); // phải đối chiếu văn bản gốc trước khi coi là chính xác
});

test("cấu hình sai bị từ chối", () => {
  const bad = JSON.parse(JSON.stringify(CFG));
  bad.profiles["hanoi-2026"].scoring.parts[0].max = 41;
  assert.throws(() => ocop.validateProfiles(bad), /tổng điểm/);
  assert.throws(() => ocop.validateProfiles({ defaultProfile: "x", profiles: {} }), /defaultProfile/);
  assert.throws(() => ocop.getProfile(CFG, "khong-co"), /Không có profile/);
});

test("hạng sao theo ngưỡng (biên 29.99/30, 49.99/50, 69.99/70, 89.99/90)", () => {
  const cases = [[0, 1], [29.99, 1], [30, 2], [49.99, 2], [50, 3], [69.99, 3], [70, 4], [89.99, 4], [90, 5], [100, 5]];
  for (const [score, stars] of cases) assert.equal(ocop.starsFor(P, score), stars, `điểm ${score}`);
  assert.equal(ocop.starsFor(P, 100.5), null);
  assert.equal(ocop.starsFor(P, -1), null);
});

test("chấm điểm theo phần: kiểm tra biên và kiểu dữ liệu", () => {
  assert.deepEqual(ocop.scoreTotals(P, { A: 30, B: "20", C: 25.5 }), { parts: { A: 30, B: 20, C: 25.5 }, total: 75.5 });
  assert.throws(() => ocop.scoreTotals(P, { A: 41, B: 0, C: 0 }), /phần A/);
  assert.throws(() => ocop.scoreTotals(P, { A: 1, B: -1, C: 0 }), /phần B/);
  assert.throws(() => ocop.scoreTotals(P, { A: 1, B: 1 }), /phần C/);
  assert.throws(() => ocop.scoreTotals(P, { A: "abc", B: 1, C: 1 }), /phần A/);
  assert.throws(() => ocop.scoreTotals(P, null), /phần A/);
});

test("hiệu lực 36 tháng, giữ cuối tháng khi ngày không tồn tại; cửa sổ đánh giá lại 180-120 ngày", () => {
  assert.equal(ocop.validUntil(P, "2026-08-16"), "2029-08-16");
  assert.equal(ocop.validUntil(P, "2028-02-29"), "2031-02-28");
  assert.throws(() => ocop.validUntil(P, "không phải ngày"), /không hợp lệ/);
  assert.deepEqual(ocop.renewalWindow(P, "2029-08-16"), { opens: "2029-02-17", closes: "2029-04-18" });
});

test("danh mục giấy tờ theo nhóm sản phẩm", () => {
  const keys = (g) => ocop.checklistFor(P, g).map((c) => c.key);
  assert.ok(keys("thuc-pham").includes("cong-bo-chat-luong"));
  assert.ok(!keys("thu-cong-my-nghe").includes("cong-bo-chat-luong")); // gốm không cần công bố an toàn thực phẩm
  assert.ok(keys("thu-cong-my-nghe").includes("san-pham-mau"));
  assert.ok(!keys("du-lich").includes("san-pham-mau")); // du lịch miễn sản phẩm mẫu
  const missing = ocop.missingRequired(P, "thu-cong-my-nghe", ["phieu-dang-ky", "anh-san-pham"]);
  assert.deepEqual(missing, ["bao-cao-tu-danh-gia", "giay-phep-kinh-doanh", "san-pham-mau"]);
  assert.equal(ocop.missingRequired(P, "thu-cong-my-nghe", undefined).length, 5);
});

test("cấp thẩm quyền theo hạng sao lấy từ cấu hình", () => {
  assert.match(ocop.authorityFor(P, 3), /UBND Thành phố Hà Nội/);
  assert.match(ocop.authorityFor(P, 5), /Bộ Nông nghiệp/);
  assert.equal(ocop.authorityFor(P, 2), null);
});

test("máy trạng thái: đường đi hợp lệ và bị chặn", () => {
  const ok = (s, a, ctx) => ocop.transition(s, a, ctx);
  assert.equal(ok("draft", "submit").to, "in_review");
  assert.equal(ok("needs_revision", "submit").to, "in_review");
  assert.equal(ok("in_review", "approve").to, "awaiting_result");
  assert.equal(ok("in_review", "revise").to, "needs_revision");
  assert.equal(ok("in_review", "reject").to, "rejected");
  assert.equal(ok("awaiting_result", "result", { recognized: true }).to, "recognized");
  assert.equal(ok("awaiting_result", "result", { recognized: false }).to, "not_recognized");
  // không nhảy cóc, không làm lại sau khi kết thúc
  assert.equal(ok("draft", "approve").ok, false);
  assert.equal(ok("draft", "result").ok, false);
  assert.equal(ok("in_review", "result").ok, false);
  for (const end of ["rejected", "recognized", "not_recognized"]) for (const a of Object.keys(ocop.TRANSITIONS)) assert.equal(ok(end, a).ok, false, `${end}/${a}`);
  assert.equal(ok("draft", "bay").ok, false);
});

test("mọi thao tác có quyền khai báo trong access.json; trạng thái hợp lệ khớp CHECK của migration", () => {
  for (const t of Object.values(ocop.TRANSITIONS)) assert.ok(ACC.permissions[t.permission], t.permission);
  const sql = require("node:fs").readFileSync(path.join(__dirname, "..", "migrations", "0003_ocop.sql"), "utf8");
  for (const s of ocop.STATES) assert.ok(sql.includes(`'${s}'`), `migration thiếu trạng thái ${s}`);
});

test("phân quyền hồ sơ OCOP theo ma trận", () => {
  const hoa = { name: "hoa", roles: ["producer"], coop: "htx-demo" };
  const own = { owner: "hoa", coop: "htx-demo" };
  const other = { owner: "an", coop: "htx-demo" };
  const otherCoop = { owner: "x", coop: "htx-khac" };
  assert.equal(access.authorize(ACC, hoa, "application.read", own), true);
  assert.equal(access.authorize(ACC, hoa, "application.read", other), false); // producer chỉ thấy hồ sơ của mình
  assert.equal(access.authorize(ACC, hoa, "application.review", own), false); // không tự sơ duyệt
  assert.equal(access.authorize(ACC, hoa, "application.decide", own), false); // không tự ghi kết quả chính thức
  const tuan = { name: "tuan", roles: ["coop-officer"], coop: "htx-demo" };
  assert.equal(access.authorize(ACC, tuan, "application.review", other), true);
  assert.equal(access.authorize(ACC, tuan, "application.review", otherCoop), false); // khác HTX bị chặn
  assert.equal(access.authorize(ACC, tuan, "application.decide", other), false); // HTX không ghi kết quả chính thức
  const ocopOfficer = { name: "ocop", roles: ["ocop-officer"], coop: "" };
  assert.equal(access.authorize(ACC, ocopOfficer, "application.read", otherCoop), true);
  assert.equal(access.authorize(ACC, ocopOfficer, "application.decide", otherCoop), true);
  assert.equal(access.authorize(ACC, ocopOfficer, "application.review", other), false);
  assert.equal(access.authorize(ACC, ocopOfficer, "application.create", {}), false);
  const viewer = { name: "viewer", roles: ["readonly"], coop: "" };
  for (const a of ["read", "create", "update", "review", "decide"]) assert.equal(access.authorize(ACC, viewer, `application.${a}`, own), false, a);
});

test("Flowable client: gọi đúng đường dẫn, gửi biến, báo lỗi rõ ràng", async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null, auth: init.headers.authorization });
    const ok = (obj) => ({ ok: true, status: 200, text: async () => JSON.stringify(obj) });
    if (url.includes("/runtime/process-instances")) return ok({ id: "inst-1" });
    if (url.includes("/runtime/tasks?")) return ok({ data: url.includes("missing") ? [] : [{ id: "task-9", taskDefinitionKey: "reviewByCoop", name: "HTX sơ duyệt" }] });
    return ok(null);
  };
  const fl = createFlowableClient({ baseUrl: "http://f/svc", user: "u", password: "p", fetchImpl: fakeFetch });
  assert.equal(await fl.start("OCOP-1", { applicant: "hoa" }), "inst-1");
  assert.deepEqual(calls[0].body, { processDefinitionKey: "dxosOcopSupport", businessKey: "OCOP-1", variables: [{ name: "applicant", value: "hoa" }] });
  assert.equal(calls[0].auth, "Basic " + Buffer.from("u:p").toString("base64"));
  await fl.complete("inst-1", "reviewByCoop", { decision: "approve" });
  const post = calls.at(-1);
  assert.equal(post.url, "http://f/svc/runtime/tasks/task-9");
  assert.deepEqual(post.body, { action: "complete", variables: [{ name: "decision", value: "approve" }] });
  await assert.rejects(fl.complete("missing", "reviewByCoop"), FlowableError);
  const failing = createFlowableClient({ baseUrl: "http://f", user: "u", password: "p", fetchImpl: async () => ({ ok: false, status: 500, text: async () => "boom" }) });
  await assert.rejects(failing.start("x"), /Flowable trả 500/);
  const down = createFlowableClient({ baseUrl: "http://f", user: "u", password: "p", fetchImpl: async () => { throw new Error("ECONNREFUSED"); } });
  await assert.rejects(down.start("x"), /Không gọi được Flowable/);
});
