// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const access = require("../access");
const { totp, base32Decode } = require("../../../scripts/totp");

const CFG = access.load(path.join(__dirname, "..", "..", "..", "config", "access.json"));

// Bộ vector kiểm thử của RFC 6238 (khóa ASCII "12345678901234567890", HMAC-SHA1, 8 chữ số): lấy 6 số cuối
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // Base32 của khóa trên
test("totp: khớp các vector của RFC 6238", () => {
  const vectors = [
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ];
  for (const [sec, code] of vectors) assert.equal(totp(RFC_SECRET, sec * 1000), code, `t=${sec}`);
});

test("totp: chấp nhận khóa có khoảng trắng/chữ thường như Keycloak hiển thị", () => {
  assert.equal(totp("gezd gnbv gy3t qojq gezd gnbv gy3t qojq", 59000), "287082");
  assert.equal(base32Decode("MFRGG===").toString(), "abc");
});

test("totp: khóa sai ký tự bị từ chối", () => {
  assert.throws(() => totp("KHOA-SAI-1", 0), /không hợp lệ/);
});

test("cấu hình MFA: đúng một vai trò (coop-officer) và các vai trò khác không bắt buộc OTP", () => {
  const mfa = Object.entries(CFG.roles).filter(([, r]) => r.mfa === true).map(([n]) => n);
  assert.deepEqual(mfa, ["coop-officer"]); // script MFA hiện chỉ hỗ trợ một vai trò (nhiều điều kiện vai trò sẽ AND với nhau)
});

test("cấu hình: mfa phải là true/false", () => {
  const bad = JSON.parse(JSON.stringify(CFG));
  bad.roles.producer.mfa = "co";
  assert.throws(() => access.validate(bad), /mfa/);
});
