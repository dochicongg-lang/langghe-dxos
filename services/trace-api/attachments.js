// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use strict";
/**
 * Kiểm tra tệp đính kèm hồ sơ OCOP (G2.4). Logic thuần, không đụng mạng hay cơ sở dữ liệu.
 * Không tin loại tệp do trình duyệt khai: đọc "chữ ký" (magic bytes) rồi so với loại khai báo và danh sách cho phép trong
 * profile (config/ocop-profiles.json, mục attachments). Không nhận SVG/HTML (có thể chứa mã chạy trong trình duyệt).
 */
const crypto = require("node:crypto");

class AttachmentError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Loại thật của nội dung theo chữ ký đầu tệp, hoặc null nếu không nhận ra. */
function sniffType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  return null;
}

const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

/** Tên tệp an toàn để đặt trong khóa đối tượng và tiêu đề tải xuống: bỏ đường dẫn, ký tự lạ; luôn có đuôi đúng loại thật. */
function safeName(name, type) {
  const base = String(name ?? "").split(/[\\/]/).pop().normalize("NFC");
  const stem = base.replace(/\.[^.]*$/, "").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 60);
  return `${stem || "tep"}.${EXT[type] ?? "bin"}`;
}

/**
 * Kiểm tra một tệp tải lên. Trả về { type, size, sha256, name }; ném AttachmentError (status 400/413/415) nếu không hợp lệ.
 * rules: { maxBytes, types }.
 */
function inspect(buf, declaredType, filename, rules) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) throw new AttachmentError(400, "Tệp rỗng");
  if (buf.length > rules.maxBytes) throw new AttachmentError(413, `Tệp quá lớn (tối đa ${Math.floor(rules.maxBytes / 1024 / 1024)} MB)`);
  const real = sniffType(buf);
  if (!real) throw new AttachmentError(415, `Không nhận ra loại tệp. Chỉ nhận: ${rules.types.join(", ")}`);
  if (!rules.types.includes(real)) throw new AttachmentError(415, `Loại tệp ${real} không được phép. Chỉ nhận: ${rules.types.join(", ")}`);
  const declared = String(declaredType ?? "").split(";")[0].trim().toLowerCase();
  if (declared && declared !== "application/octet-stream" && declared !== real) throw new AttachmentError(415, `Loại khai báo (${declared}) không khớp nội dung thật (${real})`);
  return { type: real, size: buf.length, sha256: crypto.createHash("sha256").update(buf).digest("hex"), name: safeName(filename, real) };
}

/** Khóa đối tượng trong bucket tệp: applications/<mã hồ sơ>/<khóa giấy tờ>/<12 ký tự đầu của băm>-<tên>. Cùng nội dung thì cùng khóa. */
function objectKey(code, docKey, sha256, name) {
  return `applications/${code}/${docKey}/${sha256.slice(0, 12)}-${name}`;
}

module.exports = { AttachmentError, sniffType, safeName, inspect, objectKey };
