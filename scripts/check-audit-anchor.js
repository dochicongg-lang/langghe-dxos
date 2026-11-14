// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
// Kiểm tra THẬT việc neo băm đầu chuỗi nhật ký kiểm toán ra kho khóa chống sửa (Object Lock):
//  - chỉ quản trị neo/kiểm tra được; người dùng cuối không chạm được bucket neo; tài khoản trace-anchor không xóa được;
//  - bản neo nằm trong bucket có khóa; kiểm tra toàn vẹn đối chiếu bản neo;
//  - ĐỐI CHỨNG: cắt bớt các dòng cuối chuỗi, và tính lại toàn bộ chuỗi một cách hợp lệ (đánh lừa được chuỗi băm đơn thuần)
//    đều bị bản neo phát hiện; sau đó khôi phục nguyên trạng.
// Hai phép thử phá nhật ký chạy trong một cửa sổ có giữ khóa tư vấn của trace-api (727002) nên không dòng mới nào chen vào giữa lúc
// nhật ký đang bị sửa (nếu chen vào sẽ làm đứt chuỗi vĩnh viễn). Mất khoảng nửa phút.
// Chạy: node scripts/check-audit-anchor.js   (sau bash scripts/upgrade.sh)
const fs = require("fs");
const http = require("http");
const { execFileSync, spawn } = require("child_process");
const audit = require("../services/trace-api/audit");
const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split(/\r?\n/).map((l) => l.match(/^([A-Za-z_]\w*)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const PORT = Number(env.APISIX_GATEWAY_PORT ?? 9080);
const GW = `http://localhost:${PORT}`;
const KC = `http://localhost:8080/realms/${env.KEYCLOAK_REALM ?? "dxos"}/protocol/openid-connect/token`;
const BUCKET = env.ANCHOR_BUCKET ?? "dxos-audit";
const TS = Date.now();
const LOCK_KEY = 727002;
let fail = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fail++;
};
const token = async (user) => {
  const r = await fetch(KC, { method: "POST", body: new URLSearchParams({ grant_type: "password", client_id: env.KEYCLOAK_CLIENT_ID, client_secret: env.KEYCLOAK_CLIENT_SECRET, username: user, password: user }) });
  const j = await r.json();
  if (!j.access_token) throw new Error(`không lấy được token của ${user}`);
  return j.access_token;
};
const call = async (tok, method, path) => {
  const r = await fetch(`${GW}${path}`, { method, headers: { authorization: `Bearer ${tok}` } });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const pgArgs = ["exec", "-i", "dxos-postgres", "psql", "-U", env.POSTGRES_USER ?? "postgres", "-d", env.TRACE_DB ?? "traceability", "-v", "ON_ERROR_STOP=1"];
const psql = (sql) => execFileSync("docker", [...pgArgs, "-tAc", sql], { encoding: "utf8" }).trim();
const mc = (user, pw, ...args) => execFileSync("docker", ["exec", "-e", `MC_HOST_x=http://${user}:${pw}@localhost:9000`, "dxos-minio", "mc", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const mcFails = (user, pw, ...args) => {
  try {
    mc(user, pw, ...args);
    return null;
  } catch (e) {
    return String(e.stderr ?? e.message);
  }
};
const s3gw = (path) =>
  new Promise((resolve, reject) => {
    const rq = http.request({ host: "localhost", port: PORT, path, method: "GET", headers: { host: `s3.localhost:${PORT}` } }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    rq.on("error", reject);
    rq.end();
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Đọc toàn bộ bảng nhật ký (sắp theo id) về dạng dòng để dựng lại chuỗi băm. */
const readAll = () => JSON.parse(psql(`SELECT coalesce(json_agg(t ORDER BY id), '[]'::json) FROM audit_log t`)).map((r) => ({ ...r, ts: new Date(r.ts) }));

(async () => {
  const [tester, hoa, viewer] = await Promise.all(["tester", "hoa", "viewer"].map(token));

  // ---- Phân quyền ----
  ok((await call(viewer, "POST", "/api/trace/audit/anchor")).status === 403, "viewer không neo được (403)");
  ok((await call(hoa, "POST", "/api/trace/audit/anchor")).status === 403, "producer không neo được (403)");
  ok((await call(hoa, "GET", "/api/trace/audit/verify")).status === 403, "producer không kiểm tra được (403)");
  ok((await s3gw(`/${BUCKET}/anchors/x.json`)) === 403, "chạm bucket neo qua cổng S3 bị chặn (403)");

  // ---- Neo thật ----
  const a = await call(tester, "POST", "/api/trace/audit/anchor");
  ok(a.status === 200 && (a.json?.key || a.json?.skipped === "unchanged"), `quản trị neo được: ${a.json?.key ?? "đã có bản neo mới nhất"}`);
  const list = mc(env.MINIO_ROOT_USER, env.MINIO_ROOT_PASSWORD, "ls", `x/${BUCKET}/anchors/`).split(/\r?\n/).filter(Boolean);
  ok(list.length >= 1, `bucket '${BUCKET}' có ${list.length} bản neo`);
  const lastKey = list.at(-1).trim().split(/\s+/).at(-1);
  const retention = mc(env.MINIO_ROOT_USER, env.MINIO_ROOT_PASSWORD, "retention", "info", `x/${BUCKET}/anchors/${lastKey}`);
  ok(/GOVERNANCE|COMPLIANCE/.test(retention), "bản neo bị Object Lock (không sửa, không xóa trong thời hạn giữ)");
  ok(/denied|AccessDenied|not allowed|Access Denied/i.test(mcFails(env.ANCHOR_S3_USER, env.ANCHOR_S3_PASSWORD, "rm", `x/${BUCKET}/anchors/${lastKey}`) ?? ""), "tài khoản trace-anchor KHÔNG xóa được bản neo");
  ok((mcFails(env.ANCHOR_S3_USER, env.ANCHOR_S3_PASSWORD, "ls", `x/${env.DOCS_BUCKET ?? "dxos-docs"}/`) ?? "").length > 0, "tài khoản trace-anchor không đọc được các bucket khác");

  // ---- Kiểm tra toàn vẹn có đối chiếu bản neo ----
  const v1 = await call(tester, "GET", "/api/trace/audit/verify");
  ok(v1.status === 200 && v1.json?.ok === true && v1.json?.anchors?.enabled === true && v1.json?.anchors?.checked >= 1, `kiểm tra toàn vẹn nguyên vẹn, đã đối chiếu ${v1.json?.anchors?.checked} bản neo`);

  // ---- ĐỐI CHỨNG: cắt dòng cuối và tính lại chuỗi (trong cửa sổ giữ khóa) ----
  await call(tester, "POST", "/api/trace/audit/anchor"); // đảm bảo có bản neo cho dòng cuối hiện tại
  const head = Number(psql(`SELECT id FROM audit_log ORDER BY id DESC LIMIT 1`));
  const cutFrom = Math.max(1, head - 2);
  const locker = spawn("docker", [...pgArgs, "-c", `SELECT pg_advisory_lock(${LOCK_KEY}); SELECT pg_sleep(40);`], { stdio: "ignore" });
  const lockerDone = new Promise((r) => locker.on("exit", r));
  await sleep(2000);
  const tmp = `audit_probe_${TS}`;
  let restored = false;
  const restore = () => {
    if (restored) return;
    psql(`ALTER TABLE audit_log DISABLE TRIGGER USER`);
    psql(`DELETE FROM audit_log WHERE id >= ${cutFrom}`);
    psql(`INSERT INTO audit_log SELECT * FROM ${tmp}`);
    psql(`DROP TABLE ${tmp}`);
    psql(`ALTER TABLE audit_log ENABLE TRIGGER USER`);
    restored = true;
  };
  try {
    psql(`CREATE TABLE ${tmp} AS SELECT * FROM audit_log WHERE id >= ${cutFrom}`);
    const nBackup = Number(psql(`SELECT count(*) FROM ${tmp}`));
    psql(`ALTER TABLE audit_log DISABLE TRIGGER USER`);

    // 1) cắt bớt các dòng cuối (kể cả dòng đã neo): chuỗi còn lại vẫn hợp lệ
    psql(`DELETE FROM audit_log WHERE id >= ${cutFrom}`);
    const chainCut = audit.checkRows(readAll());
    ok(chainCut.ok, "(đối chứng) sau khi cắt dòng cuối, chuỗi băm đơn thuần VẪN hợp lệ: nó không phát hiện được");
    const vCut = await call(tester, "GET", "/api/trace/audit/verify");
    ok(vCut.status === 200 && vCut.json?.ok === false && vCut.json?.anchors?.ok === false && /cắt bớt|bị xóa/.test(vCut.json?.broken?.reason ?? ""), `bản neo PHÁT HIỆN việc cắt dòng cuối: ${vCut.json?.broken?.reason}`);

    // khôi phục rồi thử phép thứ hai
    psql(`INSERT INTO audit_log SELECT * FROM ${tmp}`);
    ok((await call(tester, "GET", "/api/trace/audit/verify")).json?.ok === true, "sau khi khôi phục các dòng đã cắt, kiểm tra lại nguyên vẹn");

    // 2) tính lại toàn bộ chuỗi một cách hợp lệ từ dòng cutFrom trở đi (đổi người thao tác ở dòng cutFrom)
    const rows = JSON.parse(psql(`SELECT json_agg(t ORDER BY id) FROM audit_log t WHERE id >= ${cutFrom}`));
    let prev = psql(`SELECT hash FROM audit_log WHERE id < ${cutFrom} ORDER BY id DESC LIMIT 1`) || audit.GENESIS;
    for (const [i, r] of rows.entries()) {
      const e = { ts: new Date(r.ts), actor: i === 0 ? "ke-gian" : r.actor, roles: r.roles ? String(r.roles).split(",") : [], verified: r.verified, ip: r.ip, method: r.method, path: r.path, status: r.status, route: r.route, latencyMs: r.latency_ms };
      const hash = audit.entryHash(prev, e);
      psql(`UPDATE audit_log SET actor = ${e.actor === null ? "NULL" : `'${e.actor}'`}, prev_hash = '${prev}', hash = '${hash}' WHERE id = ${r.id}`);
      prev = hash;
    }
    ok(audit.checkRows(readAll()).ok, "(đối chứng) sau khi kẻ gian tính lại chuỗi hợp lệ, chuỗi băm đơn thuần KHÔNG phát hiện được");
    const vRedo = await call(tester, "GET", "/api/trace/audit/verify");
    ok(vRedo.status === 200 && vRedo.json?.ok === false && /tính lại/.test(vRedo.json?.broken?.reason ?? ""), `bản neo PHÁT HIỆN việc tính lại chuỗi: ${vRedo.json?.broken?.reason}`);
  } finally {
    try {
      restore();
    } catch (e) {
      console.error("LỖI KHI KHÔI PHỤC, kiểm tra thủ công bảng audit_log và bảng", tmp, ":", e.message);
      fail++;
    }
  }
  const vBack = await call(tester, "GET", "/api/trace/audit/verify");
  ok(vBack.json?.ok === true, "sau khôi phục, toàn bộ nhật ký và bản neo nguyên vẹn trở lại");
  ok(/chỉ được ghi thêm/.test((() => { try { psql(`DELETE FROM audit_log WHERE id = (SELECT max(id) FROM audit_log)`); return ""; } catch (e) { return String(e.stderr ?? e.message); } })()), "trigger bất biến đã bật lại");
  await lockerDone;

  console.log(fail ? `\n${fail} KIỂM TRA THẤT BẠI` : "\nTẤT CẢ ĐẠT");
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("Lỗi:", e.message);
  process.exit(2);
});
