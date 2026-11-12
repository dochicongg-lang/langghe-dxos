"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { canRead, canWrite } = require("../roles");

test("editor: xem và ghi", () => {
  assert.equal(canRead(["editor"]), true);
  assert.equal(canWrite(["editor"]), true);
});

test("readonly: chỉ xem", () => {
  assert.equal(canRead(["readonly"]), true);
  assert.equal(canWrite(["readonly"]), false);
});

test("iot-writer (thiết bị): không xem, không ghi dữ liệu nghiệp vụ", () => {
  assert.equal(canRead(["iot-writer"]), false);
  assert.equal(canWrite(["iot-writer"]), false);
});

test("vai trò cũ readwrite không còn quyền (đã tách khỏi quyền ghi IoT)", () => {
  assert.equal(canRead(["readwrite"]), false);
  assert.equal(canWrite(["readwrite"]), false);
});

test("không có vai trò hoặc dữ liệu sai kiểu -> từ chối", () => {
  for (const v of [[], undefined, null, "editor", {}]) {
    assert.equal(canRead(v), false);
    assert.equal(canWrite(v), false);
  }
});

test("thiết bị có thêm vai trò editor thì vẫn được tính là editor (cấp quyền là việc của Keycloak)", () => {
  assert.equal(canWrite(["iot-writer", "editor"]), true);
});
