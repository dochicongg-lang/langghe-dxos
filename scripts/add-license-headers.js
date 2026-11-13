#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use strict";
/**
 * Thêm (hoặc kiểm tra) dòng giấy phép SPDX ở đầu MỌI tệp mã nguồn của dự án, theo yêu cầu của thể lệ OLP PMNM 2026
 * ("giấy phép phải được ghi trong từng tệp mã").
 *
 *   node scripts/add-license-headers.js          thêm dòng còn thiếu (chạy lặp lại an toàn)
 *   node scripts/add-license-headers.js --check  chỉ kiểm tra, thoát mã 1 nếu còn tệp thiếu (dùng trong CI)
 *
 * Chỉ xử lý tệp được git theo dõi. Bỏ qua tệp không có cú pháp chú thích (JSON, ảnh), tệp sinh tự động, tài liệu và tệp giấy phép.
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const ID = "SPDX-License-Identifier: Apache-2.0";
const HOLDER = "Copyright 2026 The Làng Nghề Số contributors";

// Kiểu chú thích theo đuôi tệp hoặc tên tệp
const LINE = (p) => (t) => t.map((x) => `${p} ${x}`).join("\n");
const STYLES = {
  js: LINE("//"), mjs: LINE("//"), cjs: LINE("//"), ts: LINE("//"), tsx: LINE("//"),
  css: (t) => `/*\n${t.map((x) => ` * ${x}`).join("\n")}\n */`,
  sh: LINE("#"), yml: LINE("#"), yaml: LINE("#"), properties: LINE("#"),
  sql: LINE("--"),
  xml: (t) => `<!--\n${t.map((x) => `  ${x}`).join("\n")}\n-->`,
};
const NAMED = { Dockerfile: LINE("#") };
const SKIP_NAMES = new Set(["next-env.d.ts", "package-lock.json"]);

function styleFor(file) {
  const base = path.basename(file);
  if (SKIP_NAMES.has(base)) return null;
  if (NAMED[base]) return NAMED[base];
  const m = /\.([A-Za-z0-9]+)$/.exec(base);
  return m ? (STYLES[m[1].toLowerCase()] ?? null) : null;
}

function tracked() {
  return execFileSync("git", ["ls-files"], { cwd: ROOT }).toString().split(/\r?\n/).filter(Boolean);
}

/** Trả về nội dung mới (đã thêm dòng giấy phép) hoặc null nếu tệp đã có/không áp dụng. */
function withHeader(file, text) {
  const style = styleFor(file);
  if (!style) return null;
  if (text.slice(0, 2000).includes("SPDX-License-Identifier")) return null;
  if (/generated|do not edit/i.test(text.slice(0, 300))) return null;
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const body = text.replace(/\r\n/g, "\n");
  const header = style([ID, HOLDER]);
  const lines = body.split("\n");
  let head = [];
  let rest = lines;
  // giữ nguyên dòng đầu bắt buộc phải ở trên cùng: shebang, khai báo XML
  if (lines[0].startsWith("#!") || lines[0].startsWith("<?xml")) {
    head = [lines[0]];
    rest = lines.slice(1);
  }
  const out = [...head, header, ...rest].join("\n");
  return eol === "\r\n" ? out.replace(/\n/g, "\r\n") : out;
}

const check = process.argv.includes("--check");
const missing = [];
let changed = 0;
for (const f of tracked()) {
  const abs = path.join(ROOT, f);
  if (!styleFor(f) || !fs.existsSync(abs)) continue;
  const text = fs.readFileSync(abs, "utf8");
  const next = withHeader(f, text);
  if (next === null) continue;
  if (check) missing.push(f);
  else {
    fs.writeFileSync(abs, next);
    changed++;
  }
}
if (check) {
  if (missing.length) {
    console.error(`Thiếu dòng giấy phép ở ${missing.length} tệp:\n  ${missing.join("\n  ")}\nChạy: node scripts/add-license-headers.js`);
    process.exit(1);
  }
  console.log("Mọi tệp mã đều có dòng giấy phép SPDX.");
} else {
  console.log(`Đã thêm dòng giấy phép vào ${changed} tệp.`);
}
