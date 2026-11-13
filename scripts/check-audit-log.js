// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
// Kiểm tra THẬT nhật ký kiểm toán: cổng gác APISIX (Lua gắn danh tính + http-logger) -> trace-api (/internal/audit) -> PostgreSQL.
// Gồm: ghi đúng người/kết quả, danh tính giả mạo không được coi là đã xác thực, không rò token, chỉ quản trị đọc, bất biến ở CSDL,
// phát hiện sửa lén bằng chuỗi băm (có đối chứng: tắt trigger thì sửa được rồi bị phát hiện, sau đó khôi phục).
// Chạy: node scripts/check-audit-log.js   (sau bash scripts/upgrade.sh). Nhật ký là chỉ-ghi-thêm nên các dòng thử ở lại (có mã đánh dấu audit_probe).
const fs = require("fs");
const http = require("http");
const { execFileSync } = require("child_process");
const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split(/\r?\n/).map((l) => l.match(/^([A-Za-z_]\w*)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const PORT = Number(env.APISIX_GATEWAY_PORT ?? 9080);
const GW = `http://localhost:${PORT}`;
const KC = `http://localhost:8080/realms/${env.KEYCLOAK_REALM ?? "dxos"}/protocol/openid-connect/token`;
const TS = Date.now();
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
const call = async (tok, method, path, body, headers = {}) => {
  const r = await fetch(`${GW}${path}`, { method, headers: { ...(tok ? { authorization: `Bearer ${tok}` } : {}), "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const psql = (sql) => execFileSync("docker", ["exec", "dxos-postgres", "psql", "-U", env.POSTGRES_USER ?? "postgres", "-d", env.TRACE_DB ?? "traceability", "-v", "ON_ERROR_STOP=1", "-tAc", sql], { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
const psqlFails = (sql) => {
  try {
    psql(sql);
    return null;
  } catch (e) {
    return String(e.stderr ?? e.message);
  }
};
// fetch của Node không cho đổi tiêu đề Host nên dùng http.request để vào đúng route s3.localhost
const s3gw = (path) =>
  new Promise((resolve, reject) => {
    const rq = http.request({ host: "localhost", port: PORT, path, method: "GET", headers: { host: `s3.localhost:${PORT}` } }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    rq.on("error", reject);
    rq.end();
  });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

(async () => {
  const [tester, hoa, tuan, ocop, viewer] = await Promise.all(["tester", "hoa", "tuan", "ocop", "viewer"].map(token));
  const code = `AUDIT-${TS}`;
  const probe = (n) => `audit_probe=${TS}-${n}`;
  const forged = `${b64({ alg: "none" })}.${b64({ preferred_username: "tester", policy: ["editor"], exp: Math.floor(Date.now() / 1000) + 3600 })}.chu-ky-gia`;

  // ---- Tạo lưu lượng đa dạng ----
  ok((await call(null, "GET", `/api/trace/products?${probe("anon")}`)).status === 401, "yêu cầu ẩn danh bị từ chối 401");
  ok((await call(forged, "GET", `/api/trace/products?${probe("forged")}`)).status === 401, "token giả mạo (khai là tester) bị từ chối 401");
  ok((await call(viewer, "POST", `/api/trace/products?${probe("viewer")}`, { name: "x" })).status === 403, "viewer ghi bị từ chối 403");
  const created = await call(tester, "POST", `/api/trace/products?${probe("tester")}`, { name: "Thử nhật ký (thử)", code, category: "Gốm sứ" }, { "x-audit-user": "admin", "x-audit-roles": "admin" });
  ok(created.status === 201, "tester tạo sản phẩm thành công 201 (kèm tiêu đề X-Audit-User giả cố đánh lừa)");
  ok((await call(hoa, "GET", `/api/trace/products?${probe("hoa")}`)).status === 200, "hoa xem danh sách 200");
  ok((await call(viewer, "DELETE", `/api/workflow/repository/deployments/khong-co?${probe("wf-del")}`)).status === 403, "viewer xóa quy trình bị từ chối 403");
  ok((await call(viewer, "GET", `/api/workflow/repository/process-definitions?${probe("wf-get")}`)).status === 200, "viewer đọc định nghĩa quy trình 200 (GET thành công ở workflow không ghi nhật ký)");
  ok((await s3gw(`/${env.DOCS_BUCKET ?? "dxos-docs"}/applications/x.jpg?${probe("s3")}`)) === 403, "chạm kho tệp qua cổng S3 bị chặn 403");
  ok((await call(tester, "POST", `/api/trace/internal/audit?${probe("ingest")}`, [{ method: "GET", uri: "/gia", status: 200, route: "trace-api", time: new Date().toISOString() }])).status === 401, "không ghi giả nhật ký qua cổng gác: /internal/audit cần khóa nội bộ -> 401");

  // ---- Chờ lô nhật ký đến nơi (http-logger gom lô vài giây) ----
  let rows = [];
  for (let i = 0; i < 25; i++) {
    const r = await call(tester, "GET", `/api/trace/audit?limit=200&q=${TS}`);
    rows = r.json?.rows ?? [];
    if (["anon", "forged", "viewer", "tester", "hoa", "wf-del", "s3"].every((n) => rows.some((x) => x.path.includes(`${TS}-${n}`)))) break;
    await sleep(1000);
  }
  const by = (n) => rows.find((x) => x.path.includes(`${TS}-${n}`));
  ok(rows.length >= 7, `nhật ký đã nhận lô từ cổng gác (${rows.length} dòng thử)`);

  const anon = by("anon");
  ok(anon && anon.actor === null && anon.status === 401 && anon.method === "GET" && anon.route === "trace-api" && anon.verified === false, "ẩn danh: actor rỗng, 401, route trace-api");
  const f = by("forged");
  ok(f && f.actor === "tester" && f.verified === false && f.status === 401, "token giả: ghi nhận là TỰ KHAI (verified = false), không bị tính là tester thật");
  const v = by("viewer");
  ok(v && v.actor === "viewer" && v.status === 403 && v.method === "POST" && v.verified === false, "viewer ghi bị chặn: ghi đúng người, 403 (danh tính ở yêu cầu bị từ chối là tự khai)");
  const t = by("tester");
  ok(t && t.actor === "tester" && t.verified === true && t.status === 201 && t.roles.split(",").includes("editor"), "tester thành công: actor đúng, verified = true, kèm vai trò từ token");
  ok(t && t.actor !== "admin" && !/admin/.test(t.roles.replace("editor", "")), "tiêu đề X-Audit-User/X-Audit-Roles do client gửi bị Lua ghi đè, không giả được danh tính");
  const h = by("hoa");
  ok(h && h.actor === "hoa" && h.verified === true && h.roles.split(",").includes("producer"), "hoa: ghi đúng người và vai trò producer");
  const wf = by("wf-del");
  ok(wf && wf.route === "workflow-api" && wf.status === 403 && wf.actor === "viewer", "workflow: thao tác bị chặn được ghi (route workflow-api)");
  ok(!by("wf-get"), "workflow: GET thành công không ghi (giảm nhiễu)");
  const s3 = by("s3");
  ok(s3 && s3.route === "s3-sts" && s3.status === 403 && s3.actor === null, "chạm kho tệp qua cổng S3 được ghi (route s3-sts, 403, không tin tiêu đề danh tính ở route này)");
  ok(!rows.some((x) => x.method === "OPTIONS"), "yêu cầu CORS preflight (OPTIONS) không ghi");
  ok(!by("ingest") || by("ingest").status === 401, "lần thử ghi giả nhật ký qua cổng chỉ để lại dấu vết 401, không có dòng giả nào lọt vào");
  ok(psql(`SELECT count(*) FROM audit_log WHERE path LIKE '%/gia%' AND actor IS NULL AND status = 200`) === "0", "dòng giả '/gia' không vào bảng nhật ký");

  // ---- Không lộ bí mật ----
  ok(psql(`SELECT count(*) FROM audit_log a WHERE a::text ~ 'eyJ|Basic |Bearer |${env.FLOWABLE_ADMIN_PASSWORD ?? "@@"}|${env.AUDIT_INGEST_KEY ?? "@@"}'`) === "0", "toàn bộ bảng nhật ký không chứa token, mật khẩu Flowable hay khóa nội bộ");

  // ---- Chỉ quản trị đọc ----
  for (const [name, tok] of [["hoa", hoa], ["tuan", tuan], ["ocop", ocop], ["viewer", viewer]]) {
    const a = await call(tok, "GET", "/api/trace/audit");
    const b = await call(tok, "GET", "/api/trace/audit/verify");
    ok(a.status === 403 && b.status === 403, `${name} không đọc/kiểm tra được nhật ký -> 403`);
  }
  ok((await call(null, "GET", "/api/trace/audit")).status === 401, "ẩn danh đọc nhật ký -> 401");
  const filt = await call(tester, "GET", `/api/trace/audit?actor=viewer&status_class=4&method=post&q=${TS}`);
  ok(filt.status === 200 && filt.json.rows.length >= 1 && filt.json.rows.every((x) => x.actor === "viewer" && x.status >= 400 && x.status < 500 && x.method === "POST"), "bộ lọc theo người dùng, nhóm kết quả, phương thức hoạt động");

  // ---- Bất biến ở CSDL (đối chứng: ở bước sau tắt trigger thì sửa được) ----
  ok(/chỉ được ghi thêm/.test(psqlFails(`UPDATE audit_log SET status = 200 WHERE id = (SELECT max(id) FROM audit_log)`) ?? ""), "CSDL từ chối UPDATE nhật ký");
  ok(/chỉ được ghi thêm/.test(psqlFails(`DELETE FROM audit_log WHERE id = (SELECT max(id) FROM audit_log)`) ?? ""), "CSDL từ chối DELETE nhật ký");
  ok(/chỉ được ghi thêm/.test(psqlFails(`TRUNCATE audit_log`) ?? ""), "CSDL từ chối TRUNCATE nhật ký");

  // ---- Chuỗi băm ----
  let ver = await call(tester, "GET", "/api/trace/audit/verify");
  ok(ver.status === 200 && ver.json.ok === true && ver.json.rows >= 7 && ver.json.broken === null, `chuỗi băm nguyên vẹn (${ver.json?.rows} dòng)`);

  const target = Number(psql(`SELECT id FROM audit_log WHERE actor = 'tester' AND path LIKE '%${TS}-tester%' LIMIT 1`));
  const original = psql(`SELECT coalesce(actor, '') FROM audit_log WHERE id = ${target}`);
  try {
    psql(`ALTER TABLE audit_log DISABLE TRIGGER USER`); // mô phỏng kẻ có quyền cao vượt qua trigger
    psql(`UPDATE audit_log SET actor = 'ke-gian' WHERE id = ${target}`);
    ver = await call(tester, "GET", "/api/trace/audit/verify");
    ok(ver.json.ok === false && ver.json.broken?.id === target && /sửa/.test(ver.json.broken.reason), `đối chứng: dù tắt trigger và sửa lén dòng #${target}, chuỗi băm phát hiện đúng dòng bị sửa`);
  } finally {
    // khôi phục NGUYÊN TRẠNG (giá trị cũ) rồi bật lại trigger, kể cả khi phép thử ở trên lỗi
    psql(`UPDATE audit_log SET actor = ${original === "" ? "NULL" : `'${original}'`} WHERE id = ${target}`);
    psql(`ALTER TABLE audit_log ENABLE TRIGGER USER`);
  }
  ver = await call(tester, "GET", "/api/trace/audit/verify");
  ok(ver.json.ok === true && ver.json.broken === null, "sau khi khôi phục nguyên trạng, chuỗi băm liền lại (và trigger đã bật lại)");
  ok(/chỉ được ghi thêm/.test(psqlFails(`UPDATE audit_log SET status = 200 WHERE id = ${target}`) ?? ""), "trigger bất biến đã bật lại sau phép thử");

  // ---- Dọn: sản phẩm thử. Nhật ký là chỉ-ghi-thêm nên không xóa dòng nào ----
  psql(`DELETE FROM trace_events WHERE product_id IN (SELECT id FROM products WHERE code = '${code}'); DELETE FROM products WHERE code = '${code}'`);
  console.log(fail ? `\n${fail} KIỂM TRA THẤT BẠI` : "\nTẤT CẢ ĐẠT");
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("LỖI:", e.message);
  process.exit(1);
});
