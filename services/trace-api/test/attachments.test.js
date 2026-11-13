// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const att = require("../attachments");
const ocop = require("../ocop");
const gen = require("../../../scripts/gen-access");
const access = require("../access");
const { createS3Client } = require("../iot");

const ROOT = path.join(__dirname, "..", "..", "..");
const P = ocop.getProfile(ocop.loadProfiles(path.join(ROOT, "config", "ocop-profiles.json")));
const RULES = P.attachments;

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 2)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(20, 3)]);
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(40, 4)]);

test("nhận ra loại tệp theo chữ ký nội dung", () => {
  assert.equal(att.sniffType(JPEG), "image/jpeg");
  assert.equal(att.sniffType(PNG), "image/png");
  assert.equal(att.sniffType(WEBP), "image/webp");
  assert.equal(att.sniffType(PDF), "application/pdf");
  assert.equal(att.sniffType(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>")), null);
  assert.equal(att.sniffType(Buffer.from("<html><script>alert(1)</script></html>")), null);
  assert.equal(att.sniffType(Buffer.from("MZ".padEnd(40, "x"))), null); // tệp thực thi
  assert.equal(att.sniffType(Buffer.alloc(5)), null); // quá ngắn
  assert.equal(att.sniffType("không phải buffer"), null);
});

test("inspect: tệp hợp lệ trả về loại thật, cỡ, băm SHA-256, tên sạch", () => {
  const r = att.inspect(JPEG, "image/jpeg", "Ảnh bình gốm (1).JPG", RULES);
  assert.equal(r.type, "image/jpeg");
  assert.equal(r.size, JPEG.length);
  assert.equal(r.sha256, crypto.createHash("sha256").update(JPEG).digest("hex"));
  assert.match(r.name, /\.jpg$/);
  assert.ok(!/[\s()]/.test(r.name));
  assert.equal(att.inspect(PDF, "application/pdf; charset=binary", "mau.pdf", RULES).type, "application/pdf");
  // trình duyệt/công cụ không khai loại: dựa vào nội dung
  assert.equal(att.inspect(PNG, "application/octet-stream", "a.png", RULES).type, "image/png");
  assert.equal(att.inspect(PNG, "", "a", RULES).type, "image/png");
});

test("inspect: từ chối tệp rỗng, quá lớn, sai loại, loại khai báo không khớp nội dung", () => {
  const code = (fn) => {
    try {
      fn();
    } catch (e) {
      return e.status;
    }
    return null;
  };
  assert.equal(code(() => att.inspect(Buffer.alloc(0), "image/png", "a.png", RULES)), 400);
  assert.equal(code(() => att.inspect(Buffer.concat([PNG, Buffer.alloc(RULES.maxBytes)]), "image/png", "a.png", RULES)), 413);
  assert.equal(code(() => att.inspect(Buffer.from("<svg><script>1</script></svg>".padEnd(40)), "image/svg+xml", "x.svg", RULES)), 415);
  assert.equal(code(() => att.inspect(Buffer.from("MZ".padEnd(40, "x")), "image/png", "virus.png", RULES)), 415); // đổi đuôi, nội dung là tệp thực thi
  assert.equal(code(() => att.inspect(PDF, "image/png", "a.png", RULES)), 415); // khai png nhưng là pdf
  assert.equal(code(() => att.inspect(WEBP, "image/webp", "a.webp", { ...RULES, types: ["image/jpeg"] })), 415); // loại bị profile tắt
  assert.equal(code(() => att.inspect(JPEG, "image/jpeg", "a.jpg", RULES)), null);
});

test("safeName: bỏ đường dẫn, ký tự lạ; đuôi theo loại thật", () => {
  assert.equal(att.safeName("../../etc/passwd", "image/png"), "passwd.png");
  assert.equal(att.safeName("C:\\Users\\x\\ảnh sản phẩm.exe", "image/jpeg"), "ảnh-sản-phẩm.jpg");
  assert.equal(att.safeName("", "application/pdf"), "tep.pdf");
  assert.equal(att.safeName("...", "image/png"), "tep.png");
  assert.equal(att.safeName("a".repeat(200) + ".png", "image/png").length, 60 + ".png".length);
  assert.equal(att.safeName("a;b|c<d>.png", "image/png"), "a-b-c-d.png");
});

test("objectKey: nằm dưới applications/<mã>/<giấy tờ>/, cùng nội dung thì cùng khóa", () => {
  const h = "ab".repeat(32);
  assert.equal(att.objectKey("OCOP-1", "anh-san-pham", h, "a.jpg"), `applications/OCOP-1/anh-san-pham/${h.slice(0, 12)}-a.jpg`);
});

test("cấu hình profile: attachments hợp lệ và sai thì bị từ chối", () => {
  const cfg = ocop.loadProfiles(path.join(ROOT, "config", "ocop-profiles.json"));
  assert.ok(RULES.maxBytes > 0 && RULES.maxPerApplication > 0);
  assert.ok(!RULES.types.includes("image/svg+xml") && !RULES.types.includes("text/html"));
  const bad = JSON.parse(JSON.stringify(cfg));
  delete bad.profiles["hanoi-2026"].attachments;
  assert.throws(() => ocop.validateProfiles(bad), /attachments/);
  const bad2 = JSON.parse(JSON.stringify(cfg));
  bad2.profiles["hanoi-2026"].attachments.types.push("image/svg+xml");
  assert.throws(() => ocop.validateProfiles(bad2), /chỉ nhận/);
});

test("policy MinIO: mọi vai trò dùng STS bị Deny toàn bộ trên bucket tệp đính kèm", () => {
  const cfg = access.load(path.join(ROOT, "config", "access.json"));
  const pol = gen.minioPolicies(cfg, "dxos-iot", "dxos-data", "dxos-docs");
  assert.deepEqual(Object.keys(pol).sort(), ["admin", "coop-officer", "editor", "ocop-officer", "producer"]);
  for (const [name, p] of Object.entries(pol)) {
    const deny = p.Statement.find((s) => s.Effect === "Deny" && s.Resource.includes("arn:aws:s3:::dxos-docs/*"));
    assert.ok(deny && deny.Action.includes("s3:*"), `${name} thiếu Deny bucket tệp`);
  }
  // tên bucket tệp lấy theo tham số, không ghi cứng
  const other = gen.minioPolicies(cfg, "dxos-iot", "dxos-data", "kho-khac").producer;
  assert.ok(other.Statement.some((s) => s.Effect === "Deny" && s.Resource.includes("arn:aws:s3:::kho-khac/*")));
});

test("S3 client: PUT ký SigV4 với băm nội dung, gửi content-type; GET nhị phân trả đúng byte", async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, ...init });
    if (init.method === "PUT") return { ok: true, status: 200 };
    return { ok: true, status: 200, arrayBuffer: async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.length) };
  };
  const s3 = createS3Client({ endpoint: "http://minio:9000", accessKey: "k", secretKey: "s", bucket: "dxos-docs", fetchImpl: fakeFetch });
  await s3.putObject("applications/OCOP-1/anh/x-a.png", PNG, "image/png");
  const put = calls[0];
  assert.equal(put.method, "PUT");
  assert.equal(put.url, "http://minio:9000/dxos-docs/applications/OCOP-1/anh/x-a.png");
  assert.equal(put.headers["x-amz-content-sha256"], crypto.createHash("sha256").update(PNG).digest("hex"));
  assert.equal(put.headers["content-type"], "image/png");
  assert.match(put.headers.authorization, /^AWS4-HMAC-SHA256 Credential=k\//);
  assert.equal(put.body, PNG);
  const back = await s3.getObjectBuffer("applications/OCOP-1/anh/x-a.png");
  assert.ok(Buffer.isBuffer(back) && back.equals(PNG));
  const failing = createS3Client({ endpoint: "http://minio:9000", accessKey: "k", secretKey: "s", bucket: "b", fetchImpl: async () => ({ ok: false, status: 403 }) });
  await assert.rejects(failing.putObject("k", PNG), /403/);
  await assert.rejects(failing.getObjectBuffer("k"), /403/);
});
