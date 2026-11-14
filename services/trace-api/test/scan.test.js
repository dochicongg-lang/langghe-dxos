// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const { ScanError, parseReply, frame, createScanner } = require("../scan");

/** clamd giả: đọc đúng giao thức INSTREAM, trả "FOUND" nếu nội dung chứa "EVIL", "OK" nếu không. */
function fakeClamd(behavior = "normal") {
  const server = net.createServer((sock) => {
    let buf = Buffer.alloc(0);
    sock.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      if (buf.subarray(0, 6).toString() === "zPING\0".slice(0, 6) && buf.length >= 6) return sock.end("PONG\0");
      if (buf.length < 10 || buf.subarray(0, 10).toString() !== "zINSTREAM\0") return;
      let off = 10;
      let body = Buffer.alloc(0);
      for (;;) {
        if (buf.length < off + 4) return; // chưa đủ dữ liệu
        const len = buf.readUInt32BE(off);
        off += 4;
        if (len === 0) break;
        if (buf.length < off + len) return;
        body = Buffer.concat([body, buf.subarray(off, off + len)]);
        off += len;
      }
      if (behavior === "silent") return;
      if (behavior === "error") return sock.end("INSTREAM size limit exceeded. ERROR\0");
      sock.end(body.includes("EVIL") ? "stream: Fake.Virus-1 FOUND\0" : "stream: OK\0");
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port })));
}

test("phân tích câu trả lời clamd: sạch, nhiễm, lỗi", () => {
  assert.deepEqual(parseReply("stream: OK\0"), { clean: true });
  assert.deepEqual(parseReply("stream: Eicar-Signature FOUND\0"), { clean: false, signature: "Eicar-Signature" });
  assert.deepEqual(parseReply("stream: Win.Test.EICAR_HDB-1 FOUND\n"), { clean: false, signature: "Win.Test.EICAR_HDB-1" });
  assert.throws(() => parseReply("INSTREAM size limit exceeded. ERROR\0"), ScanError);
  assert.throws(() => parseReply(""), ScanError);
});

test("khung INSTREAM: lệnh, các khối tối đa 64 KB có độ dài big-endian, khối kết thúc", () => {
  const small = frame(Buffer.from("abc"));
  assert.equal(small.subarray(0, 10).toString(), "zINSTREAM\0");
  assert.equal(small.readUInt32BE(10), 3);
  assert.equal(small.subarray(14, 17).toString(), "abc");
  assert.equal(small.readUInt32BE(17), 0);
  const big = frame(Buffer.alloc(100_000, 1));
  assert.equal(big.readUInt32BE(10), 65536);
  assert.equal(big.readUInt32BE(10 + 4 + 65536), 100_000 - 65536);
  assert.equal(big.readUInt32BE(big.length - 4), 0);
});

test("quét qua clamd giả: sạch, nhiễm, tệp lớn nhiều khối, ping", async () => {
  const { server, port } = await fakeClamd();
  try {
    const s = createScanner({ host: "127.0.0.1", port });
    assert.deepEqual(await s.scan(Buffer.from("noi dung binh thuong")), { clean: true });
    assert.deepEqual(await s.scan(Buffer.from("xx EVIL xx")), { clean: false, signature: "Fake.Virus-1" });
    const big = Buffer.concat([Buffer.alloc(200_000, 65), Buffer.from("EVIL")]); // mã độc nằm ở khối cuối
    assert.equal((await s.scan(big)).clean, false);
    assert.equal(await s.ping(), true);
  } finally {
    server.close();
  }
});

test("lỗi quét: clamd báo ERROR, không kết nối được, quá thời gian", async () => {
  const err = await fakeClamd("error");
  try {
    await assert.rejects(createScanner({ host: "127.0.0.1", port: err.port }).scan(Buffer.from("x")), ScanError);
  } finally {
    err.server.close();
  }
  await assert.rejects(createScanner({ host: "127.0.0.1", port: 1 }).scan(Buffer.from("x")), /Không kết nối được ClamAV/);
  const silent = await fakeClamd("silent");
  try {
    await assert.rejects(createScanner({ host: "127.0.0.1", port: silent.port, timeoutMs: 300 }).scan(Buffer.from("x")), /Hết thời gian chờ/);
  } finally {
    silent.server.close();
  }
});
