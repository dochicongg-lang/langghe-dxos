// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const lake = require("../lake");

test("chuẩn hóa giá trị theo kiểu cột", () => {
  assert.equal(lake.cell("INTEGER", "3.9"), 3);
  assert.equal(lake.cell("DOUBLE", "1.5"), 1.5);
  assert.equal(lake.cell("DATE", new Date("2026-11-14T10:00:00Z")), "2026-11-14");
  assert.equal(lake.cell("TIMESTAMP", new Date("2026-11-14T10:00:00.123Z")), "2026-11-14 10:00:00.123");
  assert.equal(lake.cell("VARCHAR", 12), "12");
  assert.equal(lake.cell("BOOLEAN", 1), true);
  assert.equal(lake.cell("DOUBLE", null), null);
  assert.equal(lake.cell("DOUBLE", undefined), null);
});

test("Parquet: ghi rồi truy vấn lại đúng số dòng, giá trị, null và kiểu", async () => {
  const cols = [{ name: "id", type: "INTEGER" }, { name: "name", type: "VARCHAR" }, { name: "v", type: "DOUBLE" }, { name: "d", type: "DATE" }, { name: "ok", type: "BOOLEAN" }];
  const buf = await lake.toParquet(cols, [
    { id: 1, name: "Bình gốm", v: 1150.5, d: "2026-11-14", ok: true },
    { id: 2, name: null, v: null, d: null, ok: false },
    { id: 3, name: "Đĩa", v: 100, d: "2026-01-02", ok: true },
  ]);
  assert.equal(buf.subarray(0, 4).toString(), "PAR1"); // chữ ký Parquet
  const r = await lake.queryParquet(buf, "SELECT count(*) AS n, count(name) AS named, sum(v) AS s, min(d)::VARCHAR AS dmin, bool_and(ok)::VARCHAR AS allok FROM {FILE}");
  assert.deepEqual(r, [{ n: 3, named: 2, s: 1250.5, dmin: "2026-01-02", allok: "false" }]);
  const u = await lake.queryParquet(buf, "SELECT name FROM {FILE} WHERE id = 1");
  assert.equal(u[0].name, "Bình gốm"); // tiếng Việt có dấu giữ nguyên
});

test("Parquet: từ chối tên cột hoặc kiểu không hợp lệ (chống chèn SQL qua tên cột)", async () => {
  await assert.rejects(lake.toParquet([{ name: "x; DROP TABLE t", type: "INTEGER" }], []), /cột không hợp lệ/);
  await assert.rejects(lake.toParquet([{ name: "x", type: "INTEGER); --" }], []), /cột không hợp lệ/);
});

test("mọi truy vấn phân tích chạy được trên dữ liệu mẫu của đúng bộ dữ liệu", async () => {
  const sample = {
    applications: [{ code: "OCOP-1", product_name: "A", product_group: "g", owner: "hoa", coop: "htx", state: "recognized", stars: 4, score: 75, decided_at: "2026-08-16", valid_until: "2029-08-16", created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-16T00:00:00Z" }],
    application_history: [{ application: "OCOP-1", action: "submit", from_state: "draft", to_state: "in_review", actor: "hoa", created_at: "2026-08-02T00:00:00Z", tier: "hot" }, { application: "OCOP-1", action: "result", from_state: "awaiting_result", to_state: "recognized", actor: "ocop", created_at: "2026-08-16T00:00:00Z", tier: "cold" }],
    kiln_runs: [{ product_code: "P1", category: "Gốm sứ", device_id: "kiln-01", started_at: "2026-10-01T00:00:00Z", ended_at: "2026-10-01T10:00:00Z", peak: 1150, avg_temp: 700, min_temp: 24, samples: 600, coverage: 1, verdict: "ok" }, { product_code: "P2", category: "Gốm sứ", device_id: "kiln-01", started_at: "2026-10-02T00:00:00Z", ended_at: "2026-10-02T10:00:00Z", peak: 1320, avg_temp: 800, min_temp: 24, samples: 600, coverage: 1, verdict: null }],
    audit_events: [{ id: 1, ts: "2026-11-14T00:00:00Z", actor: "tester", verified: true, method: "GET", route: "trace-api", status: 200, latency_ms: 12 }, { id: 2, ts: "2026-11-14T00:00:01Z", actor: null, verified: false, method: "GET", route: "trace-api", status: 401, latency_ms: 3 }],
  };
  for (const [id, a] of Object.entries(lake.ANALYTICS)) {
    const buf = await lake.toParquet(lake.DATASETS[a.dataset].columns, sample[a.dataset]);
    const rows = await lake.queryParquet(buf, a.sql);
    assert.ok(rows.length >= 1, `${id} phải trả ít nhất một dòng`);
  }
  const byVerdict = await lake.queryParquet(await lake.toParquet(lake.DATASETS.kiln_runs.columns, sample.kiln_runs), lake.ANALYTICS["kiln-by-verdict"].sql);
  assert.deepEqual(byVerdict.map((r) => r.verdict).sort(), ["không rõ", "ok"]); // verdict null được gom thành "không rõ"
  const byStatus = await lake.queryParquet(await lake.toParquet(lake.DATASETS.audit_events.columns, sample.audit_events), lake.ANALYTICS["audit-by-status"].sql);
  assert.deepEqual(byStatus.map((r) => [r.status_class, r.n]), [[200, 1], [400, 1]]);
});

test("cột của mỗi bộ dữ liệu đều hợp lệ và tên truy vấn trỏ tới bộ dữ liệu có thật", () => {
  for (const [name, ds] of Object.entries(lake.DATASETS)) {
    assert.ok(ds.columns.length > 0 && ds.title && typeof ds.collect === "function", name);
    assert.equal(new Set(ds.columns.map((c) => c.name)).size, ds.columns.length, `${name}: tên cột không được trùng`);
  }
  for (const a of Object.values(lake.ANALYTICS)) assert.ok(lake.DATASETS[a.dataset] && a.sql.includes("{FILE}"));
});
