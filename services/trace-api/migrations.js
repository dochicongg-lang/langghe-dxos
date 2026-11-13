// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use strict";
/**
 * Migration có phiên bản: các tệp migrations/NNNN_ten.sql chạy theo thứ tự, mỗi tệp một lần, ghi vào schema_migrations.
 * Mỗi tệp chạy trong một giao dịch; có khóa tư vấn để hai bản trace-api khởi động cùng lúc không chạy song song.
 */
const fs = require("node:fs");
const path = require("node:path");

const NAME_RE = /^(\d{4})_[a-z0-9_]+\.sql$/;

/** Tên tệp migration hợp lệ, sắp theo số thứ tự. Ném lỗi nếu trùng số hoặc sai tên. */
function listMigrationFiles(dir) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql"));
  const seen = new Set();
  for (const f of files) {
    const m = NAME_RE.exec(f);
    if (!m) throw new Error(`Tên migration không hợp lệ: ${f} (cần NNNN_ten.sql)`);
    if (seen.has(m[1])) throw new Error(`Trùng số thứ tự migration: ${m[1]}`);
    seen.add(m[1]);
  }
  return files.sort();
}

/** Các migration chưa chạy. Phát hiện trường hợp CSDL đã chạy một migration mà tệp không còn (lệch phiên bản). */
function pending(files, applied) {
  const known = new Set(files);
  for (const a of applied) if (!known.has(a)) throw new Error(`CSDL đã áp dụng migration không còn trong mã nguồn: ${a}`);
  return files.filter((f) => !applied.has(f));
}

async function runMigrations(pool, dir) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(727001)");
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
    const { rows } = await client.query("SELECT version FROM schema_migrations");
    const todo = pending(listMigrationFiles(dir), new Set(rows.map((r) => r.version)));
    for (const f of todo) {
      const sql = fs.readFileSync(path.join(dir, f), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [f]);
        await client.query("COMMIT");
        console.log(`[trace-api] đã áp dụng migration ${f}`);
      } catch (e) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${f} lỗi: ${e.message}`);
      }
    }
    return todo;
  } finally {
    await client.query("SELECT pg_advisory_unlock(727001)").catch(() => {});
    client.release();
  }
}

module.exports = { listMigrationFiles, pending, runMigrations };
