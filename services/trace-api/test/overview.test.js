// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildOverview } = require("../overview");

const NOW = new Date("2026-11-16T08:00:00Z"); // thứ Hai
const DAY = 86_400_000;
const ago = (d) => new Date(NOW.getTime() - d * DAY).toISOString();
const PROFILE = { communeReviewWorkingDays: 15, reminders: { reviewWarnWorkingDays: 12, revisionReminderDays: 7, awaitingResultReminderDays: 20 }, renewalWindowDays: { from: 180, to: 120 } };

test("phễu hồ sơ đếm đúng theo trạng thái", () => {
  const o = buildOverview({ now: NOW, scope: "all", profile: PROFILE, apps: [{ code: "A", state: "draft" }, { code: "B", state: "draft" }, { code: "C", state: "recognized" }, { code: "D", state: "in_review" }] });
  assert.equal(o.funnel.draft, 2);
  assert.equal(o.funnel.recognized, 1);
  assert.equal(o.funnel.in_review, 1);
  assert.equal(o.totalApps, 4);
});

test("hồ sơ chờ lâu: quá hạn, sắp hạn, chờ bổ sung, chờ kết quả; hồ sơ mới thì không tính", () => {
  const apps = [
    { code: "LATE", product_name: "Quá hạn", coop: "x", state: "in_review", state_since: ago(28) }, // 20 ngày làm việc
    { code: "SOON", product_name: "Sắp hạn", coop: "x", state: "in_review", state_since: ago(18) }, // 12-13 ngày làm việc
    { code: "NEW", product_name: "Mới", coop: "x", state: "in_review", state_since: ago(3) },
    { code: "REV", product_name: "Bổ sung", coop: "x", state: "needs_revision", state_since: ago(10) },
    { code: "RES", product_name: "Chờ kết quả", coop: "x", state: "awaiting_result", state_since: ago(25) },
    { code: "RES2", product_name: "Chờ chưa lâu", coop: "x", state: "awaiting_result", state_since: ago(5) },
  ];
  const o = buildOverview({ now: NOW, scope: "all", profile: PROFILE, apps });
  const by = Object.fromEntries(o.waiting.map((w) => [w.code, w]));
  assert.equal(by.LATE.level, "late");
  assert.equal(by.SOON.level, "soon");
  assert.equal(by.REV.level, "waiting");
  assert.equal(by.RES.level, "waiting");
  assert.equal(by.NEW, undefined);
  assert.equal(by.RES2, undefined);
  assert.deepEqual(o.waiting.map((w) => w.code).slice(0, 2), ["LATE", "SOON"], "quá hạn xếp trước, rồi sắp hạn");
  assert.equal(o.waitingTotal, 4);
});

test("chất lượng mẻ: chỉ tính 90 ngày gần nhất, tách theo nghề", () => {
  const runs = [
    { coop: "a", sector: "gom", verdict: "ok", at: ago(10) },
    { coop: "a", sector: "gom", verdict: "warn", at: ago(20) },
    { coop: "b", sector: "lua", verdict: "alert", at: ago(30) },
    { coop: "b", sector: "lua", verdict: "ok", at: ago(200) }, // quá cũ
  ];
  const o = buildOverview({ now: NOW, scope: "all", profile: PROFILE, runs });
  assert.equal(o.quality.total, 3);
  assert.deepEqual(o.quality.byVerdict, { ok: 1, warn: 1, alert: 1, insufficient: 0 });
  assert.equal(o.quality.bySector.gom.total, 2);
  assert.equal(o.quality.bySector.lua.alert, 1);
});

test("kết quả sắp hết hiệu lực: trong cửa sổ 180 ngày, đã hết hạn cũng có, xếp gần hạn nhất trước", () => {
  const d = (n) => new Date(NOW.getTime() + n * DAY).toISOString().slice(0, 10);
  const renewals = [
    { code: "FAR", product_name: "Còn lâu", valid_until: d(400) },
    { code: "NEAR", product_name: "Sắp hết", valid_until: d(100) },
    { code: "GONE", product_name: "Đã hết", valid_until: d(-5) },
  ];
  const o = buildOverview({ now: NOW, scope: "all", profile: PROFILE, renewals });
  assert.deepEqual(o.renewals.map((r) => r.code), ["GONE", "NEAR"]);
  assert.ok(o.renewals[0].daysLeft < 0);
});

test("bảng so sánh HTX chỉ có ở phạm vi all, chỉ chứa con số", () => {
  const apps = [
    { code: "1", coop: "htx-demo", state: "recognized", product_name: "A", owner: "hoa" },
    { code: "2", coop: "htx-lua", state: "in_review", product_name: "B", state_since: ago(28), owner: "lua" },
  ];
  const runs = [{ coop: "htx-demo", sector: "gom", verdict: "alert", at: ago(5) }];
  const all = buildOverview({ now: NOW, scope: "all", profile: PROFILE, apps, runs });
  assert.equal(all.coops.length, 2);
  const demo = all.coops.find((c) => c.coop === "htx-demo");
  assert.deepEqual({ apps: demo.apps, recognized: demo.recognized, runs: demo.runs, attention: demo.attention }, { apps: 1, recognized: 1, runs: 1, attention: 1 });
  assert.equal(all.coops.find((c) => c.coop === "htx-lua").late, 1);
  for (const c of all.coops) assert.deepEqual(Object.keys(c).sort(), ["apps", "attention", "coop", "late", "recognized", "runs"]);
  assert.equal(buildOverview({ now: NOW, scope: "coop", profile: PROFILE, apps, runs }).coops, null);
});

test("không rò tên người nộp ra kết quả", () => {
  const apps = [{ code: "1", coop: "c", state: "in_review", product_name: "A", owner: "nguoi-bi-mat", state_since: ago(40) }];
  const text = JSON.stringify(buildOverview({ now: NOW, scope: "all", profile: PROFILE, apps }));
  assert.ok(!text.includes("nguoi-bi-mat"));
});
