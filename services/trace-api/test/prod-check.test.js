// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { audit, SECRET_KEYS } = require("../../../scripts/prod-check");

const strong = Object.fromEntries(SECRET_KEYS.map((k) => [k, `K${k.toLowerCase()}-${"x9Z".repeat(8)}`]));
const READY = { ...strong, KEYCLOAK_ADMIN: "quan-tri-he-thong", IOT_LOCK_MODE: "COMPLIANCE", IOT_LOCK_CONFIRM_COMPLIANCE: "yes", IOT_RETENTION_DAYS: "1825", CLAUDE_UNUSED: "x", CLAMAV_HOST: "clamav", CLAMAV_REQUIRED: "true", FRONTEND_ORIGIN: "https://truyxuat.example.vn", KC_HOSTNAME_URL: "https://dangnhap.example.vn" };
const COMPOSE_OK = 'services:\n  keycloak:\n    command: start --optimized\n    ports:\n      - "127.0.0.1:8080:8080"\n';
const by = (findings, id) => findings.filter((f) => f.id === id);

test("cấu hình sẵn sàng: không có mục nào không đạt", () => {
  const f = audit(READY, { composeText: COMPOSE_OK, keycloakUsers: ["quan-tri-vien-that"] });
  assert.deepEqual(f.filter((x) => x.level === "fail"), []);
  assert.ok(f.every((x) => x.level === "ok"), JSON.stringify(f.filter((x) => x.level !== "ok")));
});

test("mật khẩu mẫu hoặc quá ngắn bị bắt, nêu đúng khóa", () => {
  const f = audit({ ...READY, POSTGRES_PASSWORD: "postgres", MINIO_ROOT_PASSWORD: "change_me_minio", KEYCLOAK_ADMIN_PASSWORD: "admin", FLOWABLE_ADMIN_PASSWORD: "ngan123" }, {});
  const s = by(f, "secrets")[0];
  assert.equal(s.level, "fail");
  for (const k of ["POSTGRES_PASSWORD", "MINIO_ROOT_PASSWORD", "KEYCLOAK_ADMIN_PASSWORD", "FLOWABLE_ADMIN_PASSWORD"]) assert.ok(s.msg.includes(k), k);
  assert.ok(!s.msg.includes("APISIX_ADMIN_KEY")); // khóa mạnh không bị nêu
});

test("khóa thiếu chỉ là lưu ý, không phải lỗi", () => {
  const { APISIX_VIEWER_KEY: _omit, ...rest } = READY;
  const m = by(audit(rest, {}), "secrets-missing")[0];
  assert.equal(m.level, "warn");
  assert.match(m.msg, /APISIX_VIEWER_KEY/);
});

test("khóa dữ liệu: GOVERNANCE là lỗi (lỗ hổng đã kiểm chứng), COMPLIANCE thiếu xác nhận là lưu ý", () => {
  assert.equal(by(audit({ ...READY, IOT_LOCK_MODE: "GOVERNANCE" }, {}), "lock-mode")[0].level, "fail");
  assert.equal(by(audit({ ...READY, IOT_LOCK_MODE: undefined }, {}), "lock-mode")[0].level, "fail"); // mặc định là GOVERNANCE
  const f = audit({ ...READY, IOT_LOCK_CONFIRM_COMPLIANCE: "no" }, {});
  assert.equal(by(f, "lock-confirm")[0].level, "warn");
  assert.equal(by(audit({ ...READY, IOT_RETENTION_DAYS: "30" }, {}), "retention")[0].level, "warn");
});

test("quét mã độc: tắt hoặc cho qua khi lỗi đều là lỗi", () => {
  assert.equal(by(audit({ ...READY, CLAMAV_HOST: "" }, {}), "clamav")[0].level, "fail");
  assert.equal(by(audit({ ...READY, CLAMAV_REQUIRED: "false" }, {}), "clamav")[0].level, "fail");
  assert.equal(by(audit({ ...READY, CLAMAV_REQUIRED: "FALSE" }, {}), "clamav")[0].level, "fail");
});

test("địa chỉ công khai phải là HTTPS (giao diện và Keycloak)", () => {
  assert.equal(by(audit({ ...READY, FRONTEND_ORIGIN: "http://truyxuat.example.vn" }, {}), "https-origin")[0].level, "fail");
  assert.equal(by(audit({ ...READY, FRONTEND_ORIGIN: undefined }, {}), "https-origin")[0].level, "fail"); // mặc định http://localhost:3000
  assert.equal(by(audit({ ...READY, KC_HOSTNAME_URL: "http://localhost:8080" }, {}), "keycloak-hostname")[0].level, "fail");
  assert.equal(by(audit({ ...READY, KC_HOSTNAME_URL: undefined }, {}), "keycloak-hostname")[0].level, "fail");
});

test("compose: start-dev là lỗi; cổng mở ra mọi địa chỉ là lưu ý; cổng chỉ nghe 127.0.0.1 thì không", () => {
  const dev = 'services:\n  keycloak:\n    command: start-dev --import-realm\n    ports:\n      - "${KEYCLOAK_PORT}:8080"\n      - "127.0.0.1:${POSTGRES_PORT}:5432"\n';
  const f = audit(READY, { composeText: dev });
  assert.equal(by(f, "keycloak-dev")[0].level, "fail");
  const open = by(f, "open-ports")[0];
  assert.equal(open.level, "warn");
  assert.match(open.msg, /KEYCLOAK_PORT/);
  assert.ok(!open.msg.includes("POSTGRES_PORT"));
  assert.equal(by(audit(READY, { composeText: COMPOSE_OK }), "open-ports").length, 0);
});

test("tài khoản thử còn tồn tại là lỗi; không đọc được Keycloak chỉ là lưu ý", () => {
  const f = audit(READY, { keycloakUsers: ["hoa", "tuan", "nguyen-van-a", "tester"] });
  const d = by(f, "demo-users")[0];
  assert.equal(d.level, "fail");
  assert.ok(d.msg.includes("hoa") && d.msg.includes("tuan") && d.msg.includes("tester") && !d.msg.includes("nguyen-van-a"));
  assert.equal(by(audit(READY, { keycloakUsers: null }), "demo-users")[0].level, "warn");
});

test("tên quản trị mặc định chỉ là lưu ý", () => {
  assert.equal(by(audit({ ...READY, KEYCLOAK_ADMIN: "admin" }, {}), "admin-name")[0].level, "warn");
});
