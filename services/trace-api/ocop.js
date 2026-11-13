"use strict";
/**
 * Logic thuần của quy trình hỗ trợ hồ sơ OCOP (G2): cấu hình theo địa phương, tính hạng sao, danh mục giấy tờ,
 * và máy trạng thái hồ sơ. Không đụng cơ sở dữ liệu hay mạng nên kiểm thử được trực tiếp.
 *
 * Hệ thống chỉ HỖ TRỢ và THEO DÕI. Hạng sao và quyết định chính thức do cơ quan có thẩm quyền ra,
 * cán bộ đầu mối OCOP nhập vào (action "result"); hạng sao ở bước tự chấm chỉ là DỰ KIẾN.
 */
const fs = require("node:fs");

function loadProfiles(file) {
  const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
  return validateProfiles(cfg);
}

function validateProfiles(cfg) {
  if (!cfg || typeof cfg.profiles !== "object" || !cfg.profiles[cfg.defaultProfile]) throw new Error("ocop-profiles.json: thiếu profiles hoặc defaultProfile không có thật");
  for (const [id, p] of Object.entries(cfg.profiles)) {
    const where = `ocop-profiles.json[${id}]`;
    const parts = p.scoring?.parts;
    if (!Array.isArray(parts) || !parts.length) throw new Error(`${where}: thiếu scoring.parts`);
    const sum = parts.reduce((s, x) => s + x.max, 0);
    if (sum !== p.scoring.maxTotal) throw new Error(`${where}: tổng điểm các phần (${sum}) khác maxTotal (${p.scoring.maxTotal})`);
    if (!Array.isArray(p.scoring.stars) || !p.scoring.stars.length) throw new Error(`${where}: thiếu scoring.stars`);
    if (!(p.validityMonths > 0)) throw new Error(`${where}: validityMonths phải > 0`);
    if (!Array.isArray(p.groups) || !p.groups.length) throw new Error(`${where}: thiếu groups`);
    if (!Array.isArray(p.checklist)) throw new Error(`${where}: thiếu checklist`);
  }
  return cfg;
}

function getProfile(cfg, id) {
  const key = id ?? cfg.defaultProfile;
  const p = cfg.profiles[key];
  if (!p) throw new Error(`Không có profile OCOP "${key}"`);
  return { id: key, ...p };
}

/** Kiểm tra điểm tự chấm theo từng phần; trả về { parts, total } đã làm tròn 2 chữ số. Ném Error có thông báo tiếng Việt. */
function scoreTotals(profile, input) {
  const parts = {};
  let total = 0;
  for (const part of profile.scoring.parts) {
    const raw = input?.[part.key];
    const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
    if (!Number.isFinite(n) || n < 0 || n > part.max) throw new Error(`Điểm phần ${part.key} (${part.label}) phải từ 0 đến ${part.max}`);
    parts[part.key] = Math.round(n * 100) / 100;
    total += parts[part.key];
  }
  return { parts, total: Math.round(total * 100) / 100 };
}

/** Hạng sao ứng với tổng điểm theo ngưỡng của profile; null nếu điểm ngoài mọi khoảng. */
function starsFor(profile, total) {
  const hit = profile.scoring.stars.find((s) => total >= s.min && total <= s.max);
  return hit ? hit.stars : null;
}

/** Cấp thẩm quyền theo hạng sao: chuỗi mô tả lấy từ profile (không ghi cứng "huyện/tỉnh"). */
function authorityFor(profile, stars) {
  const s = profile.scoring.stars.find((x) => x.stars === stars);
  if (!s || s.level === "khong-cong-nhan") return null;
  return s.level === "quoc-gia" ? profile.authority.star5 : profile.authority.star3and4;
}

/** Ngày hết hạn = ngày quyết định + validityMonths tháng (cộng theo lịch, giữ cuối tháng nếu ngày không tồn tại). */
function validUntil(profile, decidedAt) {
  const d = new Date(decidedAt);
  if (Number.isNaN(d.getTime())) throw new Error("Ngày quyết định không hợp lệ");
  const day = d.getUTCDate();
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + profile.validityMonths, 1));
  const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, last));
  return out.toISOString().slice(0, 10);
}

/** Cửa sổ nộp hồ sơ đánh giá lại: từ (hết hạn - from ngày) đến (hết hạn - to ngày). */
function renewalWindow(profile, validUntilDate) {
  const end = new Date(`${validUntilDate}T00:00:00Z`);
  const shift = (days) => new Date(end.getTime() - days * 86400000).toISOString().slice(0, 10);
  return { opens: shift(profile.renewalWindowDays.from), closes: shift(profile.renewalWindowDays.to) };
}

/** Danh mục giấy tờ áp dụng cho một nhóm sản phẩm. */
function checklistFor(profile, group) {
  return profile.checklist.filter((c) => (!c.onlyGroups || c.onlyGroups.includes(group)) && !(c.exceptGroups && c.exceptGroups.includes(group)));
}

/** Giấy tờ BẮT BUỘC mà hồ sơ chưa đánh dấu là đã có. */
function missingRequired(profile, group, have) {
  const set = new Set(Array.isArray(have) ? have : []);
  return checklistFor(profile, group).filter((c) => c.required && !set.has(c.key)).map((c) => c.key);
}

// ---------- Máy trạng thái hồ sơ ----------
// draft           Nháp (người nộp đang lập)
// in_review       Chờ HTX sơ duyệt
// needs_revision  HTX yêu cầu bổ sung (trả về người nộp)
// awaiting_result Đã sơ duyệt đạt, chờ cơ quan có thẩm quyền ra kết quả chính thức
// rejected        HTX không đạt sơ duyệt (kết thúc)
// recognized      Cơ quan có thẩm quyền công nhận (đủ sao tối thiểu)
// not_recognized  Cơ quan có thẩm quyền không công nhận (kết thúc)
const STATES = ["draft", "in_review", "needs_revision", "awaiting_result", "rejected", "recognized", "not_recognized"];

// action -> { từ trạng thái -> sang trạng thái, quyền cần có }
const TRANSITIONS = {
  submit: { from: ["draft", "needs_revision"], to: () => "in_review", permission: "application.update", task: null },
  approve: { from: ["in_review"], to: () => "awaiting_result", permission: "application.review", task: "reviewByCoop", decision: "approve" },
  revise: { from: ["in_review"], to: () => "needs_revision", permission: "application.review", task: "reviewByCoop", decision: "revise" },
  reject: { from: ["in_review"], to: () => "rejected", permission: "application.review", task: "reviewByCoop", decision: "reject" },
  result: { from: ["awaiting_result"], to: (ctx) => (ctx.recognized ? "recognized" : "not_recognized"), permission: "application.decide", task: "officialResult" },
};

function transition(state, action, ctx = {}) {
  const t = TRANSITIONS[action];
  if (!t) return { ok: false, error: `Thao tác không hợp lệ: ${action}` };
  if (!t.from.includes(state)) return { ok: false, error: `Không thể "${action}" khi hồ sơ đang ở trạng thái "${state}"` };
  return { ok: true, to: t.to(ctx), permission: t.permission, task: t.task, decision: t.decision };
}

/** Thao tác khả dụng ở một trạng thái (giao diện dùng để ẩn/hiện; máy chủ luôn kiểm tra lại). */
function actionsFrom(state) {
  return Object.entries(TRANSITIONS).filter(([, t]) => t.from.includes(state)).map(([a]) => a);
}

module.exports = {
  STATES, TRANSITIONS, loadProfiles, validateProfiles, getProfile, scoreTotals, starsFor, authorityFor,
  validUntil, renewalWindow, checklistFor, missingRequired, transition, actionsFrom,
};
