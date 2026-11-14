// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
// Kiểm tra THẬT sao lưu và khôi phục: tạo dấu thử ở cả BA kho dữ liệu (PostgreSQL qua API, MinIO, Keycloak), sao lưu bằng scripts/backup.sh,
// XÓA các dấu thử, khôi phục bằng scripts/restore.sh, rồi kiểm tra cả ba dấu thử đã trở lại và hệ thống dùng được (đăng nhập, trang công khai).
// Cũng kiểm tra restore.sh từ chối chạy khi thiếu --yes hoặc khi bản sao lưu bị sửa (không đụng tới dữ liệu hiện tại), và heal.sh.
// Chạy: node scripts/check-backup-restore.js   (sau bash scripts/upgrade.sh). Mất vài phút vì khôi phục khởi động lại các dịch vụ.
// LƯU Ý: khôi phục GHI ĐÈ dữ liệu hiện tại bằng bản vừa sao lưu (cùng nội dung, trừ dữ liệu phát sinh trong vài phút chạy bài kiểm tra này).
const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split(/\r?\n/).map((l) => l.match(/^([A-Za-z_]\w*)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const GW = `http://localhost:${Number(env.APISIX_GATEWAY_PORT ?? 9080)}`;
const KC = `http://localhost:8080/realms/${env.KEYCLOAK_REALM ?? "dxos"}/protocol/openid-connect/token`;
const BASH = process.env.BASH_EXE ?? "bash";
const TS = Date.now();
const DIR = `backups/check-${TS}`; // dấu / để bash trên Windows không coi dấu gạch chéo ngược là ký tự thoát
const CODE = `BKP-${TS}`;
const USER = `bkpprobe${TS}`;
const OBJ = `probe-backup-${TS}.txt`;
let fail = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fail++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const docker = (...a) => execFileSync("docker", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const psql = (sql) => docker("exec", "dxos-postgres", "psql", "-U", env.POSTGRES_USER ?? "postgres", "-d", env.TRACE_DB ?? "traceability", "-tAc", sql);
const sh = (script) => spawnSync(BASH, ["-c", script], { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
const mc = (...args) => docker("exec", "-e", `MC_HOST_x=http://${env.MINIO_ROOT_USER}:${env.MINIO_ROOT_PASSWORD}@localhost:9000`, "dxos-minio", "mc", ...args);
const kc = (snippet) => {
  const r = sh(`set -a; . ./.env; set +a; . scripts/lib-keycloak.sh; kc_login >/dev/null 2>&1; ${snippet}`);
  return { code: r.status, out: (r.stdout ?? "").trim() };
};
const token = async (user) => {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(KC, { method: "POST", body: new URLSearchParams({ grant_type: "password", client_id: env.KEYCLOAK_CLIENT_ID, client_secret: env.KEYCLOAK_CLIENT_SECRET, username: user, password: user }) });
      const j = await r.json();
      if (j.access_token) return j.access_token;
    } catch {
      /* Keycloak đang khởi động lại */
    }
    await sleep(5000);
  }
  throw new Error(`không lấy được token của ${user}`);
};
const api = async (tok, method, p, body) => {
  const r = await fetch(`${GW}/api/trace${p}`, { method, headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const waitGateway = async () => {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${GW}/api/public/trace/khong-co`)).status === 404) return true;
    } catch {
      /* chưa sẵn sàng */
    }
    await sleep(3000);
  }
  return false;
};

(async () => {
  const tester = await token("tester");

  // ---- Tạo dấu thử ở cả ba kho ----
  ok((await api(tester, "POST", "/products", { name: "Dấu thử sao lưu (thử)", code: CODE, category: "Gốm sứ" })).status === 201, `PostgreSQL: tạo sản phẩm thử ${CODE} qua API`);
  mc("cp", "/etc/hostname", `x/${env.MINIO_BUCKET ?? "dxos-data"}/${OBJ}`);
  ok(mc("stat", `x/${env.MINIO_BUCKET ?? "dxos-data"}/${OBJ}`).length > 0, `MinIO: tạo đối tượng thử ${OBJ}`);
  ok(kc(`kc create users -r "$R" -s username=${USER} -s enabled=true -s email=${USER}@dxos.local -s firstName=Thu -s lastName=Probe`).code === 0, `Keycloak: tạo người dùng thử ${USER}`);

  // ---- Sao lưu ----
  const bk = sh(`bash scripts/backup.sh ${DIR}`);
  ok(bk.status === 0 && /XONG/.test(bk.stdout), "backup.sh chạy xong");
  ok(["pg-" + env.KEYCLOAK_DB + ".dump", "pg-" + env.FLOWABLE_DB + ".dump", "pg-" + env.TRACE_DB + ".dump", "minio-data.tar.gz", "env.backup", "SHA256SUMS"].every((f) => fs.existsSync(path.join(DIR, f))), "bản sao lưu đủ tệp (3 CSDL, MinIO, .env, mã kiểm tra)");
  await waitGateway();

  // ---- An toàn: restore từ chối khi thiếu --yes hoặc bản sao lưu bị sửa ----
  const noYes = sh(`bash scripts/restore.sh ${DIR}`);
  ok(noYes.status !== 0 && /--yes/.test(noYes.stdout + noYes.stderr), "restore.sh từ chối khi thiếu --yes");
  fs.copyFileSync(path.join(DIR, "pg-" + env.TRACE_DB + ".dump"), path.join(DIR, "pg.keep"));
  fs.appendFileSync(path.join(DIR, "pg-" + env.TRACE_DB + ".dump"), "x"); // mô phỏng bản sao lưu bị sửa
  const bad = sh(`bash scripts/restore.sh ${DIR} --yes`);
  ok(bad.status !== 0 && /hỏng hoặc bị sửa/.test(bad.stdout + bad.stderr), "restore.sh từ chối bản sao lưu bị sửa và CHƯA đụng tới dữ liệu hiện tại");
  ok(Number(psql(`SELECT count(*) FROM products WHERE code = '${CODE}'`)) === 1, "dữ liệu hiện tại còn nguyên sau lần restore bị từ chối");
  fs.copyFileSync(path.join(DIR, "pg.keep"), path.join(DIR, "pg-" + env.TRACE_DB + ".dump"));
  fs.rmSync(path.join(DIR, "pg.keep"));

  // ---- Xóa dấu thử (mô phỏng mất dữ liệu) ----
  psql(`DELETE FROM trace_events WHERE product_id IN (SELECT id FROM products WHERE code = '${CODE}'); DELETE FROM products WHERE code = '${CODE}'`);
  mc("rm", `x/${env.MINIO_BUCKET ?? "dxos-data"}/${OBJ}`);
  const uid = kc(`kc get users -r "$R" -q username=${USER} --fields id --format csv --noquotes | tr -d '\\r'`).out;
  kc(`kc delete users/${uid} -r "$R"`);
  ok(Number(psql(`SELECT count(*) FROM products WHERE code = '${CODE}'`)) === 0, "đã xóa dấu thử ở PostgreSQL");
  ok(kc(`kc get users -r "$R" -q username=${USER} --fields id --format csv --noquotes | tr -d '\\r'`).out === "", "đã xóa dấu thử ở Keycloak");
  let gone = false;
  try {
    mc("stat", `x/${env.MINIO_BUCKET ?? "dxos-data"}/${OBJ}`);
  } catch {
    gone = true;
  }
  ok(gone, "đã xóa dấu thử ở MinIO");

  // ---- Khôi phục ----
  console.log("Khôi phục (khởi động lại dịch vụ, vài phút)...");
  const rs = sh(`bash scripts/restore.sh ${DIR} --yes`);
  ok(rs.status === 0 && /XONG/.test(rs.stdout), "restore.sh chạy xong");
  if (rs.status !== 0) console.log((rs.stdout + rs.stderr).slice(-1500));
  await waitGateway();

  // ---- Kiểm tra sau khôi phục ----
  const tester2 = await token("tester");
  ok((await api(tester2, "GET", `/products/${CODE}`)).status === 200, "PostgreSQL: sản phẩm thử đã trở lại (đọc qua API)");
  let back = false;
  try {
    back = mc("stat", `x/${env.MINIO_BUCKET ?? "dxos-data"}/${OBJ}`).length > 0;
  } catch {
    back = false;
  }
  ok(back, "MinIO: đối tượng thử đã trở lại");
  ok(kc(`kc get users -r "$R" -q username=${USER} --fields id --format csv --noquotes | tr -d '\\r'`).out.length > 0, "Keycloak: người dùng thử đã trở lại");
  ok((await token("hoa")).length > 0, "đăng nhập (hoa) vẫn hoạt động sau khôi phục");
  const pub = await fetch(`${GW}/api/public/trace/GOM-BT-0001`);
  ok(pub.status === 200, "trang công khai của GOM-BT-0001 vẫn tra cứu được");
  ok(Number(psql(`SELECT count(*) FROM audit_log`)) > 0 && (await api(tester2, "GET", "/audit/verify")).json?.ok === true, "nhật ký kiểm toán và bản neo vẫn nguyên vẹn sau khôi phục");

  // ---- heal.sh ----
  const heal = sh("bash scripts/heal.sh");
  ok(heal.status === 0 && /bình thường|khởi động lại/.test(heal.stdout), `heal.sh chạy được: ${heal.stdout.trim().split("\n").pop()}`);

  // ---- Dọn dấu thử và bản sao lưu (có chứa .env) ----
  psql(`DELETE FROM trace_events WHERE product_id IN (SELECT id FROM products WHERE code = '${CODE}'); DELETE FROM products WHERE code = '${CODE}'`);
  try {
    mc("rm", `x/${env.MINIO_BUCKET ?? "dxos-data"}/${OBJ}`);
  } catch {
    /* đã xóa */
  }
  const uid2 = kc(`kc get users -r "$R" -q username=${USER} --fields id --format csv --noquotes | tr -d '\\r'`).out;
  if (uid2) kc(`kc delete users/${uid2} -r "$R"`);
  fs.rmSync(DIR, { recursive: true, force: true });

  console.log(fail ? `\n${fail} KIỂM TRA THẤT BẠI` : "\nTẤT CẢ ĐẠT");
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("Lỗi:", e.message);
  console.error(`Bản sao lưu (nếu có) ở ${DIR}; khôi phục thủ công: bash scripts/restore.sh ${DIR} --yes`);
  process.exit(2);
});
