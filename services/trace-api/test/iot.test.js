"use strict";
// Chạy: cd services/trace-api && npm test   (dùng node:test có sẵn, không cần cài thêm gì)
const test = require("node:test");
const assert = require("node:assert/strict");
const { IotError, parseWindow, keyTime, dayPrefixes, selectKeys, collectPoints, summarize, createS3Client, buildEvidence } = require("../iot");

const NOW = Date.parse("2026-11-12T16:00:00Z");
const win = (o = {}) => ({ deviceId: "kiln-01", from: "2026-11-12T15:00:00Z", to: "2026-11-12T15:30:00Z", ...o });
const reading = (t, v, extra = {}) =>
  JSON.stringify({ deviceId: "kiln-01", deviceName: "Lò nung", metric: "temperature", value: v, unit: "°C", timestamp: new Date(t).toISOString(), ...extra });

test("parseWindow: chấp nhận cửa sổ hợp lệ và đổi sang mili giây", () => {
  const w = parseWindow(win(), NOW);
  assert.equal(w.deviceId, "kiln-01");
  assert.equal(w.to - w.from, 30 * 60 * 1000);
});

test("parseWindow: từ chối đầu vào sai", () => {
  const bad = [
    [null, /đối tượng/],
    [[], /đối tượng/],
    [win({ deviceId: "" }), /deviceId/],
    [win({ deviceId: "../x" }), /deviceId/],
    [win({ deviceId: "a".repeat(61) }), /deviceId/],
    [win({ from: "không phải ngày" }), /from/],
    [win({ to: undefined }), /to/],
    [win({ from: "2026-11-12T15:30:00Z", to: "2026-11-12T15:00:00Z" }), /sau iot.from/],
    [win({ from: "2026-11-01T00:00:00Z", to: "2026-11-12T15:00:00Z" }), /72 giờ/],
    [win({ to: "2026-11-13T00:00:00Z" }), /tương lai/],
  ];
  for (const [input, re] of bad) assert.throws(() => parseWindow(input, NOW), (e) => e instanceof IotError && e.status === 400 && re.test(e.message), JSON.stringify(input));
});

test("parseWindow: bỏ qua các trường tự khai thêm (min/avg/max/curve)", () => {
  const w = parseWindow({ ...win(), min: 9999, max: 9999, curve: [[1, 1]] }, NOW);
  assert.deepEqual(Object.keys(w).sort(), ["deviceId", "from", "to"]);
});

test("keyTime đọc thời gian từ tên tệp", () => {
  assert.equal(keyTime("iot/2026-11-12/2026-11-12T15-20-28-909Z.ndjson"), Date.parse("2026-11-12T15:20:28.909Z"));
  assert.ok(Number.isNaN(keyTime("iot/2026-11-12/readme.txt")));
});

test("dayPrefixes phủ qua nửa đêm UTC", () => {
  const p = dayPrefixes(Date.parse("2026-11-12T23:00:00Z"), Date.parse("2026-11-13T01:00:00Z"));
  assert.deepEqual(p, ["iot/2026-11-12/", "iot/2026-11-13/"]);
});

test("selectKeys giữ tệp trong khoảng (kèm đệm phía sau) và sắp xếp", () => {
  const from = Date.parse("2026-11-12T15:00:00Z");
  const to = Date.parse("2026-11-12T15:30:00Z");
  const keys = [
    "iot/2026-11-12/2026-11-12T15-31-00-000Z.ndjson", // trong đệm 5 phút -> giữ
    "iot/2026-11-12/2026-11-12T14-59-59-000Z.ndjson", // trước khoảng -> bỏ
    "iot/2026-11-12/2026-11-12T15-10-00-000Z.ndjson",
    "iot/2026-11-12/2026-11-12T15-40-00-000Z.ndjson", // quá đệm -> bỏ
    "iot/2026-11-12/note.txt", // không đúng định dạng -> bỏ
  ];
  assert.deepEqual(selectKeys(keys, from, to), [
    "iot/2026-11-12/2026-11-12T15-10-00-000Z.ndjson",
    "iot/2026-11-12/2026-11-12T15-31-00-000Z.ndjson",
  ]);
});

test("collectPoints lọc đúng thiết bị, chỉ số, khoảng thời gian và bỏ dòng lỗi", () => {
  const from = Date.parse("2026-11-12T15:00:00Z");
  const to = Date.parse("2026-11-12T15:30:00Z");
  const body = [
    reading(from + 1000, 900),
    reading(from + 2000, 910, { deviceId: "kiln-02" }), // sai thiết bị
    reading(from + 3000, 50, { metric: "humidity" }), // sai chỉ số
    reading(from - 1000, 800), // trước khoảng
    reading(to + 1000, 800), // sau khoảng
    "{dòng hỏng",
    "",
    reading(from + 4000, "không phải số"), // giá trị sai kiểu
    reading(from + 500, 880),
  ].join("\n");
  const pts = collectPoints([body], "kiln-01", from, to);
  assert.deepEqual(pts.map((p) => p.v), [880, 900]); // đã sắp xếp theo thời gian
});

test("summarize: min/avg/max và làm tròn 1 chữ số", () => {
  const t = Date.parse("2026-11-12T15:00:00Z");
  const pts = [100, 200, 301].map((v, i) => ({ t: t + i * 1000, v, name: "Lò", unit: "°C" }));
  const s = summarize(pts, "kiln-01", t, t + 3000);
  assert.equal(s.count, 3);
  assert.equal(s.min, 100);
  assert.equal(s.max, 301);
  assert.equal(s.avg, 200.3);
  assert.equal(s.deviceName, "Lò");
  assert.equal(s.curve.length, 3);
});

test("summarize: rút gọn đường cong còn tối đa 60 điểm, giữ thứ tự thời gian", () => {
  const t = Date.parse("2026-11-12T15:00:00Z");
  const pts = Array.from({ length: 500 }, (_, i) => ({ t: t + i * 1000, v: i, name: "", unit: "°C" }));
  const s = summarize(pts, "kiln-01", t, t + 500000);
  assert.equal(s.count, 500);
  assert.equal(s.curve.length, 60);
  for (let i = 1; i < s.curve.length; i++) assert.ok(s.curve[i][0] > s.curve[i - 1][0] && s.curve[i][1] > s.curve[i - 1][1]);
});

test("summarize: không có mẫu -> null", () => {
  assert.equal(summarize([], "kiln-01", 0, 1), null);
});

test("buildEvidence: đọc từ S3 giả lập, bỏ qua số liệu tự khai, đóng dấu verifiedAt", async () => {
  const from = Date.parse("2026-11-12T15:00:00Z");
  const key = "iot/2026-11-12/2026-11-12T15-10-00-000Z.ndjson";
  const s3 = {
    listKeys: async (prefix) => (prefix === "iot/2026-11-12/" ? [key] : []),
    getObject: async (k) => {
      assert.equal(k, key);
      return [reading(from + 60000, 1000), reading(from + 120000, 1100)].join("\n");
    },
  };
  const w = parseWindow({ ...win(), max: 99999 }, NOW);
  const ev = await buildEvidence(w, s3);
  assert.equal(ev.max, 1100);
  assert.equal(ev.min, 1000);
  assert.equal(ev.count, 2);
  assert.ok(ev.verifiedAt);
});

test("buildEvidence: không có dữ liệu -> 422", async () => {
  const s3 = { listKeys: async () => [], getObject: async () => "" };
  await assert.rejects(buildEvidence(parseWindow(win(), NOW), s3), (e) => e instanceof IotError && e.status === 422);
});

test("buildEvidence: quá nhiều tệp -> 400", async () => {
  const keys = Array.from({ length: 2001 }, (_, i) => `iot/2026-11-12/2026-11-12T15-${String(10 + Math.floor(i / 60) % 20).padStart(2, "0")}-${String(i % 60).padStart(2, "0")}-000Z.ndjson`);
  const s3 = { listKeys: async () => keys, getObject: async () => "" };
  await assert.rejects(buildEvidence(parseWindow(win(), NOW), s3), (e) => e instanceof IotError && e.status === 400);
});

test("createS3Client: ký SigV4 đúng dạng, liệt kê có phân trang", async () => {
  const calls = [];
  const pages = [
    "<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>tok&amp;1</NextContinuationToken><Contents><Key>iot/a&amp;b.ndjson</Key></Contents></ListBucketResult>",
    "<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>iot/c.ndjson</Key></Contents></ListBucketResult>",
  ];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, headers: opts.headers });
    return { ok: true, status: 200, text: async () => pages[calls.length - 1] };
  };
  const c = createS3Client({ endpoint: "http://minio:9000", accessKey: "AK", secretKey: "SK", bucket: "dxos-data", fetchImpl });
  const keys = await c.listKeys("iot/2026-11-12/");
  assert.deepEqual(keys, ["iot/a&b.ndjson", "iot/c.ndjson"]); // đã giải mã &amp;
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /^http:\/\/minio:9000\/dxos-data\?list-type=2&prefix=iot%2F2026-11-12%2F$/);
  assert.match(calls[1].url, /continuation-token=tok%261/); // token đã giải mã rồi mã hóa lại đúng
  assert.match(calls[0].headers.authorization, /^AWS4-HMAC-SHA256 Credential=AK\/\d{8}\/us-east-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
});

test("createS3Client: lỗi HTTP được ném ra", async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, text: async () => "" });
  const c = createS3Client({ endpoint: "http://minio:9000", accessKey: "AK", secretKey: "SK", bucket: "b", fetchImpl });
  await assert.rejects(c.getObject("iot/x.ndjson"), /403/);
});
