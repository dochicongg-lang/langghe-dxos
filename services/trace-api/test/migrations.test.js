// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { listMigrationFiles, pending, runMigrations } = require("../migrations");

const REPO_DIR = path.join(__dirname, "..", "migrations");

test("migration của repo: tên hợp lệ, liên tục từ 0001, theo thứ tự", () => {
  const files = listMigrationFiles(REPO_DIR);
  assert.ok(files.length >= 2);
  files.forEach((f, i) => assert.equal(f.slice(0, 4), String(i + 1).padStart(4, "0"), `thiếu số thứ tự trước ${f}`));
});

test("migration nền chạy được trên CSDL cũ (dùng IF NOT EXISTS) và migration miền chỉ thêm cột nullable", () => {
  const base = fs.readFileSync(path.join(REPO_DIR, "0001_baseline.sql"), "utf8");
  assert.ok(/CREATE TABLE IF NOT EXISTS products/.test(base) && /CREATE TABLE IF NOT EXISTS trace_events/.test(base));
  const domain = fs.readFileSync(path.join(REPO_DIR, "0002_domain.sql"), "utf8");
  assert.ok(!/DROP |ALTER TABLE \w+ DROP|RENAME|NOT NULL DEFAULT.*products/i.test(domain.replace(/CREATE TABLE[\s\S]*?\);/g, "")), "migration miền không được xóa/đổi tên/ép NOT NULL lên bảng cũ");
  for (const col of ["owner_username", "coop_id", "village_id", "facility_id"]) assert.match(domain, new RegExp(`ADD COLUMN IF NOT EXISTS ${col}`));
});

test("pending: chỉ trả các migration chưa chạy", () => {
  const files = ["0001_a.sql", "0002_b.sql", "0003_c.sql"];
  assert.deepEqual(pending(files, new Set(["0001_a.sql"])), ["0002_b.sql", "0003_c.sql"]);
  assert.deepEqual(pending(files, new Set(files)), []);
});

test("pending: phát hiện CSDL đã chạy migration không còn trong mã nguồn", () => {
  assert.throws(() => pending(["0001_a.sql"], new Set(["0001_a.sql", "0009_la.sql"])), /không còn trong mã nguồn/);
});

test("listMigrationFiles: từ chối tên sai và số trùng", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mig-"));
  fs.writeFileSync(path.join(dir, "0001_a.sql"), "");
  fs.writeFileSync(path.join(dir, "0001_b.sql"), "");
  assert.throws(() => listMigrationFiles(dir), /Trùng số thứ tự/);
  fs.unlinkSync(path.join(dir, "0001_b.sql"));
  fs.writeFileSync(path.join(dir, "ten-sai.sql"), "");
  assert.throws(() => listMigrationFiles(dir), /không hợp lệ/);
});

function fakePool(applied = [], failOn = null) {
  const log = [];
  const client = {
    query: async (sql, params) => {
      log.push(sql.trim().split("\n")[0].slice(0, 60));
      if (/SELECT version FROM schema_migrations/.test(sql)) return { rows: applied.map((version) => ({ version })) };
      if (failOn && sql.includes(failOn)) throw new Error("boom");
      return { rows: [] };
    },
    release: () => log.push("release"),
  };
  return { log, pool: { connect: async () => client } };
}

test("runMigrations: chạy từng migration chưa áp dụng trong giao dịch, có khóa tư vấn", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mig-"));
  fs.writeFileSync(path.join(dir, "0001_a.sql"), "SELECT 1;");
  fs.writeFileSync(path.join(dir, "0002_b.sql"), "SELECT 2;");
  const { pool, log } = fakePool(["0001_a.sql"]);
  const done = await runMigrations(pool, dir);
  assert.deepEqual(done, ["0002_b.sql"]);
  assert.equal(log[0], "SELECT pg_advisory_lock(727001)");
  assert.ok(log.includes("BEGIN") && log.includes("COMMIT") && !log.includes("ROLLBACK"));
  assert.ok(log.includes("SELECT pg_advisory_unlock(727001)") && log.at(-1) === "release");
});

test("runMigrations: lỗi thì ROLLBACK, không ghi đã áp dụng, và vẫn nhả khóa", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mig-"));
  fs.writeFileSync(path.join(dir, "0001_a.sql"), "SELECT hong;");
  const { pool, log } = fakePool([], "SELECT hong");
  await assert.rejects(runMigrations(pool, dir), /Migration 0001_a.sql lỗi: boom/);
  assert.ok(log.includes("ROLLBACK") && !log.includes("COMMIT"));
  assert.ok(log.includes("SELECT pg_advisory_unlock(727001)") && log.at(-1) === "release");
});
