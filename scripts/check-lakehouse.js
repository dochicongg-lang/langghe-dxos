// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
// Kiểm tra THẬT hồ dữ liệu phân tích (Parquet + DuckDB) và truy vết nguồn gốc dữ liệu, qua cổng gác + Keycloak + trace-api + PostgreSQL + MinIO:
//  - chỉ quản trị dùng được; xuất đủ 4 bộ dữ liệu sang Parquet thật trong MinIO;
//  - số dòng trong Parquet KHỚP PostgreSQL (và kho lạnh), kết quả phân tích khớp truy vấn SQL trực tiếp trên PostgreSQL;
//  - băm SHA-256 ghi trong sổ truy vết KHỚP băm của tệp thật lấy từ MinIO; nguồn đầu vào (bảng, tệp lưu trữ lạnh kèm băm) được ghi lại;
//  - mỗi lần xuất tạo tệp MỚI (tệp cũ còn nguyên); ĐỐI CHỨNG: sổ truy vết bị sửa thì truy vấn từ chối (không dùng dữ liệu không toàn vẹn).
// Chạy: node scripts/check-lakehouse.js   (sau bash scripts/upgrade.sh; nên có dữ liệu mẫu: node scripts/seed-demo.js)
const fs = require("fs");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split(/\r?\n/).map((l) => l.match(/^([A-Za-z_]\w*)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const GW = `http://localhost:${Number(env.APISIX_GATEWAY_PORT ?? 9080)}`;
const KC = `http://localhost:8080/realms/${env.KEYCLOAK_REALM ?? "dxos"}/protocol/openid-connect/token`;
const DOCS = env.DOCS_BUCKET ?? "dxos-docs";
let fail = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fail++;
};
const psql = (sql) => execFileSync("docker", ["exec", "dxos-postgres", "psql", "-U", env.POSTGRES_USER ?? "postgres", "-d", env.TRACE_DB ?? "traceability", "-tAc", sql], { encoding: "utf8" }).trim();
const rootCat = (key) =>
  execFileSync("docker", ["exec", "-e", `MC_HOST_x=http://${env.MINIO_ROOT_USER}:${env.MINIO_ROOT_PASSWORD}@localhost:9000`, "dxos-minio", "mc", "cat", `x/${DOCS}/${key}`], { maxBuffer: 64 * 1024 * 1024, env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
const token = async (user) => {
  const r = await fetch(KC, { method: "POST", body: new URLSearchParams({ grant_type: "password", client_id: env.KEYCLOAK_CLIENT_ID, client_secret: env.KEYCLOAK_CLIENT_SECRET, username: user, password: user }) });
  const j = await r.json();
  if (!j.access_token) throw new Error(`không lấy được token của ${user}`);
  return j.access_token;
};
const api = async (tok, method, path, body) => {
  const r = await fetch(`${GW}/api/trace${path}`, { method, headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const sum = (rows, k) => rows.reduce((s, r) => s + Number(r[k]), 0);

(async () => {
  const [tester, hoa, viewer] = await Promise.all(["tester", "hoa", "viewer"].map(token));

  // ---- phân quyền ----
  ok((await api(hoa, "GET", "/lake")).status === 403, "producer không xem được hồ dữ liệu (403)");
  ok((await api(hoa, "POST", "/lake/export")).status === 403, "producer không xuất được (403)");
  ok((await api(viewer, "GET", "/lake/analytics/applications-by-state")).status === 403, "viewer không truy vấn phân tích được (403)");

  // cần có kho lạnh để kiểm chứng việc hợp nhất nóng và lạnh
  if (Number(psql("SELECT count(*) FROM archive_runs")) === 0) await api(tester, "POST", "/archive/run", { keep_days: 0 });
  const coldRows = Number(psql("SELECT coalesce(sum(row_count), 0) FROM archive_runs"));
  const auditBefore = Number(psql("SELECT count(*) FROM audit_log"));

  // ---- xuất ----
  const ex = await api(tester, "POST", "/lake/export");
  ok(ex.status === 200 && ex.json.exported?.length === 4, `quản trị xuất 4 bộ dữ liệu: ${ex.json?.exported?.map((d) => `${d.dataset}=${d.rows}`).join(", ")}`);
  const by = Object.fromEntries((ex.json.exported ?? []).map((d) => [d.dataset, d]));
  const appsDb = Number(psql("SELECT count(*) FROM ocop_applications"));
  const histHot = Number(psql("SELECT count(*) FROM ocop_application_history"));
  const kilnDb = Number(psql("SELECT count(*) FROM trace_events WHERE iot IS NOT NULL"));
  ok(by.applications?.rows === appsDb, `Parquet hồ sơ = PostgreSQL: ${by.applications?.rows} dòng`);
  ok(by.application_history?.rows === histHot + coldRows, `Parquet lịch sử = nóng (${histHot}) + lạnh (${coldRows}) = ${by.application_history?.rows}`);
  ok(by.kiln_runs?.rows === kilnDb && kilnDb > 0, `Parquet mẻ nung = PostgreSQL: ${by.kiln_runs?.rows} dòng`);
  ok(by.audit_events?.rows >= auditBefore, `Parquet nhật ký kiểm toán có ${by.audit_events?.rows} dòng (>= ${auditBefore} lúc bắt đầu)`);

  // ---- tệp thật trong MinIO ----
  for (const d of ex.json.exported) {
    const bytes = rootCat(d.object_key);
    const real = crypto.createHash("sha256").update(bytes).digest("hex");
    ok(bytes.subarray(0, 4).toString() === "PAR1" && real === d.sha256 && bytes.length === d.size, `${d.dataset}: tệp Parquet thật trong MinIO, băm và cỡ khớp sổ (${d.object_key.split("/").pop()})`);
  }

  // ---- truy vết nguồn gốc ----
  const ov = await api(tester, "GET", "/lake");
  const hist = ov.json.datasets.find((d) => d.dataset === "application_history").latest;
  const cold = hist.lineage.filter((l) => l.tier === "cold");
  const archives = psql("SELECT id || ':' || sha256 FROM archive_runs ORDER BY id").split("\n").filter(Boolean);
  ok(cold.length === archives.length && cold.every((l) => archives.includes(`${l.archive_run}:${l.sha256}`)), `truy vết lịch sử ghi đủ ${cold.length} tệp lưu trữ lạnh kèm băm đúng với sổ lưu trữ`);
  ok(ov.json.datasets.find((d) => d.dataset === "applications").latest.lineage.some((l) => l.source === "postgres:ocop_applications"), "truy vết hồ sơ ghi nguồn postgres:ocop_applications");
  ok(ov.json.datasets.find((d) => d.dataset === "audit_events").latest.lineage.some((l) => /không xuất đường dẫn/.test(l.note ?? "")), "truy vết nhật ký ghi rõ việc bỏ đường dẫn và IP");
  ok(ov.json.analytics.length === 5, "tổng quan liệt kê 5 truy vấn phân tích");

  // ---- kết quả phân tích khớp truy vấn trực tiếp trên PostgreSQL ----
  const st = await api(tester, "GET", "/lake/analytics/applications-by-state");
  const dbStates = Object.fromEntries(psql("SELECT state || ':' || count(*) FROM ocop_applications GROUP BY state").split("\n").map((l) => l.split(":")));
  ok(st.status === 200 && st.json.rows.length === Object.keys(dbStates).length && st.json.rows.every((r) => Number(dbStates[r.state]) === r.n), `hồ sơ theo trạng thái (DuckDB trên Parquet) khớp GROUP BY của PostgreSQL: ${st.json.rows.map((r) => `${r.state}=${r.n}`).join(", ")}`);
  const mo = await api(tester, "GET", "/lake/analytics/applications-by-month");
  ok(sum(mo.json.rows, "n") === appsDb, "tổng hồ sơ theo tháng = số hồ sơ trong PostgreSQL");
  const kv = await api(tester, "GET", "/lake/analytics/kiln-by-verdict");
  ok(sum(kv.json.rows, "runs") === kilnDb, `mẻ nung theo kết luận: ${kv.json.rows.map((r) => `${r.verdict}=${r.runs}`).join(", ")}`);
  const ht = await api(tester, "GET", "/lake/analytics/history-by-tier");
  ok(sum(ht.json.rows, "n") === by.application_history.rows && ht.json.rows.some((r) => r.tier === "cold") && ht.json.rows.some((r) => r.tier === "hot"), "lịch sử theo tầng gồm cả tầng nóng và tầng lạnh, tổng đúng");
  ok((await api(tester, "GET", "/lake/analytics/khong-co")).status === 404, "truy vấn phân tích không tồn tại -> 404 (không nhận SQL tùy ý)");
  ok((await api(tester, "GET", "/lake/analytics/..%2F..%2Fetc")).status === 404, "tên truy vấn lạ -> 404");

  // ---- mỗi lần xuất tạo tệp mới; tệp cũ còn nguyên ----
  const runsBefore = Number(psql("SELECT count(*) FROM lake_runs WHERE dataset = 'applications'"));
  const oldKey = by.applications.object_key;
  const ex2 = await api(tester, "POST", "/lake/export");
  const runsAfter = Number(psql("SELECT count(*) FROM lake_runs WHERE dataset = 'applications'"));
  ok(runsAfter === runsBefore + 1 && ex2.json.exported.find((d) => d.dataset === "applications").object_key !== oldKey, "xuất lần nữa tạo tệp và dòng truy vết MỚI");
  ok(rootCat(oldKey).subarray(0, 4).toString() === "PAR1", "tệp của lần xuất trước vẫn còn nguyên (không ghi đè)");

  // ---- ĐỐI CHỨNG: sổ truy vết bị sửa thì từ chối dùng dữ liệu ----
  const lastId = psql("SELECT id FROM lake_runs WHERE dataset = 'applications' ORDER BY id DESC LIMIT 1");
  const goodHash = psql(`SELECT sha256 FROM lake_runs WHERE id = ${lastId}`);
  try {
    psql(`UPDATE lake_runs SET sha256 = '${"0".repeat(64)}' WHERE id = ${lastId}`);
    const bad = await api(tester, "GET", "/lake/analytics/applications-by-state");
    ok(bad.status === 502, "sổ truy vết bị sửa băm => truy vấn bị từ chối (502), không dùng dữ liệu không toàn vẹn");
  } finally {
    psql(`UPDATE lake_runs SET sha256 = '${goodHash}' WHERE id = ${lastId}`);
  }
  ok((await api(tester, "GET", "/lake/analytics/applications-by-state")).status === 200, "khôi phục sổ truy vết thì truy vấn chạy lại bình thường");

  console.log(fail ? `\n${fail} KIỂM TRA THẤT BẠI` : "\nTẤT CẢ ĐẠT");
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("Lỗi:", e.message);
  process.exit(2);
});
