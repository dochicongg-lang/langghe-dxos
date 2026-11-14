// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use strict";
/**
 * Tác tử theo sự kiện, có người duyệt (human-in-the-loop). Tác tử KHÔNG tự hành động: khi bộ luật phân tích mẻ nung báo "cần xem lại" hoặc
 * "cảnh báo", nó tạo một ĐỀ XUẤT kèm lý do và bằng chứng; chỉ khi một người có thẩm quyền duyệt thì hành động (gửi thông báo) mới được thực hiện.
 * Toàn bộ là hàm thuần để kiểm thử bằng dữ liệu giả.
 */

/** Đề xuất từ kết quả phân tích mẻ nung; trả null nếu không cần đề xuất (đạt chuẩn hoặc chưa đủ dữ liệu). */
function proposeFromKiln({ product, eventId, insight }) {
  if (!insight || !["warn", "alert"].includes(insight.verdict)) return null;
  const severity = insight.verdict;
  const issues = (insight.findings ?? []).filter((f) => f.level === "alert" || f.level === "warn").map((f) => f.text);
  const toCoop = product.coop ? "coop-officer" : "admin"; // sản phẩm chưa gắn HTX thì báo quản trị
  const name = product.name;
  return {
    dedupe_key: `kiln:${eventId}`,
    kind: "kiln_review",
    severity,
    title: severity === "alert" ? `Đề nghị kiểm tra gấp mẻ nung của "${name}" (${product.code})` : `Đề nghị xem lại mẻ nung của "${name}" (${product.code})`,
    rationale: `${insight.summary}${issues.length ? ` Căn cứ: ${issues.join(" ")}` : ""}`,
    subject: product.code,
    coop: product.coop ?? null,
    action: {
      type: "notify",
      for_role: toCoop,
      for_coop: product.coop ?? null,
      level: severity,
      title: severity === "alert" ? `Cần kiểm tra gấp mẻ nung ${product.code}` : `Cần xem lại mẻ nung ${product.code}`,
      body: `${insight.summary}${issues.length ? ` ${issues.join(" ")}` : ""} Đề xuất đã được người có thẩm quyền duyệt.`,
      link: `/trace/${product.code}`,
    },
  };
}

/** Chuyển một đề xuất đã được duyệt thành thông báo cần ghi (dedupe_key riêng theo mã đề xuất). */
function notificationFor(proposal) {
  const a = proposal.action;
  if (!a || a.type !== "notify") throw new Error("hành động đề xuất không được hỗ trợ");
  return { dedupe_key: `agent:${proposal.id}`, kind: "agent_kiln", level: a.level === "alert" ? "alert" : "warn", title: a.title, body: a.body, link: a.link ?? null, for_role: a.for_role, for_coop: a.for_coop ?? null, for_user: null };
}

module.exports = { proposeFromKiln, notificationFor };
