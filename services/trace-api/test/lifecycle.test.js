// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const lc = require("../lifecycle");

const NOW = new Date("2026-11-13T10:00:00.000Z");
const ROWS = [
  { id: 1, application_id: 10, application: "OCOP-A", action: "create", from_state: null, to_state: "draft", actor: "hoa", note: "", created_at: "2026-01-01T00:00:00Z" },
  { id: 2, application_id: 10, application: "OCOP-A", action: "submit", from_state: "draft", to_state: "in_review", actor: "hoa", note: "", created_at: "2026-01-02T00:00:00Z" },
  { id: 3, application_id: 11, application: "OCOP-B", action: "create", from_state: null, to_state: "draft", actor: "hoa", note: "", created_at: "2026-01-03T00:00:00Z" },
];

/** Cơ sở dữ liệu giả: ghi lại thứ tự các lệnh để kiểm tra trình tự an toàn. */
function fakePool({ rows = ROWS, lock = true } = {}) {
  const log = [];
  const client = {
    async query(sql, params) {
      const s = sql.replace(/\s+/g, " ").trim();
      log.push({ s, params });
      if (s.includes("pg_try_advisory_lock")) return { rows: [{ ok: lock }] };
      if (s.startsWith("SELECT h.id")) return { rows };
      if (s.startsWith("INSERT INTO archive_runs")) return { rows: [{ id: 7 }] };
      if (s.startsWith("SELECT state")) return { rows: [{ state: "recognized" }] };
      return { rows: [] };
    },
    release() {
      log.push({ s: "RELEASE" });
    },
  };
  return { log, pool: { connect: async () => client, query: client.query } };
}

function fakeS3({ corrupt = false, failPut = false, events } = {}) {
  const store = new Map();
  return {
    store,
    async putObject(key, buf) {
      events?.push("PUT");
      if (failPut) throw new Error("MinIO từ chối");
      store.set(key, buf);
    },
    async getObjectBuffer(key) {
      events?.push("GET");
      return corrupt ? Buffer.from("hỏng") : store.get(key);
    },
  };
}

test("đóng gói NDJSON gzip: đi và về giống hệt, có băm ổn định", () => {
  const a = lc.pack(ROWS);
  assert.deepEqual(lc.unpack(a.buf), ROWS);
  assert.equal(lc.pack(ROWS).sha256, a.sha256);
  assert.equal(a.sha256.length, 64);
  assert.ok(a.buf.length < Buffer.byteLength(JSON.stringify(ROWS)) * 2);
});

test("khóa đối tượng nằm dưới archive/<bảng>/<năm>/<tháng>/", () => {
  const k = lc.objectKey("ocop_application_history", NOW, "abcdef0123456789");
  assert.match(k, /^archive\/ocop_application_history\/2026\/11\/run-20261113T10[0-9]{4}-abcdef01\.ndjson\.gz$/);
});

test("số ngày giữ ở tầng nóng: chỉ nhận số nguyên 0..3650", () => {
  assert.equal(lc.validateKeepDays("90"), 90);
  assert.equal(lc.validateKeepDays(0), 0);
  for (const bad of [-1, 3651, 1.5, "abc", null, undefined, "", true, false]) assert.throws(() => lc.validateKeepDays(bad), /0 đến 3650/);
});

test("lưu trữ thành công: ghi kho lạnh, ĐỌC LẠI đối chiếu băm, rồi mới ghi sổ và xóa ở tầng nóng", async () => {
  const events = [];
  const { pool, log } = fakePool();
  const s3 = fakeS3({ events });
  const real = pool.connect;
  pool.connect = async () => {
    const c = await real();
    const q = c.query;
    c.query = async (sql, params) => {
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) events.push(sql);
      else if (/^DELETE FROM ocop_application_history/.test(sql.trim())) events.push("DELETE");
      return q(sql, params);
    };
    return c;
  };
  const r = await lc.archiveApplicationHistory(pool, s3, { keepDays: 30, triggeredBy: "tester", now: NOW });
  assert.deepEqual(events, ["PUT", "GET", "BEGIN", "DELETE", "COMMIT"]); // đúng trình tự an toàn
  assert.equal(r.run_id, 7);
  assert.equal(r.rows, 3);
  assert.equal(r.applications, 2);
  // đối tượng đã lưu giải nén ra đúng dữ liệu (không kèm application_id nội bộ)
  const stored = lc.unpack([...s3.store.values()][0]);
  assert.equal(stored.length, 3);
  assert.equal(stored[0].application, "OCOP-A");
  assert.ok(!("application_id" in stored[0]));
  // mỗi hồ sơ được ghi một dòng tóm tắt, và đúng các id đã lưu bị xóa
  const summaries = log.filter((l) => l.s.startsWith("INSERT INTO ocop_application_history"));
  assert.equal(summaries.length, 2);
  assert.match(summaries[0].params[3], /Đã lưu trữ 2 bản ghi.*#7/);
  assert.deepEqual(log.find((l) => l.s.startsWith("DELETE FROM ocop_application_history")).params[0], [1, 2, 3]);
  assert.ok(log.some((l) => l.s.includes("pg_advisory_unlock")), "phải nhả khóa tư vấn");
  assert.equal(log.at(-1).s, "RELEASE");
});

test("chỉ chọn hồ sơ đã kết thúc, bỏ dòng tóm tắt archive, mốc thời gian đúng; có thể giới hạn một hồ sơ", async () => {
  const { pool, log } = fakePool();
  await lc.archiveApplicationHistory(pool, fakeS3(), { keepDays: 30, now: NOW, application: "OCOP-A" });
  const sel = log.find((l) => l.s.startsWith("SELECT h.id"));
  assert.deepEqual(sel.params[0], ["rejected", "recognized", "not_recognized"]);
  assert.equal(sel.params[1].toISOString(), "2026-10-14T10:00:00.000Z"); // 30 ngày trước NOW
  assert.equal(sel.params[2], "OCOP-A");
  assert.match(sel.s, /h\.action <> 'archive'/);
  assert.match(sel.s, /a\.state = ANY\(\$1\)/);
});

test("băm đọc lại không khớp: hủy, KHÔNG xóa dữ liệu nóng, không ghi sổ", async () => {
  const { pool, log } = fakePool();
  await assert.rejects(lc.archiveApplicationHistory(pool, fakeS3({ corrupt: true }), { keepDays: 0, now: NOW }), /không khớp băm/);
  assert.ok(!log.some((l) => /^(BEGIN|DELETE|INSERT INTO archive_runs)/.test(l.s)));
  assert.ok(log.some((l) => l.s.includes("pg_advisory_unlock")), "vẫn nhả khóa khi lỗi");
});

test("ghi kho lạnh thất bại: hủy, không xóa dữ liệu nóng", async () => {
  const { pool, log } = fakePool();
  await assert.rejects(lc.archiveApplicationHistory(pool, fakeS3({ failPut: true }), { keepDays: 0, now: NOW }), /MinIO/);
  assert.ok(!log.some((l) => /^(BEGIN|DELETE)/.test(l.s)));
});

test("không có gì để lưu trữ -> null và không đụng kho lạnh; tiến trình khác đang chạy -> bỏ qua", async () => {
  const s3 = fakeS3();
  assert.equal(await lc.archiveApplicationHistory(fakePool({ rows: [] }).pool, s3, { keepDays: 30, now: NOW }), null);
  assert.equal(s3.store.size, 0);
  const busy = fakePool({ lock: false });
  assert.deepEqual(await lc.archiveApplicationHistory(busy.pool, s3, { keepDays: 30, now: NOW }), { skipped: "busy" });
  assert.ok(!busy.log.some((l) => l.s.startsWith("SELECT h.id")));
  assert.ok(!busy.log.some((l) => l.s.includes("pg_advisory_unlock")), "không nhả khóa của tiến trình khác");
});

test("đọc lại một lần lưu trữ: kiểm băm theo sổ, báo lỗi nếu bị sửa", async () => {
  const packed = lc.pack(ROWS);
  const s3 = { getObjectBuffer: async () => packed.buf };
  const pool = { query: async () => ({ rows: [{ object_key: "k", sha256: packed.sha256 }] }) };
  assert.deepEqual(await lc.readRun(pool, s3, 7), ROWS);
  const tampered = { query: async () => ({ rows: [{ object_key: "k", sha256: "0".repeat(64) }] }) };
  await assert.rejects(lc.readRun(tampered, s3, 7), /không khớp băm/);
  assert.equal(await lc.readRun({ query: async () => ({ rows: [] }) }, s3, 99), null);
});
