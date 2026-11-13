#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use strict";
/**
 * Bắt buộc OTP (xác thực hai yếu tố) khi ĐĂNG NHẬP BẰNG TRÌNH DUYỆT cho các vai trò có `"mfa": true` trong config/access.json.
 * Chạy lặp lại an toàn. Dùng kcadm trong container Keycloak.
 *
 * Cách làm: sao chép luồng đăng nhập `browser` thành `browser-role-otp`, trong nhánh "Browser - Conditional 2FA":
 *   - thêm điều kiện "user role" (vai trò MFA) = REQUIRED;
 *   - tắt hai điều kiện mặc định (user configured, credential) để OTP áp dụng dù người dùng đã cài OTP hay chưa
 *     (chưa cài thì Keycloak bắt cài ngay lúc đăng nhập đầu tiên);
 *   - "OTP Form" = REQUIRED;
 * rồi gán luồng này làm browserFlow của realm. Luồng đăng nhập bằng mật khẩu trực tiếp (direct grant, dùng cho script kiểm tra) không bị ảnh hưởng.
 * Không có vai trò MFA nào thì trả browserFlow về `browser`.
 *
 * Biến môi trường: KEYCLOAK_REALM, KEYCLOAK_ADMIN, KEYCLOAK_ADMIN_PASSWORD (đã nạp từ .env bởi script gọi).
 */
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const access = require("../services/trace-api/access");

const ALIAS = "browser-role-otp";
const COND_FLOW = "Browser - Conditional 2FA";
const R = process.env.KEYCLOAK_REALM || "dxos";

function kc(...args) {
  return execFileSync("docker", ["exec", "dxos-keycloak", "/opt/keycloak/bin/kcadm.sh", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
const kcj = (...args) => JSON.parse(kc(...args));
const enc = encodeURIComponent;

function login() {
  kc("config", "credentials", "--server", "http://localhost:8080", "--realm", "master", "--user", process.env.KEYCLOAK_ADMIN, "--password", process.env.KEYCLOAK_ADMIN_PASSWORD);
}

function mfaRoles(cfg) {
  return Object.entries(cfg.roles).filter(([, r]) => r.mfa === true).map(([n]) => n);
}

/** Các thực thi con nằm trong nhánh có tên COND_FLOW. */
function condChildren(execs) {
  const i = execs.findIndex((e) => e.authenticationFlow && e.displayName.endsWith(COND_FLOW));
  if (i < 0) throw new Error(`Không thấy nhánh "${COND_FLOW}" trong luồng ${ALIAS}`);
  const parent = execs[i];
  const kids = [];
  for (let j = i + 1; j < execs.length && execs[j].level > parent.level; j++) if (execs[j].level === parent.level + 1) kids.push(execs[j]);
  return { parent, kids };
}

function main() {
  const cfg = access.load(path.join(__dirname, "..", "config", "access.json"));
  const roles = mfaRoles(cfg);
  login();

  if (roles.length === 0) {
    const cur = kcj("get", `realms/${R}`, "--fields", "browserFlow").browserFlow;
    if (cur === ALIAS) kc("update", `realms/${R}`, "-s", "browserFlow=browser");
    console.log("MFA: không có vai trò nào yêu cầu OTP (browserFlow = browser).");
    return;
  }
  if (roles.length > 1) throw new Error(`Hiện chỉ hỗ trợ một vai trò MFA (tìm thấy: ${roles.join(", ")}); nhiều điều kiện vai trò sẽ AND với nhau`);
  const role = roles[0];

  if (!kcj("get", "authentication/flows", "-r", R).some((f) => f.alias === ALIAS)) {
    kc("create", "authentication/flows/browser/copy", "-r", R, "-s", `newName=${ALIAS}`);
  }

  let { parent, kids } = condChildren(kcj("get", `authentication/flows/${enc(ALIAS)}/executions`, "-r", R));
  const subAlias = kcj("get", `authentication/flows/${parent.flowId}`, "-r", R).alias;

  if (!kids.some((k) => k.providerId === "conditional-user-role")) {
    kc("create", `authentication/flows/${enc(subAlias)}/executions/execution`, "-r", R, "-s", "provider=conditional-user-role");
    ({ parent, kids } = condChildren(kcj("get", `authentication/flows/${enc(ALIAS)}/executions`, "-r", R)));
  }

  const want = { "conditional-user-role": "REQUIRED", "conditional-user-configured": "DISABLED", "conditional-credential": "DISABLED", "auth-otp-form": "REQUIRED" };
  for (const k of kids) {
    const req = want[k.providerId];
    if (req && k.requirement !== req) kc("update", `authentication/flows/${enc(subAlias)}/executions`, "-r", R, "-b", JSON.stringify({ ...k, requirement: req }));
  }

  // Điều kiện vai trò: đưa lên đầu nhánh để được đánh giá trước (raise-priority tới khi index = 0)
  for (let n = 0; n < 6; n++) {
    ({ parent, kids } = condChildren(kcj("get", `authentication/flows/${enc(ALIAS)}/executions`, "-r", R)));
    const cond = kids.find((k) => k.providerId === "conditional-user-role");
    if (cond.index === 0) break;
    kc("create", `authentication/executions/${cond.id}/raise-priority`, "-r", R);
  }

  ({ parent, kids } = condChildren(kcj("get", `authentication/flows/${enc(ALIAS)}/executions`, "-r", R)));
  const cond = kids.find((k) => k.providerId === "conditional-user-role");
  const body = { alias: `mfa-${role}`, config: { condUserRole: role, negate: "false" } };
  if (cond.authenticationConfig) kc("update", `authentication/config/${cond.authenticationConfig}`, "-r", R, "-b", JSON.stringify({ ...body, id: cond.authenticationConfig }));
  else kc("create", `authentication/executions/${cond.id}/config`, "-r", R, "-b", JSON.stringify(body));

  kc("update", `realms/${R}`, "-s", `browserFlow=${ALIAS}`);
  console.log(`MFA: đăng nhập bằng trình duyệt của vai trò "${role}" yêu cầu OTP (luồng ${ALIAS}).`);
}

try {
  main();
} catch (e) {
  console.error("setup-keycloak-mfa:", (e.stderr ? String(e.stderr) : e.message).trim());
  process.exit(1);
}
