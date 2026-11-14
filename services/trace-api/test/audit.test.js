// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
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

// ---------- Neo băm đầu chuỗi ----------
const H = (n) => String(n).padStart(2, "0").repeat(32); // băm giả 64 ký tự hex
const anchorStore = () => {
  const objects = new Map();
  return {
    objects,
    listKeys: async (prefix) => [...objects.keys()].filter((k) => k.startsWith(prefix)),
    putObject: async (k, body) => void objects.set(k, Buffer.from(body)),
    getObjectBuffer: async (k) => objects.get(k),
  };
};
const anchorPool = (rows) => ({
  query: async (sql, params) => {
    if (/ORDER BY id DESC LIMIT 1/.test(sql)) return { rows: rows.length ? [rows[rows.length - 1]] : [] };
    if (/count\(\*\)/.test(sql)) return { rows: [{ n: rows.length }] };
    if (/ANY\(\$1/.test(sql)) return { rows: rows.filter((r) => params[0].includes(r.id)) };
    throw new Error(`truy vấn không dự kiến: ${sql}`);
  },
});

test("khóa bản neo: sắp theo id, đọc ngược lại được, khóa lạ bị từ chối", () => {
  const k = audit.anchorKey(145, "ab".repeat(32));
  assert.equal(k, "anchors/000000000145-abababababab.json");
  assert.deepEqual(audit.parseAnchorKey(k), { id: 145, hashPrefix: "abababababab" });
  assert.equal(audit.parseAnchorKey("anchors/../x.json"), null);
  assert.equal(audit.parseAnchorKey("khac/000000000145-abababababab.json"), null);
  assert.ok(audit.anchorKey(9, H(1)) < audit.anchorKey(10, H(1))); // sắp theo thứ tự chữ cũng là theo id
});

test("đối chiếu bản neo: nguyên vẹn, bị cắt dòng cuối, bị tính lại chuỗi", () => {
  const anchors = [{ id: 3, hash: H(3) }, { id: 5, hash: H(5) }];
  const rows = (ids, over = {}) => new Map(ids.map((i) => [i, over[i] ?? H(i)]));
  const ok = audit.checkAnchors(anchors, rows([1, 2, 3, 4, 5, 6]));
  assert.deepEqual([ok.ok, ok.checked, ok.latest, ok.broken], [true, 2, 5, null]);
  const cut = audit.checkAnchors(anchors, rows([1, 2, 3, 4])); // dòng 5 (đã neo) bị cắt
  assert.equal(cut.ok, false);
  assert.equal(cut.broken.id, 5);
  assert.match(cut.broken.reason, /cắt bớt|bị xóa/);
  const redo = audit.checkAnchors(anchors, rows([1, 2, 3, 4, 5], { 3: H(99) })); // băm dòng 3 bị tính lại
  assert.equal(redo.ok, false);
  assert.equal(redo.broken.id, 3);
  assert.match(redo.broken.reason, /tính lại/);
  assert.equal(audit.checkAnchors([], rows([1])).ok, true); // chưa có bản neo nào thì không có gì để đối chiếu
});

test("ghi bản neo: chỉ ghi khi có dòng mới hơn bản neo gần nhất", async () => {
  const s3 = anchorStore();
  const rows = [{ id: 1, hash: H(1) }, { id: 2, hash: H(2) }];
  assert.equal(await audit.writeAnchor(anchorPool([]), s3), null); // chưa có nhật ký
  const a1 = await audit.writeAnchor(anchorPool(rows), s3, new Date("2026-11-14T10:00:00Z"));
  assert.equal(a1.id, 2);
  assert.equal(a1.count, 2);
  const stored = JSON.parse(s3.objects.get(a1.key).toString());
  assert.deepEqual([stored.v, stored.id, stored.hash, stored.at], [1, 2, H(2), "2026-11-14T10:00:00.000Z"]);
  assert.equal((await audit.writeAnchor(anchorPool(rows), s3)).skipped, "unchanged"); // không đổi: không ghi thêm
  assert.equal(s3.objects.size, 1);
  const a2 = await audit.writeAnchor(anchorPool([...rows, { id: 3, hash: H(3) }]), s3);
  assert.equal(a2.id, 3);
  assert.equal(s3.objects.size, 2);
});

test("kiểm tra bản neo end-to-end với kho giả: nguyên vẹn, cắt cuối, sửa bản neo", async () => {
  const s3 = anchorStore();
  const rows = [1, 2, 3, 4].map((i) => ({ id: i, hash: H(i) }));
  await audit.writeAnchor(anchorPool(rows.slice(0, 2)), s3);
  await audit.writeAnchor(anchorPool(rows), s3);
  assert.equal((await audit.verifyAnchors(anchorPool(rows), s3)).ok, true);
  const cut = await audit.verifyAnchors(anchorPool(rows.slice(0, 3)), s3); // cắt dòng 4 đã neo
  assert.equal(cut.ok, false);
  assert.equal(cut.broken.id, 4);
  const [k] = [...s3.objects.keys()].slice(-1);
  s3.objects.set(k, Buffer.from(JSON.stringify({ v: 1, id: 4, hash: H(77) }))); // sửa nội dung bản neo
  const tampered = await audit.verifyAnchors(anchorPool(rows), s3);
  assert.equal(tampered.ok, false);
  assert.match(tampered.broken.reason, /không khớp tên khóa/);
});

test("S3 client: listKeys lật trang ListObjectsV2 và giải mã XML", async () => {
  const { createS3Client } = require("../iot");
  const calls = [];
  const pages = [
    "<ListBucketResult><Contents><Key>anchors/a&amp;1.json</Key></Contents><IsTruncated>true</IsTruncated><NextContinuationToken>tok1</NextContinuationToken></ListBucketResult>",
    "<ListBucketResult><Contents><Key>anchors/b2.json</Key></Contents><IsTruncated>false</IsTruncated></ListBucketResult>",
  ];
  const fakeFetch = async (url) => {
    calls.push(url);
    return { ok: true, status: 200, text: async () => pages[calls.length - 1] };
  };
  const s3 = createS3Client({ endpoint: "http://minio:9000", accessKey: "k", secretKey: "s", bucket: "dxos-audit", fetchImpl: fakeFetch });
  assert.deepEqual(await s3.listKeys("anchors/"), ["anchors/a&1.json", "anchors/b2.json"]);
  assert.match(calls[0], /\/dxos-audit\?list-type=2&prefix=anchors%2F$/);
  assert.match(calls[1], /continuation-token=tok1/);
});
