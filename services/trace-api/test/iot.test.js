"use strict";
// Chạy: cd services/trace-api && npm test   (dùng node:test có sẵn, không cần cài thêm gì)
const test = require("node:test");
const assert = require("node:assert/strict");
const { IotError, parseWindow, keyTime, folderOf, dayPrefixes, selectKeys, collectPoints, assess, summarize, createS3Client, buildEvidence } = require("../iot");

// Bộ chuyển đổi cho các fake S3 kiểu cũ (chỉ có listKeys): mỗi tệp có đúng một phiên bản.
const asVersions = (s3) => ({
  listVersions: async (p) => (await s3.listKeys(p)).map((key) => ({ key, versionId: "v1", lastModified: 1, isDeleteMarker: false })),
  getObject: (k, id) => s3.getObject(k, id),
});

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

test("folderOf khớp ${jwt:preferred_username} của service account trong Keycloak", () => {
  assert.equal(folderOf("dxos-iot"), "service-account-dxos-iot");
});

test("dayPrefixes: chỉ trong thư mục của gateway, phủ qua nửa đêm UTC", () => {
  const p = dayPrefixes(Date.parse("2026-11-12T23:00:00Z"), Date.parse("2026-11-13T01:00:00Z"), "gw1");
  assert.deepEqual(p, ["iot/service-account-gw1/2026-11-12/", "iot/service-account-gw1/2026-11-13/"]);
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
  const key = "iot/service-account-gw1/2026-11-12/2026-11-12T15-10-00-000Z.ndjson";
  const s3 = {
    listKeys: async (prefix) => (prefix === "iot/service-account-gw1/2026-11-12/" ? [key] : []),
    getObject: async (k) => {
      assert.equal(k, key);
      return [reading(from + 60000, 1000), reading(from + 120000, 1100)].join("\n");
    },
  };
  const w = parseWindow({ ...win(), max: 99999 }, NOW);
  const ev = await buildEvidence(w, asVersions(s3), "gw1");
  assert.equal(ev.max, 1100);
  assert.equal(ev.min, 1000);
  assert.equal(ev.count, 2);
  assert.equal(ev.gateway, "gw1");
  assert.ok(ev.verifiedAt);
});

test("buildEvidence: chỉ đọc thư mục của gateway sở hữu, số liệu giả từ gateway khác bị bỏ qua", async () => {
  const from = Date.parse("2026-11-12T15:00:00Z");
  const listed = [];
  const own = "iot/service-account-gw1/2026-11-12/2026-11-12T15-10-00-000Z.ndjson";
  const forged = "iot/service-account-gw2/2026-11-12/2026-11-12T15-10-00-000Z.ndjson"; // gw2 ghi deviceId của gw1
  const s3 = {
    listKeys: async (prefix) => {
      listed.push(prefix);
      return [own, forged].filter((k) => k.startsWith(prefix));
    },
    getObject: async (k) => (k === own ? reading(from + 60000, 1000) : reading(from + 60000, 9999)),
  };
  const ev = await buildEvidence(parseWindow(win(), NOW), asVersions(s3), "gw1");
  assert.equal(ev.max, 1000);
  assert.ok(listed.every((p) => p.startsWith("iot/service-account-gw1/")), "không được liệt kê thư mục gateway khác: " + listed);
});

test("buildEvidence: không có dữ liệu -> 422", async () => {
  const s3 = { listKeys: async () => [], getObject: async () => "" };
  await assert.rejects(buildEvidence(parseWindow(win(), NOW), asVersions(s3), "gw1"), (e) => e instanceof IotError && e.status === 422);
});

test("buildEvidence: quá nhiều tệp -> 400", async () => {
  const keys = Array.from({ length: 2001 }, (_, i) => `iot/service-account-gw1/2026-11-12/2026-11-12T15-${String(Math.floor(i / 60) % 30).padStart(2, "0")}-${String(i % 60).padStart(2, "0")}-${String(i % 1000).padStart(3, "0")}Z.ndjson`);
  const s3 = { listKeys: async () => keys, getObject: async () => "" };
  await assert.rejects(buildEvidence(parseWindow(win(), NOW), asVersions(s3), "gw1"), (e) => e instanceof IotError && e.status === 400);
});

test("createS3Client: ký SigV4 đúng dạng, liệt kê phiên bản có phân trang", async () => {
  const calls = [];
  const pages = [
    "<ListVersionsResult><IsTruncated>true</IsTruncated><NextKeyMarker>iot/a&amp;b.ndjson</NextKeyMarker><NextVersionIdMarker>vm1</NextVersionIdMarker>" +
      "<Version><Key>iot/a&amp;b.ndjson</Key><VersionId>v2</VersionId><IsLatest>true</IsLatest><LastModified>2026-11-12T15:00:02.000Z</LastModified></Version>" +
      "<Version><Key>iot/a&amp;b.ndjson</Key><VersionId>v1</VersionId><IsLatest>false</IsLatest><LastModified>2026-11-12T15:00:01.000Z</LastModified></Version></ListVersionsResult>",
    "<ListVersionsResult><IsTruncated>false</IsTruncated>" +
      "<DeleteMarker><Key>iot/c.ndjson</Key><VersionId>d1</VersionId><IsLatest>true</IsLatest><LastModified>2026-11-12T15:00:03.000Z</LastModified></DeleteMarker>" +
      "<Version><Key>iot/c.ndjson</Key><VersionId>c1</VersionId><IsLatest>false</IsLatest><LastModified>2026-11-12T15:00:00.000Z</LastModified></Version></ListVersionsResult>",
  ];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, headers: opts.headers });
    return { ok: true, status: 200, text: async () => pages[calls.length - 1] };
  };
  const c = createS3Client({ endpoint: "http://minio:9000", accessKey: "AK", secretKey: "SK", bucket: "dxos-iot", fetchImpl });
  const vs = await c.listVersions("iot/service-account-gw1/2026-11-12/");
  assert.deepEqual(
    vs.map((v) => [v.key, v.versionId, v.isDeleteMarker]),
    [["iot/a&b.ndjson", "v2", false], ["iot/a&b.ndjson", "v1", false], ["iot/c.ndjson", "d1", true], ["iot/c.ndjson", "c1", false]],
  );
  assert.equal(vs[1].lastModified, Date.parse("2026-11-12T15:00:01.000Z"));
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /^http:\/\/minio:9000\/dxos-iot\?prefix=iot%2Fservice-account-gw1%2F2026-11-12%2F&versions=$/);
  assert.match(calls[1].url, /key-marker=iot%2Fa%26b\.ndjson&prefix=.*&version-id-marker=vm1&versions=$/); // dấu phân trang đã giải mã rồi mã hóa lại đúng
  assert.match(calls[0].headers.authorization, /^AWS4-HMAC-SHA256 Credential=AK\/\d{8}\/us-east-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
});

test("createS3Client: getObject gửi versionId khi có, bỏ qua khi là null", async () => {
  const urls = [];
  const fetchImpl = async (url) => (urls.push(url), { ok: true, status: 200, text: async () => "x" });
  const c = createS3Client({ endpoint: "http://minio:9000", accessKey: "AK", secretKey: "SK", bucket: "dxos-iot", fetchImpl });
  await c.getObject("iot/a.ndjson", "ver-1");
  await c.getObject("iot/a.ndjson", "null");
  await c.getObject("iot/a.ndjson");
  assert.match(urls[0], /\/dxos-iot\/iot\/a\.ndjson\?versionId=ver-1$/);
  assert.doesNotMatch(urls[1], /versionId/);
  assert.doesNotMatch(urls[2], /versionId/);
});

test("createS3Client: lỗi HTTP được ném ra", async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, text: async () => "" });
  const c = createS3Client({ endpoint: "http://minio:9000", accessKey: "AK", secretKey: "SK", bucket: "b", fetchImpl });
  await assert.rejects(c.getObject("iot/x.ndjson"), /403/);
});

// ---------- đánh giá chất lượng ----------
const T0 = Date.parse("2026-11-12T15:00:00Z");
const series = (secs, f = () => 500) => secs.map((s) => ({ t: T0 + s * 1000, v: f(s), name: "Lò", unit: "°C" }));
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

test("assess: dữ liệu liên tục -> độ phủ ~100%, không cờ", () => {
  const { accepted, quality } = assess(series(range(0, 100)), T0, T0 + 100000);
  assert.equal(accepted.length, 101);
  assert.ok(quality.coverage >= 0.99);
  assert.deepEqual(quality.flags, []);
  assert.equal(quality.rejected, 0);
});

test("assess: khoảng trống 40 giây giữa chừng -> cờ low-coverage và maxGapSec", () => {
  const { quality } = assess(series([...range(0, 30), ...range(70, 100)]), T0, T0 + 100000);
  assert.equal(quality.maxGapSec, 40);
  assert.ok(quality.coverage < 0.8 && quality.coverage > 0.5, "độ phủ " + quality.coverage);
  assert.ok(quality.flags.includes("low-coverage"));
});

test("assess: mất dữ liệu ở đầu hoặc cuối cửa sổ cũng bị tính", () => {
  const { quality } = assess(series(range(50, 100)), T0, T0 + 100000); // 50 giây đầu không có gì
  assert.equal(quality.maxGapSec, 50);
  assert.ok(quality.flags.includes("low-coverage"));
});

test("assess: mẫu ngoài khoảng [min,max] bị loại và báo out-of-range", () => {
  const { accepted, quality } = assess(series(range(0, 10), (s) => (s === 5 ? 9999 : 500)), T0, T0 + 10000, { min: 0, max: 1400 });
  assert.equal(accepted.length, 10);
  assert.ok(accepted.every((p) => p.v <= 1400));
  assert.equal(quality.rejected, 1);
  assert.ok(quality.flags.includes("out-of-range"));
});

test("assess: đổi nhanh quá maxRatePerSec -> cờ rapid-change, mẫu vẫn giữ", () => {
  const { accepted, quality } = assess(series(range(0, 10), (s) => (s < 5 ? 500 : 700)), T0, T0 + 10000, { maxRatePerSec: 50 });
  assert.equal(accepted.length, 11);
  assert.equal(quality.jumps, 1);
  assert.ok(quality.flags.includes("rapid-change"));
});

test("assess: không có giới hạn thì không loại mẫu nào", () => {
  const { accepted, quality } = assess(series(range(0, 10), () => 123456), T0, T0 + 10000);
  assert.equal(accepted.length, 11);
  assert.equal(quality.rejected, 0);
});

test("assess: quá ít mẫu -> cờ few-samples, độ phủ 0", () => {
  const { quality } = assess(series([5]), T0, T0 + 10000);
  assert.ok(quality.flags.includes("few-samples"));
  assert.equal(quality.coverage, 0);
});

test("buildEvidence: số liệu giả 9999 trong thư mục của chính gateway bị loại khi có giới hạn, và có cờ", async () => {
  const key = "iot/service-account-gw1/2026-11-12/2026-11-12T15-00-30-000Z.ndjson";
  const base = Date.parse("2026-11-12T15:00:00Z");
  const lines = range(0, 60).map((i) => reading(base + i * 1000, i === 30 ? 9999 : 900 + i));
  const s3 = { listKeys: async (p) => (p === "iot/service-account-gw1/2026-11-12/" ? [key] : []), getObject: async () => lines.join("\n") };
  const w = { deviceId: "kiln-01", from: base, to: base + 60000 };
  const ev = await buildEvidence(w, asVersions(s3), "gw1", { min: 0, max: 1400 });
  assert.equal(ev.max, 960);
  assert.equal(ev.quality.rejected, 1);
  assert.ok(ev.quality.flags.includes("out-of-range"));
  assert.equal(ev.count, 60);
});

test("buildEvidence: toàn bộ mẫu ngoài khoảng hợp lý -> 422 nêu rõ lý do", async () => {
  const key = "iot/service-account-gw1/2026-11-12/2026-11-12T15-00-30-000Z.ndjson";
  const base = Date.parse("2026-11-12T15:00:00Z");
  const s3 = { listKeys: async () => [key], getObject: async () => [reading(base + 1000, 9999), reading(base + 2000, 9998)].join("\n") };
  await assert.rejects(
    buildEvidence({ deviceId: "kiln-01", from: base, to: base + 5000 }, asVersions(s3), "gw1", { min: 0, max: 1400 }),
    (e) => e instanceof IotError && e.status === 422 && /ngoài khoảng giá trị hợp lý/.test(e.message),
  );
});

// ---------- phát hiện ghi đè / dấu xóa (Object Lock + versioning) ----------
const PUT = (key, id, t) => ({ key, versionId: id, lastModified: t, isDeleteMarker: false });
const DEL = (key, id, t) => ({ key, versionId: id, lastModified: t, isDeleteMarker: true });
const KEY = "iot/service-account-gw1/2026-11-12/2026-11-12T15-00-30-000Z.ndjson";
const WBASE = Date.parse("2026-11-12T15:00:00Z");
const good = () => range(0, 30).map((i) => reading(WBASE + i * 1000, 900 + i)).join("\n");
const forged = () => range(0, 30).map((i) => reading(WBASE + i * 1000, 5000 + i)).join("\n");
const W = { deviceId: "kiln-01", from: WBASE, to: WBASE + 30000 };

test("buildEvidence: tệp bị ghi đè -> đọc phiên bản GHI ĐẦU TIÊN, gắn cờ object-overwritten", async () => {
  const read = [];
  const s3 = {
    // liệt kê theo thứ tự mới nhất trước (đúng như S3), nhưng code phải tự sắp theo lastModified
    listVersions: async () => [PUT(KEY, "v2-forged", 2000), PUT(KEY, "v1-orig", 1000)],
    getObject: async (k, id) => (read.push(id), id === "v1-orig" ? good() : forged()),
  };
  const ev = await buildEvidence(W, s3, "gw1", { min: 0, max: 100000 });
  assert.deepEqual(read, ["v1-orig"], "chỉ đọc bản gốc");
  assert.equal(ev.max, 930, "số liệu từ bản gốc, không phải bản bị ghi đè (>=5000)");
  assert.equal(ev.quality.overwritten, 1);
  assert.ok(ev.quality.flags.includes("object-overwritten"));
});

test("buildEvidence: tệp bị 'xóa' (dấu xóa) vẫn đọc được bản bị khóa và gắn cờ object-deleted", async () => {
  const s3 = { listVersions: async () => [DEL(KEY, "d1", 3000), PUT(KEY, "v1", 1000)], getObject: async () => good() };
  const ev = await buildEvidence(W, s3, "gw1");
  assert.equal(ev.max, 930);
  assert.equal(ev.quality.deleted, 1);
  assert.ok(ev.quality.flags.includes("object-deleted"));
});

test("buildEvidence: tệp nguyên vẹn (một phiên bản, không dấu xóa) -> không có cờ toàn vẹn", async () => {
  const s3 = { listVersions: async () => [PUT(KEY, "v1", 1000)], getObject: async () => good() };
  const ev = await buildEvidence(W, s3, "gw1");
  assert.equal(ev.quality.overwritten, 0);
  assert.equal(ev.quality.deleted, 0);
  assert.ok(!ev.quality.flags.includes("object-overwritten") && !ev.quality.flags.includes("object-deleted"));
});

test("buildEvidence: tệp chỉ còn dấu xóa (không còn bản nào) không làm hỏng, chỉ được đếm", async () => {
  const other = "iot/service-account-gw1/2026-11-12/2026-11-12T15-00-10-000Z.ndjson";
  const s3 = { listVersions: async () => [PUT(KEY, "v1", 1000), DEL(other, "d9", 2000)], getObject: async () => good() };
  const ev = await buildEvidence(W, s3, "gw1");
  assert.equal(ev.quality.deleted, 1);
});
