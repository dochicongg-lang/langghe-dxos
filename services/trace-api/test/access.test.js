// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const access = require("../access");

const CFG = access.load(path.join(__dirname, "..", "..", "..", "config", "access.json"));
const u = (roles, extra = {}) => ({ name: "hoa", roles, coop: "htx-a", ...extra });

test("cấu hình quyền của repo hợp lệ", () => {
  assert.ok(CFG.roles.admin && CFG.roles.producer && CFG.roles["coop-officer"] && CFG.roles["ocop-officer"]);
});

test("phạm vi theo vai trò: sản phẩm", () => {
  const s = (role, action) => access.scopeFor(CFG, [role], action);
  assert.deepEqual(["admin", "readonly", "ocop-officer", "coop-officer", "producer"].map((r) => s(r, "product.read")), ["all", "all", "all", "coop", "coop"]);
  assert.deepEqual(["admin", "coop-officer", "producer", "readonly", "ocop-officer"].map((r) => s(r, "product.create")), ["all", "coop", "self", null, null]);
  assert.deepEqual(["admin", "coop-officer", "producer", "readonly", "ocop-officer"].map((r) => s(r, "product.update")), ["all", "coop", "own", null, null]);
});

test("editor là bí danh tạm của admin (quyền như nhau)", () => {
  for (const a of Object.keys(CFG.permissions)) assert.equal(access.scopeFor(CFG, ["editor"], a), access.scopeFor(CFG, ["admin"], a));
});

test("iot-writer và role lạ không có quyền nào, không dùng được API", () => {
  for (const a of Object.keys(CFG.permissions)) {
    assert.equal(access.scopeFor(CFG, ["iot-writer"], a), null);
    assert.equal(access.scopeFor(CFG, ["readwrite"], a), null); // role cũ đã gỡ
    assert.equal(access.scopeFor(CFG, [], a), null);
  }
  assert.equal(access.canApi(CFG, ["iot-writer"]), false);
  assert.equal(access.canApi(CFG, ["readwrite"]), false);
  assert.equal(access.canApi(CFG, ["iot-writer", "readonly"]), true);
  for (const bad of [undefined, null, "editor", {}]) assert.equal(access.canApi(CFG, bad), false);
});

test("nhiều vai trò: lấy phạm vi rộng nhất", () => {
  assert.equal(access.scopeFor(CFG, ["producer", "coop-officer"], "product.update"), "coop");
  assert.equal(access.scopeFor(CFG, ["producer", "readonly"], "product.read"), "all");
});

test("cách ly HTX: cán bộ HTX A không thấy/sửa sản phẩm của HTX B", () => {
  const officer = u(["coop-officer"]);
  assert.equal(access.authorize(CFG, officer, "product.read", { coop: "htx-a" }), true);
  assert.equal(access.authorize(CFG, officer, "product.read", { coop: "htx-b" }), false);
  assert.equal(access.authorize(CFG, officer, "product.update", { coop: "htx-b" }), false);
  assert.equal(access.authorize(CFG, officer, "product.update", { coop: "htx-a" }), true);
});

test("sản phẩm chưa gán HTX không lọt vào phạm vi HTX", () => {
  assert.equal(access.authorize(CFG, u(["coop-officer"]), "product.read", { coop: null }), false);
  assert.equal(access.authorize(CFG, u(["producer"]), "product.read", {}), false);
});

test("producer: chỉ sửa sản phẩm của chính mình, nhưng xem được cả HTX", () => {
  const hoa = u(["producer"]);
  assert.equal(access.authorize(CFG, hoa, "product.update", { owner: "hoa", coop: "htx-a" }), true);
  assert.equal(access.authorize(CFG, hoa, "product.update", { owner: "lan", coop: "htx-a" }), false);
  assert.equal(access.authorize(CFG, hoa, "product.update", { owner: null, coop: "htx-a" }), false);
  assert.equal(access.authorize(CFG, hoa, "product.read", { owner: "lan", coop: "htx-a" }), true);
  assert.equal(access.authorize(CFG, hoa, "product.read", { owner: "lan", coop: "htx-b" }), false);
});

test("tạo mới cần người dùng thuộc một HTX (producer/coop-officer), quản trị thì không cần", () => {
  assert.equal(access.authorize(CFG, u(["producer"]), "product.create", { coop: "htx-a" }), true);
  assert.equal(access.authorize(CFG, u(["producer"], { coop: "" }), "product.create", { coop: "" }), false);
  assert.equal(access.authorize(CFG, u(["coop-officer"], { coop: "" }), "product.create", { coop: "" }), false);
  assert.equal(access.authorize(CFG, u(["admin"], { coop: "" }), "product.create", {}), true);
});

test("readonly và ocop-officer xem được toàn bộ nhưng không ghi", () => {
  for (const role of ["readonly", "ocop-officer"]) {
    const x = u([role], { coop: "" });
    assert.equal(access.authorize(CFG, x, "product.read", { coop: "htx-z" }), true);
    assert.equal(access.authorize(CFG, x, "product.create", {}), false);
    assert.equal(access.authorize(CFG, x, "product.update", { owner: "hoa", coop: "htx-a" }), false);
  }
});

test("permissionsOf trả bảng quyền hiệu lực cho giao diện", () => {
  assert.deepEqual(access.permissionsOf(CFG, ["producer"]), { "product.read": "coop", "product.create": "self", "product.update": "own", "application.read": "own", "application.create": "self", "application.update": "own" });
  assert.deepEqual(access.permissionsOf(CFG, ["readonly"]), { "product.read": "all" });
  assert.deepEqual(access.permissionsOf(CFG, ["iot-writer"]), {});
});

test("validate: từ chối cấu hình sai", () => {
  const base = () => JSON.parse(JSON.stringify(CFG));
  const bad = [
    (c) => (c.roles.editor.alias = "khong-co"),
    (c) => (c.roles.Bad_Name = { desc: "x" }),
    (c) => (c.permissions["product.read"].admin = "moi-thu"),
    (c) => (c.permissions["product.read"]["role-la"] = "all"),
    (c) => (c.roles.producer.alias = "editor"), // alias nối chuỗi
    (c) => delete c.permissions,
  ];
  for (const mutate of bad) {
    const c = base();
    mutate(c);
    assert.throws(() => access.validate(c), Error);
  }
});

test("trang nền tảng theo vai trò (đúng người đúng việc)", () => {
  const p = (r) => access.pagesOf(CFG, r).sort();
  assert.deepEqual(p(["producer"]), []); // nghệ nhân chỉ cần sản phẩm, hồ sơ và trợ giúp
  assert.deepEqual(p(["readonly"]), ["intelligence"]);
  assert.deepEqual(p(["coop-officer"]), ["intelligence", "process"]);
  assert.deepEqual(p(["ocop-officer"]), ["intelligence", "process"]);
  assert.deepEqual(p(["admin"]), ["data", "intelligence", "platform", "process"]);
  assert.deepEqual(p(["editor"]), p(["admin"])); // bí danh tạm
  assert.deepEqual(p(["iot-writer"]), []);
  assert.deepEqual(p(["role-la"]), []);
  assert.deepEqual(p(["producer", "coop-officer"]), ["intelligence", "process"]); // nhiều vai trò: hợp của các vai trò
  assert.throws(() => access.validate({ roles: { a: {} }, permissions: {}, pages: { x: ["b"] } }), /role không có/);
  assert.throws(() => access.validate({ roles: { a: {} }, permissions: {}, pages: { x: "a" } }), /danh sách/);
});
