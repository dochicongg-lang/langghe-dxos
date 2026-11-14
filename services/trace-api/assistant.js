// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use strict";
/**
 * Trợ lý hỏi đáp dựa trên TRA CỨU (retrieval), không sinh văn bản tự do.
 *
 * Kho tri thức được dựng từ chính cấu hình của hệ thống: quy định OCOP theo địa phương (điểm, hạng sao, giấy tờ theo nhóm, thời hạn,
 * hiệu lực), hồ sơ nung (ngưỡng), vai trò (config/access.json) và các đoạn hướng dẫn viết tay (config/assistant-faq.json). Câu hỏi được
 * xếp hạng bằng BM25 (bỏ dấu tiếng Việt khi so khớp, nên gõ không dấu vẫn tìm được) và trả lời bằng cách TRÍCH nguyên đoạn phù hợp nhất
 * kèm nguồn. Không đủ độ phù hợp thì nói rõ là chưa có thông tin, không đoán. Vì đọc từ cấu hình nên số liệu luôn khớp hệ thống đang chạy.
 */
const fs = require("node:fs");

const STOP = new Set(
  "la va cua cho co cac mot nhung duoc bao nhieu gi the nao toi ban phai khi nhu o tai de hay thi se da dang voi trong ra vao lam hoi xin vui long ma neu thay".split(" "),
);

// Lưu ý: "cán" (cán bộ) và "cần" đều thành "can" khi bỏ dấu nên "can" KHÔNG nằm trong danh sách từ bị loại.
const ROLE_NAMES = { admin: "Quản trị", producer: "Chủ thể sản xuất", "coop-officer": "Cán bộ HTX", "ocop-officer": "Cán bộ đầu mối OCOP", readonly: "Chỉ xem", "iot-writer": "Thiết bị IoT" };

/** Bỏ dấu tiếng Việt và đưa về chữ thường để so khớp không phụ thuộc cách gõ. */
const fold = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");
const tokens = (s) => fold(s).split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOP.has(t));

/** Dựng các đoạn tri thức: [{ id, title, text, ref }] từ cấu hình đã nạp. */
function buildKnowledge({ profile, kilnCfg, accessCfg, faq }) {
  const chunks = [];
  const add = (id, title, text, ref) => chunks.push({ id, title, text, ref });
  const p = profile;
  const ref = "quy định OCOP";

  const parts = p.scoring.parts.map((x) => `${x.label} (${x.key}) tối đa ${x.max} điểm`).join("; ");
  const stars = [...p.scoring.stars]
    .sort((a, b) => b.stars - a.stars)
    .map((s) => `${s.stars} sao từ ${s.min} đến ${s.max >= p.scoring.maxTotal ? p.scoring.maxTotal : Math.floor(s.max)} điểm`)
    .join("; ");
  add("diem-sao", "Cách tính điểm và hạng sao OCOP", `Tổng điểm tối đa ${p.scoring.maxTotal}, gồm ${parts}. Hạng sao theo điểm: ${stars}. Từ ${p.scoring.minStarsRecognized} sao trở lên mới được công nhận. Người nộp tự chấm chỉ là điểm dự kiến; điểm và hạng sao chính thức do cơ quan có thẩm quyền quyết định.`, ref);

  add("hieu-luc", "Thời hạn hiệu lực và gia hạn kết quả OCOP", `Kết quả OCOP có hiệu lực ${p.validityMonths} tháng kể từ ngày quyết định. Cửa sổ gia hạn bắt đầu khi còn ${p.renewalWindowDays.from} ngày và nhắc gấp khi còn ${p.renewalWindowDays.to} ngày trước khi hết hiệu lực.`, ref);

  const rounds = (p.rounds ?? []).map((r) => `${r.name}: nộp trước ngày ${r.submitBefore}, hoàn tất trước ngày ${r.completeBefore}`).join("; ");
  add("han-xu-ly", "Hạn xử lý hồ sơ và các đợt đánh giá", `Hợp tác xã (cấp xã) sơ duyệt hồ sơ trong ${p.communeReviewWorkingDays} ngày làm việc kể từ khi nhận hồ sơ; hệ thống nhắc khi gần hạn và báo quản trị khi quá hạn. Các đợt đánh giá trong năm: ${rounds}.`, ref);

  const auth = p.authority ?? {};
  add("co-quan", "Cơ quan có thẩm quyền quyết định", `Cơ quan thường trực: ${auth.coordinatingOffice ?? ""}. Hội đồng: ${auth.council ?? ""}. Quyết định hạng 3 và 4 sao: ${auth.star3and4 ?? ""}. Hạng 5 sao: ${auth.star5 ?? ""}.`, ref);
  add("doi-tuong", "Đối tượng được tham gia OCOP", `Chủ thể được tham gia: ${p.subjectTypes.join("; ")}. Nhóm sản phẩm: ${p.groups.map((g) => g.label).join("; ")}.`, ref);

  const att = p.attachments;
  add("tep-dinh-kem", "Tệp đính kèm hồ sơ", `Mỗi tệp tối đa ${Math.floor(att.maxBytes / 1024 / 1024)} MB, mỗi hồ sơ tối đa ${att.maxPerApplication} tệp, định dạng được nhận: ảnh JPEG, PNG, WEBP hoặc PDF. Hệ thống kiểm tra nội dung thật của tệp và quét mã độc trước khi lưu.`, "quy định OCOP");

  for (const g of p.groups) {
    const items = p.checklist.filter((c) => (!c.onlyGroups || c.onlyGroups.includes(g.key)) && !(c.exceptGroups && c.exceptGroups.includes(g.key)));
    const need = items.filter((c) => c.required).map((c) => c.label);
    const opt = items.filter((c) => !c.required).map((c) => c.label);
    add(`giay-to-${g.key}`, `Giấy tờ cần có cho nhóm ${g.label}`, `Hồ sơ nhóm ${g.label} cần các giấy tờ bắt buộc: ${need.join("; ")}.${opt.length ? ` Giấy tờ không bắt buộc: ${opt.join("; ")}.` : ""}`, ref);
  }

  for (const [id, k] of Object.entries(kilnCfg.profiles ?? {})) {
    add(`nung-${id}`, `Ngưỡng của ${k.terms?.profile ?? "hồ sơ nung"} ${k.name}`, `Đỉnh nhiệt chuẩn từ ${k.peak.min} đến ${k.peak.max} độ C, ngưỡng nguy hiểm trên ${k.criticalMax} độ C. Giữ trên ${k.hold.aboveC} độ C ít nhất ${k.hold.minMinutes} phút. Gia nhiệt tối đa ${k.ramp.maxPerHour} độ C mỗi giờ (tính từ ${k.ramp.fromC} độ C, cửa sổ ${k.ramp.windowMin} phút). Làm nguội tối đa ${k.cooling.maxPerHour} độ C mỗi giờ (từ ${k.cooling.fromC} xuống ${k.cooling.toC} độ C). Cần tối thiểu ${k.minSamples} mẫu đo.`, `quy định phân tích ${k.terms?.batch ?? "mẻ nung"}`);
  }

  for (const [role, def] of Object.entries(accessCfg.roles ?? {})) {
    if (def.alias) continue; // bí danh tạm
    add(`vai-tro-${role}`, `Vai trò ${ROLE_NAMES[role] ?? role}`, `${def.desc}.`, "phân quyền theo vai trò");
  }

  for (const e of faq.entries ?? []) add(`faq-${e.id}`, e.title, e.text, "hướng dẫn sử dụng");
  return chunks;
}

/** Dựng chỉ mục BM25 (tiêu đề được tính hai lần để ưu tiên khớp tiêu đề). */
function buildIndex(chunks) {
  const docs = chunks.map((c) => {
    const toks = [...tokens(c.title), ...tokens(c.title), ...tokens(c.text)];
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    return { chunk: c, tf, len: toks.length || 1 };
  });
  const df = new Map();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const avg = docs.reduce((s, d) => s + d.len, 0) / (docs.length || 1);
  return { docs, df, avg, n: docs.length };
}

const K1 = 1.5;
const B = 0.75;

const idfOf = (index, t) => Math.log(1 + (index.n - (index.df.get(t) ?? 0) + 0.5) / ((index.df.get(t) ?? 0) + 0.5));

/** Điểm BM25 của một đoạn và tỉ lệ khớp có TRỌNG SỐ theo độ hiếm của từ (từ chưa từng có trong kho tri thức tính là rất hiếm). */
function score(index, d, qt) {
  let s = 0;
  let hit = 0;
  let total = 0;
  for (const t of qt) {
    const idf = idfOf(index, t);
    total += idf;
    const f = d.tf.get(t);
    if (!f) continue;
    hit += idf;
    s += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.len) / index.avg)));
  }
  return { s, coverage: total ? hit / total : 0 };
}

/**
 * Trả lời một câu hỏi: { matched, answer, sources: [{ title, ref }] }. matched=false khi không đủ độ phù hợp (không đoán).
 * Điều kiện phù hợp: các từ khớp phải chiếm ít nhất một nửa "trọng lượng" của câu hỏi, trong đó từ càng hiếm trọng lượng càng lớn,
 * nên từ lạ (không có trong kho tri thức) làm câu hỏi bị từ chối thay vì khớp nhầm bằng các từ thông dụng.
 */
function ask(index, question) {
  const q = String(question ?? "").slice(0, 300);
  const qt = [...new Set(tokens(q))];
  if (qt.length === 0) return { matched: false, answer: "Bạn hãy nêu rõ hơn câu hỏi (ví dụ: \"hồ sơ OCOP nhóm thủ công cần giấy tờ gì\").", sources: [] };
  const ranked = index.docs
    .map((d) => ({ d, ...score(index, d, qt) }))
    .filter((x) => x.coverage >= 0.5)
    .sort((a, b) => b.s - a.s);
  if (ranked.length === 0) {
    return { matched: false, referral: true, answer: "Tôi chưa tìm thấy thông tin phù hợp trong quy định và hướng dẫn của hệ thống nên không trả lời để tránh đoán sai. Bạn thử hỏi cách khác, hoặc hỏi trực tiếp người có thẩm quyền như gợi ý bên dưới.", sources: [] };
  }
  const top = ranked[0];
  const picks = [top, ...ranked.slice(1, 3).filter((x) => x.s >= top.s * 0.6)];
  return {
    matched: true,
    answer: top.d.chunk.text,
    related: picks.slice(1).map((x) => ({ title: x.d.chunk.title, text: x.d.chunk.text })),
    sources: picks.map((x) => ({ title: x.d.chunk.title, ref: x.d.chunk.ref })),
  };
}

function loadFaq(file) {
  const faq = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(faq.entries) || faq.entries.some((e) => !e.id || !e.title || !e.text)) throw new Error("assistant-faq.json: mỗi mục cần id, title, text");
  if (new Set(faq.entries.map((e) => e.id)).size !== faq.entries.length) throw new Error("assistant-faq.json: id bị trùng");
  return faq;
}

module.exports = { fold, tokens, buildKnowledge, buildIndex, ask, loadFaq };
