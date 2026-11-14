// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use strict";
/**
 * Nhắc hạn, leo thang và nhắc gia hạn cho hồ sơ OCOP. Toàn bộ là hàm THUẦN (không đụng cơ sở dữ liệu), nên kiểm thử được bằng dữ liệu giả.
 * Hạn lấy từ cấu hình theo địa phương (config/ocop-profiles.json): communeReviewWorkingDays (hạn HTX sơ duyệt, ngày làm việc),
 * validityMonths/renewalWindowDays (gia hạn), và khối "reminders" (ngưỡng nhắc; có giá trị mặc định nếu thiếu).
 * Ngày làm việc ở đây chỉ trừ thứ Bảy và Chủ nhật, KHÔNG trừ ngày lễ (chưa có lịch nghỉ lễ trong hệ thống).
 */
const DAY = 86_400_000;
const DEFAULTS = { reviewWarnWorkingDays: 12, revisionReminderDays: 7, awaitingResultReminderDays: 20 };

/** Số ngày làm việc (thứ Hai đến thứ Sáu) đã trôi qua kể từ `from` tới `to`, tính theo ngày UTC. */
function workingDaysBetween(from, to) {
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  let n = 0;
  for (let t = start + DAY; t <= end; t += DAY) {
    const d = new Date(t).getUTCDay();
    if (d !== 0 && d !== 6) n++;
  }
  return n;
}

const daysBetween = (from, to) => Math.floor((to.getTime() - from.getTime()) / DAY);
const iso = (d) => new Date(d).toISOString();
const isoDay = (d) => new Date(d).toISOString().slice(0, 10);

/**
 * apps: [{ code, product_name, owner, coop, state, state_since: Date, valid_until: Date|null }]
 * Trả về danh sách thông báo cần có: { dedupe_key, kind, level, title, body, link, for_user, for_role, for_coop }.
 */
function computeReminders(now, apps, profile) {
  const cfg = { ...DEFAULTS, ...(profile.reminders ?? {}) };
  const limit = profile.communeReviewWorkingDays;
  const window = profile.renewalWindowDays ?? { from: 180, to: 120 };
  const out = [];
  const add = (n) => out.push({ link: `/ocop/${n.code}`, for_user: null, for_role: null, for_coop: null, ...n });
  for (const a of apps) {
    const name = `"${a.product_name}" (${a.code})`;
    const since = a.state_since ? new Date(a.state_since) : null;
    if (a.state === "in_review" && since) {
      const wd = workingDaysBetween(since, now);
      if (wd > limit) {
        const t = `Quá hạn sơ duyệt hồ sơ ${a.code}`;
        const b = `Hồ sơ ${name} đã chờ sơ duyệt ${wd} ngày làm việc, vượt hạn ${limit} ngày.`;
        add({ code: a.code, kind: "review_overdue", level: "alert", title: t, body: b, for_role: "coop-officer", for_coop: a.coop, dedupe_key: `review_overdue:${a.code}:${iso(since)}:coop-officer` });
        add({ code: a.code, kind: "review_overdue", level: "alert", title: t, body: `${b} Đề nghị đôn đốc hợp tác xã.`, for_role: "admin", dedupe_key: `review_overdue:${a.code}:${iso(since)}:admin` });
        add({ code: a.code, kind: "review_overdue", level: "alert", title: t, body: `${b} Hồ sơ đang ở bước HTX, chưa tới cơ quan có thẩm quyền.`, for_role: "ocop-officer", dedupe_key: `review_overdue:${a.code}:${iso(since)}:ocop-officer` });
      } else if (wd >= cfg.reviewWarnWorkingDays) {
        add({
          code: a.code,
          kind: "review_due",
          level: "warn",
          title: `Sắp hết hạn sơ duyệt hồ sơ ${a.code}`,
          body: `Hồ sơ ${name} đã chờ sơ duyệt ${wd}/${limit} ngày làm việc. Còn ${limit - wd} ngày làm việc.`,
          for_role: "coop-officer",
          for_coop: a.coop,
          dedupe_key: `review_due:${a.code}:${iso(since)}`,
        });
      }
    }
    if (a.state === "needs_revision" && since && daysBetween(since, now) >= cfg.revisionReminderDays) {
      add({
        code: a.code,
        kind: "revision_waiting",
        level: "warn",
        title: `Hồ sơ ${a.code} đang chờ bạn bổ sung`,
        body: `HTX đã yêu cầu bổ sung hồ sơ ${name} từ ${daysBetween(since, now)} ngày trước. Hãy bổ sung và nộp lại.`,
        for_user: a.owner,
        dedupe_key: `revision_waiting:${a.code}:${iso(since)}`,
      });
    }
    if (a.state === "awaiting_result" && since && daysBetween(since, now) >= cfg.awaitingResultReminderDays) {
      add({
        code: a.code,
        kind: "result_waiting",
        level: "warn",
        title: `Hồ sơ ${a.code} chờ ghi kết quả chính thức`,
        body: `Hồ sơ ${name} đã sơ duyệt đạt ${daysBetween(since, now)} ngày trước, chưa có kết quả chính thức.`,
        for_role: "ocop-officer",
        dedupe_key: `result_waiting:${a.code}:${iso(since)}`,
      });
    }
    if (a.state === "recognized" && a.valid_until) {
      const until = new Date(a.valid_until);
      const left = Math.ceil((until.getTime() - now.getTime()) / DAY);
      const tag = isoDay(until);
      let kind = null;
      let level = "warn";
      let title = "";
      let body = "";
      if (left <= 0) {
        kind = "result_expired";
        level = "alert";
        title = `Kết quả OCOP của ${a.code} đã hết hiệu lực`;
        body = `Kết quả OCOP của ${name} đã hết hiệu lực từ ${tag}. Cần làm hồ sơ mới.`;
      } else if (left <= window.to) {
        kind = "renewal_last_call";
        level = "alert";
        title = `Gấp: kết quả OCOP của ${a.code} sắp hết hiệu lực`;
        body = `Kết quả OCOP của ${name} còn ${left} ngày (hết hiệu lực ${tag}), đã qua thời điểm nên bắt đầu gia hạn.`;
      } else if (left <= window.from) {
        kind = "renewal_open";
        title = `Đến lúc chuẩn bị gia hạn OCOP cho ${a.code}`;
        body = `Kết quả OCOP của ${name} còn ${left} ngày (hết hiệu lực ${tag}). Nên bắt đầu chuẩn bị hồ sơ gia hạn.`;
      }
      if (kind) {
        add({ code: a.code, kind, level, title, body, for_user: a.owner, dedupe_key: `${kind}:${a.code}:${tag}:owner` });
        add({ code: a.code, kind, level, title, body, for_role: "coop-officer", for_coop: a.coop, dedupe_key: `${kind}:${a.code}:${tag}:coop-officer` });
      }
    }
  }
  return out;
}

module.exports = { DEFAULTS, workingDaysBetween, daysBetween, computeReminders };
