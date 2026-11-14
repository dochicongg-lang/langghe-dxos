// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { workingDaysBetween, computeReminders } = require("../reminders");

const NOW = new Date("2026-11-18T08:00:00Z"); // thứ Tư
const PROFILE = { communeReviewWorkingDays: 15, renewalWindowDays: { from: 180, to: 120 } };
const app = (o) => ({ code: "OCOP-1", product_name: "Bình gốm", owner: "hoa", coop: "htx-demo", state: "in_review", state_since: null, valid_until: null, ...o });
const daysFromNow = (n) => new Date(NOW.getTime() + n * 86_400_000);

test("ngày làm việc: bỏ thứ Bảy và Chủ nhật", () => {
  assert.equal(workingDaysBetween(new Date("2026-11-13T10:00:00Z"), new Date("2026-11-16T10:00:00Z")), 1); // thứ Sáu -> thứ Hai
  assert.equal(workingDaysBetween(new Date("2026-11-09T00:00:00Z"), new Date("2026-11-16T00:00:00Z")), 5); // một tuần
  assert.equal(workingDaysBetween(NOW, NOW), 0);
  assert.equal(workingDaysBetween(new Date("2026-11-14T00:00:00Z"), new Date("2026-11-15T00:00:00Z")), 0); // cuối tuần
});

test("sơ duyệt: chưa tới ngưỡng thì không nhắc; 12 ngày làm việc thì nhắc HTX; quá 15 thì leo thang", () => {
  assert.equal(computeReminders(NOW, [app({ state_since: new Date("2026-11-12T08:00:00Z") })], PROFILE).length, 0);
  const due = computeReminders(NOW, [app({ state_since: new Date("2026-11-02T08:00:00Z") })], PROFILE); // đúng 12 ngày làm việc
  assert.equal(due.length, 1);
  assert.deepEqual([due[0].kind, due[0].level, due[0].for_role, due[0].for_coop], ["review_due", "warn", "coop-officer", "htx-demo"]);
  assert.match(due[0].body, /Còn 3 ngày làm việc/);
  const late = computeReminders(NOW, [app({ state_since: new Date("2026-10-27T08:00:00Z") })], PROFILE); // 16 ngày làm việc
  assert.deepEqual(late.map((n) => n.for_role).sort(), ["admin", "coop-officer", "ocop-officer"]);
  assert.ok(late.every((n) => n.kind === "review_overdue" && n.level === "alert"));
  assert.equal(late.find((n) => n.for_role === "coop-officer").for_coop, "htx-demo");
  assert.equal(late.find((n) => n.for_role === "admin").for_coop, null); // quản trị thấy mọi HTX
});

test("mỗi sự việc một khóa riêng; nộp lại (mốc mới) thì có khóa mới", () => {
  const a = computeReminders(NOW, [app({ state_since: new Date("2026-10-27T08:00:00Z") })], PROFILE);
  const b = computeReminders(NOW, [app({ state_since: new Date("2026-10-27T08:00:00Z") })], PROFILE);
  assert.deepEqual(a.map((n) => n.dedupe_key), b.map((n) => n.dedupe_key)); // quét lại cho cùng khóa => cơ sở dữ liệu bỏ qua
  assert.equal(new Set(a.map((n) => n.dedupe_key)).size, a.length);
  const c = computeReminders(NOW, [app({ state_since: new Date("2026-10-26T08:00:00Z") })], PROFILE);
  assert.notEqual(c[0].dedupe_key, a[0].dedupe_key);
});

test("cần bổ sung và chờ kết quả: nhắc đúng người sau ngưỡng ngày", () => {
  assert.equal(computeReminders(NOW, [app({ state: "needs_revision", state_since: daysFromNow(-3) })], PROFILE).length, 0);
  const rev = computeReminders(NOW, [app({ state: "needs_revision", state_since: daysFromNow(-8) })], PROFILE);
  assert.deepEqual([rev[0].kind, rev[0].for_user, rev[0].for_role], ["revision_waiting", "hoa", null]);
  assert.equal(computeReminders(NOW, [app({ state: "awaiting_result", state_since: daysFromNow(-10) })], PROFILE).length, 0);
  const res = computeReminders(NOW, [app({ state: "awaiting_result", state_since: daysFromNow(-21) })], PROFILE);
  assert.deepEqual([res[0].kind, res[0].for_role], ["result_waiting", "ocop-officer"]);
});

test("gia hạn: mở cửa sổ (<=180 ngày), nhắc gấp (<=120), hết hiệu lực; gửi cho chủ hồ sơ và cán bộ HTX", () => {
  const r = (n) => computeReminders(NOW, [app({ state: "recognized", valid_until: daysFromNow(n) })], PROFILE);
  assert.equal(r(400).length, 0);
  const open = r(150);
  assert.deepEqual(open.map((n) => n.kind), ["renewal_open", "renewal_open"]);
  assert.deepEqual(open.map((n) => n.for_user ?? n.for_role).sort(), ["coop-officer", "hoa"]);
  assert.equal(open[0].level, "warn");
  assert.deepEqual([r(100)[0].kind, r(100)[0].level], ["renewal_last_call", "alert"]);
  assert.equal(r(-5)[0].kind, "result_expired");
  assert.notEqual(open[0].dedupe_key, r(100)[0].dedupe_key); // mỗi giai đoạn thông báo một lần
});

test("hồ sơ nháp, bị loại, đã kết thúc không tạo thông báo; thiếu cấu hình reminders thì dùng mặc định", () => {
  const all = ["draft", "rejected", "not_recognized"].map((state) => app({ state, state_since: new Date("2026-01-01T00:00:00Z") }));
  assert.equal(computeReminders(NOW, all, PROFILE).length, 0);
  const custom = computeReminders(NOW, [app({ state_since: new Date("2026-11-16T08:00:00Z") })], { ...PROFILE, reminders: { reviewWarnWorkingDays: 1 } });
  assert.equal(custom[0].kind, "review_due"); // ngưỡng tùy chỉnh có hiệu lực
});
