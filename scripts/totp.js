#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use strict";
/**
 * In mã OTP 6 số hiện tại (TOTP, RFC 6238: HMAC-SHA1, 30 giây) từ khóa bí mật dạng Base32.
 * Dùng khi thử/trình diễn tài khoản có bật OTP mà không cần điện thoại: lấy khóa ở bước cài OTP
 * (bấm "Không quét được mã vạch?") rồi chạy:  node scripts/totp.js <khóa-base32>
 */
const crypto = require("node:crypto");

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input) {
  const clean = input.replace(/[\s=-]/g, "").toUpperCase();
  let bits = "";
  for (const c of clean) {
    const v = ALPHABET.indexOf(c);
    if (v < 0) throw new Error(`Ký tự không hợp lệ trong khóa Base32: ${c}`);
    bits += v.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** Mã TOTP tại thời điểm `now` (ms). */
function totp(secretBase32, now = Date.now(), { digits = 6, period = 30 } = {}) {
  const counter = Math.floor(now / 1000 / period);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", base32Decode(secretBase32)).update(buf).digest();
  const off = h[h.length - 1] & 0xf;
  const code = (h.readUInt32BE(off) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, "0");
}

module.exports = { totp, base32Decode };

if (require.main === module) {
  const secret = process.argv[2];
  if (!secret) {
    console.error("Dùng: node scripts/totp.js <khóa-base32>");
    process.exit(1);
  }
  const left = 30 - (Math.floor(Date.now() / 1000) % 30);
  console.log(`${totp(secret)}   (còn hiệu lực khoảng ${left} giây)`);
}
