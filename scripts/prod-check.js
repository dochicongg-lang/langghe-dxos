// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
// Rà soát mức sẵn sàng đưa lên Internet: đọc .env, docker-compose.yml và (nếu chạy được) trạng thái thật của Keycloak, rồi liệt kê những gì
// còn yếu. Thoát mã 1 nếu còn mục KHÔNG ĐẠT. Không sửa gì, chỉ báo cáo.
// Chạy: node scripts/prod-check.js            (đọc .env của bạn)
//       node scripts/prod-check.js --env tệp  (đọc tệp khác, ví dụ .env.production trước khi triển khai)
// Hàm audit() là hàm thuần (có test trong services/trace-api/test/prod-check.test.js).
const fs = require("fs");
const { execFileSync } = require("child_process");

const SECRET_KEYS = [
  "POSTGRES_PASSWORD", "MINIO_ROOT_PASSWORD", "KEYCLOAK_ADMIN_PASSWORD", "FLOWABLE_ADMIN_PASSWORD", "KEYCLOAK_CLIENT_SECRET", "KEYCLOAK_IOT_CLIENT_SECRET",
  "TRACE_S3_PASSWORD", "TRACE_DOCS_PASSWORD", "ANCHOR_S3_PASSWORD", "AUDIT_INGEST_KEY", "FLOWABLE_PROXY_KEY", "APISIX_ADMIN_KEY", "APISIX_VIEWER_KEY",
];
const WEAK = /^(admin|administrator|tester|hoa|tuan|ocop|viewer|password|passw0rd|postgres|minioadmin|rest-admin|test|secret|123456\d*|change_?me.*)$/i;
const DEMO_USERS = ["hoa", "tuan", "ocop", "tester", "viewer"];

/**
 * env: đối tượng khóa-giá trị của .env. ctx: { composeText, keycloakUsers (mảng tên người dùng hoặc null nếu không đọc được) }.
 * Trả mảng { level: "ok" | "fail" | "warn", id, msg }.
 */
function audit(env, ctx = {}) {
  const out = [];
  const add = (level, id, msg) => out.push({ level, id, msg });

  const weak = SECRET_KEYS.filter((k) => env[k] !== undefined && (WEAK.test(String(env[k])) || String(env[k]).length < 16));
  const missing = SECRET_KEYS.filter((k) => env[k] === undefined || env[k] === "");
  if (weak.length) add("fail", "secrets", `Mật khẩu/khóa còn yếu hoặc là giá trị mẫu (đổi trước khi đưa lên Internet): ${weak.join(", ")}`);
  else add("ok", "secrets", "Mọi mật khẩu và khóa đều dài ít nhất 16 ký tự và không phải giá trị mẫu");
  if (missing.length) add("warn", "secrets-missing", `Thiếu trong .env: ${missing.join(", ")} (chạy bash scripts/upgrade.sh để bổ sung)`);

  if (env.KEYCLOAK_ADMIN && /^(admin|administrator|root)$/i.test(env.KEYCLOAK_ADMIN)) add("warn", "admin-name", "Tên quản trị Keycloak là mặc định dễ đoán (admin); nên đổi tên đăng nhập quản trị");

  if (String(env.IOT_LOCK_MODE ?? "GOVERNANCE").toUpperCase() !== "COMPLIANCE") {
    add("fail", "lock-mode", "IOT_LOCK_MODE chưa phải COMPLIANCE: với GOVERNANCE, tài khoản chỉ-xem gỡ được khóa dữ liệu khi đi thẳng vào MinIO (đã kiểm chứng bằng scripts/check-minio-lock-modes.js)");
  } else if (env.IOT_LOCK_CONFIRM_COMPLIANCE !== "yes") {
    add("warn", "lock-confirm", "IOT_LOCK_MODE=COMPLIANCE nhưng thiếu IOT_LOCK_CONFIRM_COMPLIANCE=yes: script thiết lập sẽ từ chối chạy");
  } else add("ok", "lock-mode", "Khóa dữ liệu ở chế độ COMPLIANCE (không bypass được)");
  if (Number(env.IOT_RETENTION_DAYS ?? 1825) < 1095) add("warn", "retention", `IOT_RETENTION_DAYS=${env.IOT_RETENTION_DAYS}: ngắn hơn 3 năm (thời hiệu khiếu nại thông thường)`);

  if (!env.CLAMAV_HOST) add("fail", "clamav", "Chưa bật quét mã độc (CLAMAV_HOST trống)");
  else if (String(env.CLAMAV_REQUIRED ?? "true").toLowerCase() === "false") add("fail", "clamav", "CLAMAV_REQUIRED=false: quét lỗi thì vẫn cho tải tệp lên (không an toàn khi mở ra Internet)");
  else add("ok", "clamav", "Quét mã độc bật và bắt buộc (đóng khi lỗi)");

  const origin = env.FRONTEND_ORIGIN ?? "http://localhost:3000";
  if (!/^https:\/\//i.test(origin)) add("fail", "https-origin", `FRONTEND_ORIGIN=${origin} không phải https:// (cần HTTPS cho giao diện, đăng nhập và API)`);
  else add("ok", "https-origin", `FRONTEND_ORIGIN dùng HTTPS: ${origin}`);
  if (!env.KC_HOSTNAME_URL || !/^https:\/\//i.test(env.KC_HOSTNAME_URL)) add("fail", "keycloak-hostname", "KC_HOSTNAME_URL chưa đặt hoặc không phải https:// (địa chỉ công khai của Keycloak, ghi trong token và đường dẫn đăng nhập)");
  else add("ok", "keycloak-hostname", `Keycloak có địa chỉ công khai HTTPS: ${env.KC_HOSTNAME_URL}`);

  if (ctx.composeText !== undefined) {
    if (/command:\s*start-dev/.test(ctx.composeText)) add("fail", "keycloak-dev", "Keycloak đang chạy ở chế độ phát triển (start-dev): bộ nhớ đệm giao diện tắt, không dùng cho sản xuất; cần chế độ start với HTTPS và tên miền");
    else add("ok", "keycloak-dev", "Keycloak không chạy ở chế độ start-dev");
    const open = [...ctx.composeText.matchAll(/^\s+-\s+"(?!127\.0\.0\.1:)(\$\{[A-Z_]+\}|\d+):(\d+)"/gm)].map((m) => m[1].replace(/[${}]/g, ""));
    if (open.length) add("warn", "open-ports", `Các cổng đang mở ra mọi địa chỉ máy chủ: ${open.join(", ")}. Khi triển khai thật chỉ mở 443 (và 80 để cấp chứng chỉ), đặt cổng gác và Keycloak sau proxy HTTPS`);
  }

  if (ctx.keycloakUsers) {
    const demo = DEMO_USERS.filter((u) => ctx.keycloakUsers.includes(u));
    if (demo.length) add("fail", "demo-users", `Còn tài khoản thử với mật khẩu trùng tên: ${demo.join(", ")} (xóa hoặc đổi mật khẩu trước khi đưa lên Internet)`);
    else add("ok", "demo-users", "Không còn tài khoản thử mặc định");
  } else add("warn", "demo-users", "Không đọc được danh sách người dùng Keycloak (hệ thống đang tắt?), chưa kiểm tra tài khoản thử");
  return out;
}

function keycloakUsers(env) {
  try {
    const kc = (...a) => execFileSync("docker", ["exec", "dxos-keycloak", "/opt/keycloak/bin/kcadm.sh", ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
    kc("config", "credentials", "--server", "http://localhost:8080", "--realm", "master", "--user", env.KEYCLOAK_ADMIN, "--password", env.KEYCLOAK_ADMIN_PASSWORD);
    return kc("get", "users", "-r", env.KEYCLOAK_REALM ?? "dxos", "--fields", "username", "--format", "csv", "--noquotes", "-q", "max=500").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

module.exports = { audit, SECRET_KEYS, DEMO_USERS };

if (require.main === module) {
  const i = process.argv.indexOf("--env");
  const file = i > 0 ? process.argv[i + 1] : ".env";
  const env = Object.fromEntries(fs.readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.match(/^([A-Za-z_]\w*)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
  const findings = audit(env, { composeText: fs.readFileSync("docker-compose.yml", "utf8"), keycloakUsers: i > 0 ? null : keycloakUsers(env) });
  const icon = { ok: "ĐẠT     ", fail: "KHÔNG ĐẠT", warn: "LƯU Ý    " };
  console.log(`Rà soát mức sẵn sàng đưa lên Internet (${file})\n`);
  for (const f of findings) console.log(`${icon[f.level]}  ${f.msg}`);
  const fails = findings.filter((f) => f.level === "fail").length;
  const warns = findings.filter((f) => f.level === "warn").length;
  console.log(`\n${fails ? `CHƯA SẴN SÀNG: ${fails} mục không đạt, ${warns} lưu ý.` : `Không còn mục không đạt (${warns} lưu ý).`} Xem docs/TRIEN-KHAI-INTERNET.md.`);
  process.exit(fails ? 1 : 0);
}
