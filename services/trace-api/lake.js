// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use strict";
/**
 * Hồ dữ liệu phân tích (nguyên lý "dữ liệu về hồ để phân tích") và truy vết nguồn gốc dữ liệu (lineage).
 *
 * Xuất các bộ dữ liệu đã làm sạch từ PostgreSQL (tầng nóng) và từ kho lạnh (NDJSON của vòng đời dữ liệu) sang tệp Parquet trong MinIO
 * (bucket tệp, tiền tố lake/), rồi truy vấn phân tích bằng DuckDB trực tiếp trên tệp Parquet. Mỗi lần xuất ghi một dòng truy vết
 * (bảng lake_runs): bộ dữ liệu, số dòng, cột, khóa đối tượng, băm SHA-256 và NGUỒN đầu vào (bảng nào, tệp lưu trữ nào kèm băm).
 * Truy vấn phân tích là các mẫu CỐ ĐỊNH (không nhận SQL tùy ý từ người dùng).
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DuckDBInstance } = require("@duckdb/node-api");

const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
const LOCK_KEY = 727003; // khóa tư vấn: một lần xuất tại một thời điểm

/** Chạy hàm với một kết nối DuckDB trong bộ nhớ, luôn đóng sau khi xong. */
async function withDuck(fn) {
  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  try {
    return await fn(conn);
  } finally {
    conn.closeSync?.();
    instance.closeSync?.();
  }
}

const tmpFile = (ext) => path.join(os.tmpdir(), `dxos-lake-${process.pid}-${crypto.randomBytes(6).toString("hex")}.${ext}`);
const quote = (p) => `'${p.replace(/\\/g, "/").replace(/'/g, "''")}'`;
const SQL_TYPES = new Set(["VARCHAR", "INTEGER", "BIGINT", "DOUBLE", "BOOLEAN", "DATE", "TIMESTAMP"]);

/** Chuẩn hóa giá trị JS cho DuckDB theo kiểu cột (null giữ nguyên). */
function cell(type, v) {
  if (v === null || v === undefined) return null;
  switch (type) {
    case "DATE":
      return new Date(v).toISOString().slice(0, 10);
    case "TIMESTAMP":
      return new Date(v).toISOString().replace("T", " ").replace("Z", "");
    case "INTEGER":
    case "BIGINT":
      return Math.trunc(Number(v));
    case "DOUBLE":
      return Number(v);
    case "BOOLEAN":
      return Boolean(v);
    default:
      return String(v);
  }
}

/** Ghi các dòng thành tệp Parquet (trả Buffer). columns: [{ name, type }]. Dùng bảng tạm trong DuckDB rồi COPY ra tệp tạm. */
async function toParquet(columns, rows) {
  for (const c of columns) {
    if (!/^[a-z_][a-z0-9_]*$/.test(c.name) || !SQL_TYPES.has(c.type)) throw new Error(`cột không hợp lệ: ${c.name} ${c.type}`);
  }
  const file = tmpFile("parquet");
  try {
    await withDuck(async (conn) => {
      await conn.run(`CREATE TABLE t (${columns.map((c) => `${c.name} ${c.type}`).join(", ")})`);
      const appender = await conn.createAppender("t");
      for (const r of rows) {
        for (const c of columns) {
          const v = cell(c.type, r[c.name]);
          if (v === null) appender.appendNull();
          else if (c.type === "VARCHAR" || c.type === "DATE" || c.type === "TIMESTAMP") appender.appendVarchar(v);
          else if (c.type === "INTEGER") appender.appendInteger(v);
          else if (c.type === "BIGINT") appender.appendBigInt(BigInt(v));
          else if (c.type === "DOUBLE") appender.appendDouble(v);
          else appender.appendBoolean(v);
        }
        appender.endRow();
      }
      appender.closeSync();
      await conn.run(`COPY t TO ${quote(file)} (FORMAT PARQUET, COMPRESSION ZSTD)`);
    });
    return fs.readFileSync(file);
  } finally {
    fs.rmSync(file, { force: true });
  }
}

/** Chạy một truy vấn (mẫu cố định, chứa {FILE}) trên nội dung Parquet; trả mảng đối tượng với số đã đổi từ chuỗi/BigInt. */
async function queryParquet(buf, sqlTemplate) {
  const file = tmpFile("parquet");
  fs.writeFileSync(file, buf);
  try {
    return await withDuck(async (conn) => {
      const res = await conn.runAndReadAll(sqlTemplate.split("{FILE}").join(`read_parquet(${quote(file)})`));
      return res.getRowObjectsJson().map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v])));
    });
  } finally {
    fs.rmSync(file, { force: true });
  }
}

// ---------- Bộ dữ liệu ----------
const DATASETS = {
  applications: {
    title: "Hồ sơ OCOP",
    columns: [
      { name: "code", type: "VARCHAR" }, { name: "product_name", type: "VARCHAR" }, { name: "product_group", type: "VARCHAR" },
      { name: "owner", type: "VARCHAR" }, { name: "coop", type: "VARCHAR" }, { name: "state", type: "VARCHAR" },
      { name: "stars", type: "INTEGER" }, { name: "score", type: "DOUBLE" }, { name: "decided_at", type: "DATE" }, { name: "valid_until", type: "DATE" },
      { name: "created_at", type: "TIMESTAMP" }, { name: "updated_at", type: "TIMESTAMP" },
    ],
    async collect({ pool }) {
      const { rows } = await pool.query(
        `SELECT a.code, a.product_name, a.product_group, a.owner_username AS owner, c.code AS coop, a.state, r.stars, r.score::float AS score,
           r.decided_at, r.valid_until, a.created_at, a.updated_at
         FROM ocop_applications a LEFT JOIN cooperatives c ON c.id = a.coop_id
         LEFT JOIN LATERAL (SELECT * FROM ocop_results x WHERE x.application_id = a.id ORDER BY x.id DESC LIMIT 1) r ON TRUE ORDER BY a.id`,
      );
      return { rows, lineage: [{ source: "postgres:ocop_applications", rows: rows.length }, { source: "postgres:ocop_results", note: "kết quả mới nhất của mỗi hồ sơ" }, { source: "postgres:cooperatives" }] };
    },
  },
  application_history: {
    title: "Lịch sử xử lý hồ sơ (nóng và lạnh)",
    columns: [
      { name: "application", type: "VARCHAR" }, { name: "action", type: "VARCHAR" }, { name: "from_state", type: "VARCHAR" }, { name: "to_state", type: "VARCHAR" },
      { name: "actor", type: "VARCHAR" }, { name: "created_at", type: "TIMESTAMP" }, { name: "tier", type: "VARCHAR" },
    ],
    async collect({ pool, readArchive }) {
      const hot = (
        await pool.query(
          `SELECT a.code AS application, h.action, h.from_state, h.to_state, h.actor, h.created_at FROM ocop_application_history h JOIN ocop_applications a ON a.id = h.application_id ORDER BY h.id`,
        )
      ).rows.map((r) => ({ ...r, tier: "hot" }));
      const lineage = [{ source: "postgres:ocop_application_history", rows: hot.length, tier: "hot" }];
      const cold = [];
      for (const run of (await pool.query("SELECT id, object_key, sha256, row_count FROM archive_runs ORDER BY id")).rows) {
        const data = await readArchive(run.id); // đã kiểm băm theo sổ lưu trữ
        for (const r of data) cold.push({ application: r.application, action: r.action, from_state: r.from_state, to_state: r.to_state, actor: r.actor, created_at: r.created_at, tier: "cold" });
        lineage.push({ source: `minio:${run.object_key}`, sha256: run.sha256, rows: data.length, tier: "cold", archive_run: run.id });
      }
      return { rows: [...hot, ...cold], lineage };
    },
  },
  kiln_runs: {
    title: "Mẻ nung và mẻ nhuộm có bằng chứng cảm biến",
    columns: [
      { name: "product_code", type: "VARCHAR" }, { name: "category", type: "VARCHAR" }, { name: "device_id", type: "VARCHAR" }, { name: "started_at", type: "TIMESTAMP" },
      { name: "ended_at", type: "TIMESTAMP" }, { name: "peak", type: "DOUBLE" }, { name: "avg_temp", type: "DOUBLE" }, { name: "min_temp", type: "DOUBLE" },
      { name: "samples", type: "INTEGER" }, { name: "coverage", type: "DOUBLE" }, { name: "verdict", type: "VARCHAR" },
    ],
    async collect({ pool, kiln }) {
      const { rows } = await pool.query(
        `SELECT p.code AS product_code, p.category, e.iot FROM trace_events e JOIN products p ON p.id = e.product_id WHERE e.iot IS NOT NULL ORDER BY e.id`,
      );
      const out = rows.map((r) => {
        const iot = r.iot;
        let verdict = null;
        try {
          verdict = kiln.analyze(iot, kiln.pickProfile(kiln.config, r.category)).verdict;
        } catch {
          verdict = null;
        }
        return {
          product_code: r.product_code, category: r.category, device_id: iot.deviceId, started_at: iot.from, ended_at: iot.to,
          peak: iot.max, avg_temp: iot.avg, min_temp: iot.min, samples: iot.count, coverage: iot.quality?.coverage ?? null, verdict,
        };
      });
      return { rows: out, lineage: [{ source: "postgres:trace_events", note: "chỉ công đoạn có bằng chứng IoT (cột iot, đã được máy chủ đối chiếu)", rows: out.length }, { source: "config:kiln-profiles", note: "kết luận (verdict) tính bằng bộ luật, chưa so với mẻ khác" }] };
    },
  },
  audit_events: {
    title: "Nhật ký kiểm toán (đã bỏ nội dung nhạy cảm)",
    columns: [
      { name: "id", type: "BIGINT" }, { name: "ts", type: "TIMESTAMP" }, { name: "actor", type: "VARCHAR" }, { name: "verified", type: "BOOLEAN" },
      { name: "method", type: "VARCHAR" }, { name: "route", type: "VARCHAR" }, { name: "status", type: "INTEGER" }, { name: "latency_ms", type: "INTEGER" },
    ],
    async collect({ pool }) {
      const { rows } = await pool.query("SELECT id, ts, actor, verified, method, route, status, latency_ms FROM audit_log ORDER BY id");
      return { rows, lineage: [{ source: "postgres:audit_log", rows: rows.length, note: "không xuất đường dẫn và IP; bảng nguồn là chỉ-ghi-thêm có chuỗi băm" }] };
    },
  },
};

// ---------- Truy vấn phân tích (mẫu cố định) ----------
const ANALYTICS = {
  "applications-by-state": { dataset: "applications", title: "Hồ sơ theo trạng thái", sql: "SELECT state, count(*) AS n FROM {FILE} GROUP BY state ORDER BY n DESC, state" },
  "applications-by-month": {
    dataset: "applications",
    title: "Hồ sơ lập theo tháng và số sao trung bình",
    sql: "SELECT strftime(created_at, '%Y-%m') AS month, count(*) AS n, round(avg(stars), 2) AS avg_stars FROM {FILE} GROUP BY 1 ORDER BY 1",
  },
  "history-by-tier": { dataset: "application_history", title: "Lịch sử xử lý theo tầng lưu trữ", sql: "SELECT tier, action, count(*) AS n FROM {FILE} GROUP BY tier, action ORDER BY tier, n DESC, action" },
  "kiln-by-verdict": { dataset: "kiln_runs", title: "Mẻ nung và mẻ nhuộm theo kết luận", sql: "SELECT coalesce(verdict, 'không rõ') AS verdict, count(*) AS runs, round(avg(peak), 1) AS avg_peak, max(peak) AS max_peak FROM {FILE} GROUP BY 1 ORDER BY runs DESC, verdict" },
  "audit-by-status": { dataset: "audit_events", title: "Yêu cầu API theo nhóm mã trạng thái", sql: "SELECT (status // 100) * 100 AS status_class, count(*) AS n, round(avg(latency_ms), 1) AS avg_latency_ms FROM {FILE} GROUP BY 1 ORDER BY 1" },
};

/**
 * Xuất mọi bộ dữ liệu sang Parquet. deps: { pool, s3, kiln: { analyze, pickProfile, config }, readArchive(id) }.
 * Mỗi tệp được ĐỌC LẠI từ MinIO và đối chiếu băm trước khi ghi sổ truy vết. Trả { skipped: "busy" } nếu đang có lần xuất khác.
 */
async function exportAll(deps, triggeredBy, now = new Date()) {
  const { pool, s3 } = deps;
  const client = await pool.connect();
  let locked = false;
  try {
    const lock = await client.query("SELECT pg_try_advisory_lock($1) AS ok", [LOCK_KEY]);
    if (!lock.rows[0].ok) return { skipped: "busy" };
    locked = true;
    const stamp = now.toISOString().replace(/[-:.]/g, "").slice(0, 15);
    const results = [];
    for (const [name, ds] of Object.entries(DATASETS)) {
      const { rows, lineage } = await ds.collect(deps);
      const buf = await toParquet(ds.columns, rows);
      const hash = sha256(buf);
      const key = `lake/${name}/dt=${now.toISOString().slice(0, 10)}/${name}-${stamp}-${hash.slice(0, 8)}.parquet`;
      await s3.putObject(key, buf, "application/vnd.apache.parquet");
      if (sha256(await s3.getObjectBuffer(key)) !== hash) throw new Error(`Tệp ${key} đọc lại không khớp băm, hủy`);
      const { rows: ins } = await client.query(
        "INSERT INTO lake_runs (dataset, rows, object_key, sha256, size, columns, lineage, triggered_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
        [name, rows.length, key, hash, buf.length, JSON.stringify(ds.columns), JSON.stringify(lineage), triggeredBy],
      );
      results.push({ dataset: name, run_id: ins[0].id, rows: rows.length, object_key: key, sha256: hash, size: buf.length });
    }
    return { exported: results };
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
    client.release();
  }
}

/** Tổng quan: mỗi bộ dữ liệu với lần xuất mới nhất (kèm truy vết nguồn) và số lần đã xuất. */
async function overview(pool) {
  const out = [];
  for (const [name, ds] of Object.entries(DATASETS)) {
    const { rows } = await pool.query(
      "SELECT id, rows, object_key, sha256, size, columns, lineage, triggered_by, created_at, (SELECT count(*)::int FROM lake_runs WHERE dataset = $1) AS runs FROM lake_runs WHERE dataset = $1 ORDER BY id DESC LIMIT 1",
      [name],
    );
    out.push({ dataset: name, title: ds.title, columns: ds.columns, latest: rows[0] ?? null });
  }
  return { datasets: out, analytics: Object.entries(ANALYTICS).map(([id, a]) => ({ id, title: a.title, dataset: a.dataset })) };
}

/** Chạy một truy vấn phân tích trên Parquet mới nhất của bộ dữ liệu; kiểm băm theo sổ truy vết trước khi dùng. */
async function runAnalytics(pool, s3, name) {
  const a = ANALYTICS[name];
  if (!a) return null;
  const { rows } = await pool.query("SELECT id, object_key, sha256, created_at FROM lake_runs WHERE dataset = $1 ORDER BY id DESC LIMIT 1", [a.dataset]);
  if (!rows.length) return { id: name, title: a.title, dataset: a.dataset, exported: false, rows: [] };
  const buf = await s3.getObjectBuffer(rows[0].object_key);
  if (sha256(buf) !== rows[0].sha256) throw new Error("Tệp Parquet không khớp băm trong sổ truy vết");
  return { id: name, title: a.title, dataset: a.dataset, exported: true, from_run: rows[0].id, sha256: rows[0].sha256, as_of: rows[0].created_at, rows: await queryParquet(buf, a.sql) };
}

module.exports = { DATASETS, ANALYTICS, toParquet, queryParquet, exportAll, overview, runAnalytics, cell };
