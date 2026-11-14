// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use strict";
/**
 * Quét mã độc tệp tải lên bằng ClamAV (clamd) qua giao thức INSTREAM trên TCP, không phụ thuộc thư viện ngoài.
 * Giao thức: gửi "zINSTREAM\0", rồi từng khối [4 byte độ dài big-endian][dữ liệu], kết thúc bằng khối độ dài 0;
 * clamd trả "stream: OK", "stream: <tên> FOUND" hoặc "... ERROR".
 */
const net = require("node:net");

const CHUNK = 64 * 1024;

class ScanError extends Error {}

/** Phân tích câu trả lời của clamd. Trả { clean: true } | { clean: false, signature }; ném ScanError nếu clamd báo lỗi. */
function parseReply(reply) {
  const text = String(reply).replace(/\0/g, "").trim();
  if (/^stream:\s*OK$/i.test(text)) return { clean: true };
  const found = /^stream:\s*(.+?)\s+FOUND$/i.exec(text);
  if (found) return { clean: false, signature: found[1] };
  throw new ScanError(`ClamAV trả lời không mong đợi: ${text || "(rỗng)"}`);
}

/** Khung dữ liệu INSTREAM cho một bộ nhớ đệm (hàm thuần, có test). */
function frame(buf) {
  const parts = [Buffer.from("zINSTREAM\0")];
  for (let i = 0; i < buf.length; i += CHUNK) {
    const chunk = buf.subarray(i, i + CHUNK);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(chunk.length);
    parts.push(len, chunk);
  }
  parts.push(Buffer.alloc(4)); // khối kết thúc
  return Buffer.concat(parts);
}

function createScanner({ host, port = 3310, timeoutMs = 30_000, connect = net.connect }) {
  /** Gửi một lệnh clamd và đọc câu trả lời đầu tiên (kết thúc bằng \0 hoặc khi clamd đóng kết nối). */
  function exchange(payload) {
    return new Promise((resolve, reject) => {
      let out = "";
      let finished = false;
      const sock = connect({ host, port });
      const end = (fn, v) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        sock.destroy();
        fn(v);
      };
      const timer = setTimeout(() => end(reject, new ScanError("Hết thời gian chờ ClamAV")), timeoutMs);
      sock.on("error", (e) => end(reject, new ScanError(`Không kết nối được ClamAV: ${e.message}`)));
      sock.on("data", (d) => {
        out += d.toString("latin1");
        if (out.includes("\0") || out.includes("\n")) end(resolve, out);
      });
      sock.on("close", () => end(out ? resolve : reject, out || new ScanError("ClamAV đóng kết nối mà không trả lời")));
      sock.on("connect", () => sock.write(payload));
    });
  }

  return {
    /** Quét một bộ nhớ đệm. Trả { clean } hoặc { clean: false, signature }; ném ScanError nếu không quét được. */
    async scan(buf) {
      return parseReply(await exchange(frame(buf)));
    },
    /** Kiểm tra clamd đang sống (PING -> PONG). */
    async ping() {
      return /PONG/.test(await exchange(Buffer.from("zPING\0")));
    },
  };
}

module.exports = { ScanError, parseReply, frame, createScanner };
