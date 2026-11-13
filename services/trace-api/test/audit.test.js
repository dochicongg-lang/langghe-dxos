"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const audit = require("../audit");

const RAW = { time: "2026-11-13T10:00:00+00:00", client_ip: "172.18.0.1", method: "post", uri: "/api/trace/products?x=1", status: "201", route: "trace-api", request_time: "0.0123", audit_user: "tester", audit_roles: "editor,default-roles-dxos" };

test("chuẩn hóa dòng thô: chữ hoa phương thức, ép kiểu, danh tính chỉ ở route có Lua", () => {
  const e = audit.normalize(RAW);
  assert.equal(e.method, "POST");
  assert.equal(e.status, 201);
  assert.equal(e.actor, "tester");
  assert.deepEqual(e.roles, ["editor", "default-roles-dxos"]);
  assert.equal(e.verified, true); // thành công = token đã được xác thực
  assert.equal(e.latencyMs, 12);
  assert.equal(e.ts.toISOString(), "2026-11-13T10:00:00.000Z");
  assert.equal(e.path, "/api/trace/products?x=1");
});

test("danh tính trên yêu cầu bị từ chối là tự khai (verified = false)", () => {
  assert.equal(audit.normalize({ ...RAW, status: 401 }).verified, false);
  assert.equal(audit.normalize({ ...RAW, status: 403 }).verified, false);
  assert.equal(audit.normalize({ ...RAW, status: 404 }).actor, "tester"); // vẫn ghi lại nhưng không xác thực
  assert.equal(audit.normalize({ ...RAW, status: 404 }).verified, false);
});

test("route không có Lua (s3, public) KHÔNG tin tiêu đề danh tính (client tự đặt được)", () => {
  for (const route of ["s3-sts", "trace-public", "bat-ky"]) {
    const e = audit.normalize({ ...RAW, route, status: 403 });
    assert.equal(e.actor, null);
    assert.deepEqual(e.roles, []);
    assert.equal(e.verified, false);
  }
});

test("làm sạch danh tính và vai trò, từ chối giá trị lạ", () => {
  assert.equal(audit.normalize({ ...RAW, audit_user: "a b; DROP TABLE" }).actor, null);
  assert.equal(audit.normalize({ ...RAW, audit_user: "x".repeat(65) }).actor, null);
  assert.equal(audit.normalize({ ...RAW, audit_user: "" }).actor, null);
  assert.equal(audit.normalize({ ...RAW, audit_user: "hoa.nguyen@htx-1" }).actor, "hoa.nguyen@htx-1");
  assert.deepEqual(audit.normalize({ ...RAW, audit_roles: "producer,<script>,coop-officer, " }).roles, ["producer", "coop-officer"]);
  assert.equal(audit.normalize({ ...RAW, audit_roles: Array(30).fill("r").join(",") }).roles.length, 10);
});

test("dòng thô hỏng bị loại; trường quá dài bị cắt; thời gian hỏng dùng giờ hiện tại", () => {
  for (const bad of [null, undefined, "x", 5, {}, { ...RAW, method: "" }, { ...RAW, method: "POST;DROP" }, { ...RAW, status: "abc" }, { ...RAW, status: 99 }, { ...RAW, status: 700 }]) assert.equal(audit.normalize(bad), null, JSON.stringify(bad));
  assert.equal(audit.normalize({ ...RAW, uri: "/" + "a".repeat(1000) }).path.length, 300);
  const now = Date.now();
  assert.ok(Math.abs(audit.normalize({ ...RAW, time: "không phải ngày" }).ts.getTime() - now) < 5000);
  assert.equal(audit.normalize({ ...RAW, request_time: "abc" }).latencyMs, 0);
});

test("lọc nhiễu: trace-api giữ hết; workflow chỉ ghi/đổi hoặc lỗi; route khác chỉ khi bị từ chối; OPTIONS bỏ", () => {
  const keep = (over) => audit.shouldKeep(audit.normalize({ ...RAW, ...over }));
  assert.equal(keep({ method: "GET", status: 200 }), true); // trace-api: mọi yêu cầu
  assert.equal(keep({ method: "OPTIONS", status: 200 }), false);
  assert.equal(keep({ route: "workflow-api", method: "GET", status: 200 }), false);
  assert.equal(keep({ route: "workflow-api", method: "GET", status: 403 }), true);
  assert.equal(keep({ route: "workflow-api", method: "POST", status: 201 }), true);
  assert.equal(keep({ route: "workflow-api", method: "DELETE", status: 403 }), true);
  assert.equal(keep({ route: "s3-sts", method: "PUT", status: 200 }), false); // ghi S3 thành công: quá nhiều, không ghi
  assert.equal(keep({ route: "s3-sts", method: "GET", status: 403 }), true);
  assert.equal(keep({ route: "trace-public", method: "GET", status: 200 }), false);
  assert.equal(keep({ route: "trace-public", method: "GET", status: 429 }), true);
  assert.equal(audit.shouldKeep(null), false);
});

/** Cơ sở dữ liệu giả: lưu các dòng được chèn để kiểm tra việc nối chuỗi và dựng lại. */
function fakePool() {
  const rows = [];
  const log = [];
  const client = {
    async query(sql, params) {
      log.push(sql.replace(/\s+/g, " ").trim().slice(0, 40));
      if (sql.startsWith("SELECT hash FROM audit_log")) return { rows: rows.length ? [{ hash: rows.at(-1).hash }] : [] };
      if (sql.startsWith("INSERT INTO audit_log")) {
        const [ts, actor, roles, verified, ip, method, path, status, route, latency_ms, prev_hash, hash] = params;
        rows.push({ id: rows.length + 1, ts, actor, roles, verified, ip, method, path, status, route, latency_ms, prev_hash, hash });
      }
      return { rows: [] };
    },
    release() {},
  };
  return { rows, log, pool: { connect: async () => client, query: async () => ({ rows }) } };
}

const E = (over = {}) => audit.normalize({ ...RAW, ...over });

test("nối chuỗi băm: dòng đầu nối với GENESIS, mỗi dòng nối với băm dòng trước, cùng một giao dịch", async () => {
  const { pool, rows, log } = fakePool();
  assert.equal(await audit.appendEntries(pool, [E(), E({ uri: "/b" }), E({ uri: "/c", status: 403 })]), 3);
  assert.equal(rows[0].prev_hash, audit.GENESIS);
  assert.equal(rows[1].prev_hash, rows[0].hash);
  assert.equal(rows[2].prev_hash, rows[1].hash);
  assert.equal(log[0], "BEGIN");
  assert.ok(log.includes("COMMIT"));
  assert.ok(log.some((l) => l.includes("pg_advisory_xact_lock")), "phải tuần tự hóa bằng khóa tư vấn");
  // lô sau nối tiếp lô trước
  await audit.appendEntries(pool, [E({ uri: "/d" })]);
  assert.equal(rows[3].prev_hash, rows[2].hash);
  assert.equal(await audit.appendEntries(pool, []), 0);
});

test("kiểm tra chuỗi: nguyên vẹn thì ok; sửa nội dung, xóa dòng, chèn dòng, đảo thứ tự đều bị phát hiện đúng vị trí", async () => {
  const { pool, rows } = fakePool();
  await audit.appendEntries(pool, [E(), E({ uri: "/b" }), E({ uri: "/c" }), E({ uri: "/d" })]);
  const clone = () => rows.map((r) => ({ ...r }));
  assert.deepEqual(audit.checkRows(clone()), { ok: true, rows: 4, broken: null });
  assert.deepEqual(await audit.verifyChain(pool), { ok: true, rows: 4, broken: null });
  assert.deepEqual(audit.checkRows([]), { ok: true, rows: 0, broken: null });

  const edited = clone();
  edited[1].actor = "ke-gian"; // sửa lén người thực hiện
  const r1 = audit.checkRows(edited);
  assert.equal(r1.ok, false);
  assert.equal(r1.broken.id, 2);
  assert.match(r1.broken.reason, /sửa/);

  const statusEdited = clone();
  statusEdited[2].status = 200; // sửa 403 thành 200
  assert.equal(audit.checkRows(statusEdited).broken.id, 3);

  const deleted = clone();
  deleted.splice(1, 1); // xóa dòng giữa
  const r2 = audit.checkRows(deleted);
  assert.equal(r2.ok, false);
  assert.equal(r2.broken.id, 3);
  assert.match(r2.broken.reason, /đứt/);

  const headDeleted = clone().slice(1); // xóa dòng đầu
  assert.equal(audit.checkRows(headDeleted).ok, false);

  const swapped = clone();
  [swapped[1], swapped[2]] = [swapped[2], swapped[1]];
  assert.equal(audit.checkRows(swapped).ok, false);

  const inserted = clone();
  inserted.splice(2, 0, { ...inserted[1], id: 99 }); // chèn bản sao
  assert.equal(audit.checkRows(inserted).ok, false);
});

test("băm xác định và nhạy với từng trường", () => {
  const e = E();
  assert.equal(audit.entryHash(audit.GENESIS, e), audit.entryHash(audit.GENESIS, { ...e }));
  assert.equal(audit.entryHash(audit.GENESIS, e).length, 64);
  for (const change of [{ actor: "khac" }, { status: 500 }, { path: "/khac" }, { method: "PUT" }, { ip: "1.2.3.4" }, { verified: false }, { roles: ["x"] }, { latencyMs: 1 }, { route: "khac" }, { ts: new Date("2020-01-01") }]) {
    assert.notEqual(audit.entryHash(audit.GENESIS, { ...e, ...change }), audit.entryHash(audit.GENESIS, e), JSON.stringify(change));
  }
  assert.notEqual(audit.entryHash("a".repeat(64), e), audit.entryHash(audit.GENESIS, e));
});

test("truy vấn: bộ lọc đi vào tham số (không nối chuỗi), giới hạn 1..500", async () => {
  const calls = [];
  const pool = { query: async (sql, params) => (calls.push({ sql, params }), { rows: [] }) };
  await audit.query(pool, { actor: "hoa", method: "post", statusClass: "4", q: "100%_x", before: 50, limit: 99999 });
  const { sql, params } = calls[0];
  assert.deepEqual(params, ["hoa", "POST", 400, "%100\\%\\_x%", 50]);
  assert.match(sql, /actor = \$1 AND method = \$2 AND status >= \$3 AND status < \$3 \+ 100 AND path ILIKE \$4 AND id < \$5/);
  assert.match(sql, /LIMIT 500$/);
  assert.ok(!sql.includes("hoa"), "giá trị lọc không được nằm trong câu SQL");
  await audit.query(pool, { limit: 0 });
  assert.match(calls[1].sql, /LIMIT 100$/); // 0 không hợp lệ: dùng mặc định
  assert.doesNotMatch(calls[1].sql, /WHERE/);
  await audit.query(pool, { statusClass: "9", before: "abc" });
  assert.doesNotMatch(calls[2].sql, /WHERE/); // nhóm trạng thái và 'before' sai bị bỏ qua
});
