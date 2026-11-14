// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use strict";
/**
 * Tổng quan điều hành cho cán bộ HTX và cán bộ OCOP: gom số liệu đã có (hồ sơ, mẻ nung/nhuộm, kết quả OCOP) trong PHẠM VI quyền của người xem.
 * Hàm thuần, không đụng CSDL: máy chủ truyền dữ liệu đã lọc theo phạm vi vào đây. Không trả tên người nộp; bảng so sánh HTX chỉ có con số.
 */
const reminders = require("./reminders");

const DAY = 86_400_000;
const STATES = ["draft", "in_review", "needs_revision", "awaiting_result", "rejected", "recognized", "not_recognized"];
const RECENT_DAYS = 90;
const MAX_WAITING = 50;

const zeroVerdicts = () => ({ ok: 0, warn: 0, alert: 0, insufficient: 0 });

/**
 * apps: [{ code, product_name, coop, state, state_since }]
 * runs: [{ coop, sector, verdict, at }]  (at = thời điểm mẻ kết thúc)
 * renewals: [{ code, product_name, coop, valid_until }]
 * scope: "all" | "coop"  (chỉ scope "all" mới có bảng so sánh các HTX)
 */
function buildOverview({ now = new Date(), scope, profile, apps = [], runs = [], renewals = [] }) {
  const cfg = { reviewWarnWorkingDays: 12, revisionReminderDays: 7, awaitingResultReminderDays: 20, ...(profile?.reminders ?? {}) };
  const limit = profile?.communeReviewWorkingDays ?? 15;
  const window = profile?.renewalWindowDays?.from ?? 180;

  const funnel = Object.fromEntries(STATES.map((s) => [s, 0]));
  const waiting = [];
  for (const a of apps) {
    if (a.state in funnel) funnel[a.state] += 1;
    const since = a.state_since ? new Date(a.state_since) : null;
    if (!since) continue;
    const calDays = Math.floor((now.getTime() - since.getTime()) / DAY);
    let item = null;
    if (a.state === "in_review") {
      const wd = reminders.workingDaysBetween(since, now);
      if (wd > limit) item = { level: "late", days: wd, unit: "ngày làm việc", text: `Quá hạn sơ duyệt (hạn ${limit} ngày làm việc)` };
      else if (wd >= cfg.reviewWarnWorkingDays) item = { level: "soon", days: wd, unit: "ngày làm việc", text: `Sắp hết hạn sơ duyệt (hạn ${limit} ngày làm việc)` };
    } else if (a.state === "needs_revision" && calDays >= cfg.revisionReminderDays) {
      item = { level: "waiting", days: calDays, unit: "ngày", text: "Chờ người nộp bổ sung hồ sơ" };
    } else if (a.state === "awaiting_result" && calDays >= cfg.awaitingResultReminderDays) {
      item = { level: "waiting", days: calDays, unit: "ngày", text: "Chờ cơ quan có thẩm quyền ra kết quả" };
    }
    if (item) waiting.push({ code: a.code, name: a.product_name, coop: a.coop ?? null, state: a.state, ...item });
  }
  const rank = { late: 0, soon: 1, waiting: 2 };
  waiting.sort((x, y) => rank[x.level] - rank[y.level] || y.days - x.days);

  const since = now.getTime() - RECENT_DAYS * DAY;
  const recent = runs.filter((r) => new Date(r.at).getTime() >= since);
  const quality = { days: RECENT_DAYS, total: recent.length, byVerdict: zeroVerdicts(), bySector: {} };
  for (const r of recent) {
    if (r.verdict in quality.byVerdict) quality.byVerdict[r.verdict] += 1;
    const s = (quality.bySector[r.sector] ??= { ...zeroVerdicts(), total: 0 });
    if (r.verdict in s) s[r.verdict] += 1;
    s.total += 1;
  }

  const renew = renewals
    .map((x) => ({ code: x.code, name: x.product_name, coop: x.coop ?? null, valid_until: x.valid_until, daysLeft: Math.floor((new Date(x.valid_until).getTime() - now.getTime()) / DAY) }))
    .filter((x) => x.daysLeft <= window)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  let coops = null;
  if (scope === "all") {
    const map = new Map();
    const row = (c) => map.get(c ?? "") ?? map.set(c ?? "", { coop: c ?? null, apps: 0, recognized: 0, late: 0, runs: 0, attention: 0 }).get(c ?? "");
    for (const a of apps) {
      const r = row(a.coop);
      r.apps += 1;
      if (a.state === "recognized") r.recognized += 1;
    }
    for (const w of waiting) if (w.level === "late") row(w.coop).late += 1;
    for (const r of recent) {
      const c = row(r.coop);
      c.runs += 1;
      if (r.verdict === "warn" || r.verdict === "alert") c.attention += 1;
    }
    coops = [...map.values()].sort((a, b) => b.apps - a.apps || String(a.coop).localeCompare(String(b.coop)));
  }

  return { scope, funnel, totalApps: apps.length, waiting: waiting.slice(0, MAX_WAITING), waitingTotal: waiting.length, quality, renewals: renew, coops, limits: { reviewWorkingDays: limit, reviewWarnWorkingDays: cfg.reviewWarnWorkingDays, renewalWindowDays: window } };
}

module.exports = { buildOverview };
