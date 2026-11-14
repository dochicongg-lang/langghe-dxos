// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { proposeFromKiln, notificationFor } = require("../agent");

const product = { code: "GOM-BT-0002", name: "Bình gốm men lam", coop: "htx-demo" };
const insight = (verdict, findings = []) => ({ verdict, summary: `Kết luận ${verdict}.`, findings });

test("chỉ đề xuất khi kết luận là cần xem lại hoặc cảnh báo", () => {
  assert.equal(proposeFromKiln({ product, eventId: 1, insight: insight("ok") }), null);
  assert.equal(proposeFromKiln({ product, eventId: 1, insight: insight("insufficient") }), null);
  assert.equal(proposeFromKiln({ product, eventId: 1, insight: null }), null);
  assert.equal(proposeFromKiln({ product, eventId: 1, insight: insight("warn") }).severity, "warn");
  assert.equal(proposeFromKiln({ product, eventId: 1, insight: insight("alert") }).severity, "alert");
});

test("đề xuất nêu lý do kèm căn cứ, đối tượng, người nhận và khóa chống trùng theo sự kiện", () => {
  const p = proposeFromKiln({ product, eventId: 7, insight: insight("alert", [{ level: "alert", text: "Đỉnh nhiệt 1321 độ C vượt ngưỡng." }, { level: "ok", text: "Giữ nhiệt đủ." }, { level: "warn", text: "Gia nhiệt hơi nhanh." }]) });
  assert.equal(p.dedupe_key, "kiln:7");
  assert.equal(p.kind, "kiln_review");
  assert.equal(p.subject, "GOM-BT-0002");
  assert.equal(p.coop, "htx-demo");
  assert.match(p.title, /kiểm tra gấp/);
  assert.match(p.rationale, /Đỉnh nhiệt 1321/);
  assert.match(p.rationale, /Gia nhiệt hơi nhanh/);
  assert.ok(!p.rationale.includes("Giữ nhiệt đủ")); // chỉ nêu các phát hiện đáng chú ý
  assert.deepEqual([p.action.type, p.action.for_role, p.action.for_coop, p.action.level, p.action.link], ["notify", "coop-officer", "htx-demo", "alert", "/trace/GOM-BT-0002"]);
  assert.notEqual(proposeFromKiln({ product, eventId: 8, insight: insight("alert") }).dedupe_key, p.dedupe_key);
});

test("sản phẩm chưa gắn HTX thì báo cho quản trị; mức warn dùng lời lẽ nhẹ hơn", () => {
  const p = proposeFromKiln({ product: { ...product, coop: null }, eventId: 2, insight: insight("warn") });
  assert.deepEqual([p.action.for_role, p.action.for_coop, p.coop], ["admin", null, null]);
  assert.match(p.title, /xem lại/);
  assert.doesNotMatch(p.title, /gấp/);
});

test("thông báo tạo khi được duyệt: khóa riêng theo mã đề xuất, đúng mức và người nhận", () => {
  const p = proposeFromKiln({ product, eventId: 7, insight: insight("alert") });
  const n = notificationFor({ id: 42, action: p.action });
  assert.deepEqual([n.dedupe_key, n.kind, n.level, n.for_role, n.for_coop, n.for_user, n.link], ["agent:42", "agent_kiln", "alert", "coop-officer", "htx-demo", null, "/trace/GOM-BT-0002"]);
  assert.throws(() => notificationFor({ id: 1, action: { type: "xoa-du-lieu" } }), /không được hỗ trợ/); // chỉ hành động đã biết mới chạy được
  assert.throws(() => notificationFor({ id: 1, action: null }), /không được hỗ trợ/);
});
