#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 The Làng Nghề Số contributors
# Tạo tệp .tar.gz phát hành từ commit hiện tại và KIỂM TRA nó trước khi dùng:
#   - không tệp văn bản nào chứa CRLF (nếu có, script bash trong gói sẽ lỗi trên Linux/macOS);
#   - có đủ tệp bắt buộc (LICENSE, NOTICE, CHANGELOG.md, README.md, docker-compose.yml, scripts/upgrade.sh);
#   - không có thư mục/tệp không được phát hành (.env, node_modules, backups, handoff, noi-dung-bao-cao).
# Dùng: bash scripts/make-release-archive.sh <phiên-bản>     (tạo dist/langnghe-dx-os-<phiên-bản>.tar.gz và in mã SHA-256)
#       bash scripts/make-release-archive.sh --check          (chỉ kiểm tra, không giữ tệp; dùng trong CI)
set -euo pipefail
cd "$(dirname "$0")/.."
ARG="${1:-}"
[ -n "$ARG" ] || { echo "Dùng: bash scripts/make-release-archive.sh <phiên-bản> | --check"; exit 1; }
if [ "$ARG" = "--check" ]; then VER="check"; OUT_DIR="$(mktemp -d)"; else
  [[ "$ARG" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Phiên bản phải dạng 1.2.3"; exit 1; }
  VER="$ARG"; OUT_DIR="dist"; mkdir -p dist
fi
NAME="langnghe-dx-os-$VER"
FILE="$OUT_DIR/$NAME.tar.gz"
# core.autocrlf=false cho chắc, dù .gitattributes (eol=lf) đã đảm bảo LF
git -c core.autocrlf=false archive --format=tar.gz --prefix="$NAME/" -o "$FILE" HEAD

CHK="$(mktemp -d)"
tar -xzf "$FILE" -C "$CHK"
fail=0
for must in LICENSE NOTICE CHANGELOG.md README.md docker-compose.yml scripts/upgrade.sh .env.example; do
  [ -f "$CHK/$NAME/$must" ] || { echo "THIẾU tệp bắt buộc trong gói: $must"; fail=1; }
done
for banned in .env node_modules backups handoff noi-dung-bao-cao .claude; do
  [ -e "$CHK/$NAME/$banned" ] && { echo "GÓI CHỨA mục không được phát hành: $banned"; fail=1; }
done
# Tìm CR trong tệp văn bản bằng Node (đọc từng byte, giống nhau trên mọi hệ điều hành; grep của MSYS trên Windows cho kết quả không đáng tin)
CR=$(node -e '
const fs = require("fs"), path = require("path");
const root = process.argv[1], out = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.isFile()) {
      const b = fs.readFileSync(p);
      if (!b.subarray(0, 8000).includes(0) && b.includes(13)) out.push(path.relative(root, p).split(path.sep).join("/"));
    }
  }
})(root);
console.log(out.join("\n"));' "$CHK/$NAME")
if [ -n "$CR" ]; then echo "CÁC TỆP VĂN BẢN CHỨA CRLF ($(echo "$CR" | wc -l | tr -d ' ') tệp), ví dụ:"; echo "$CR" | head -5; fail=1; fi
rm -rf "$CHK"
if [ "$fail" != 0 ]; then rm -f "$FILE"; echo "KHÔNG ĐẠT: gói phát hành không hợp lệ."; exit 1; fi
if [ "$ARG" = "--check" ]; then echo "OK: gói phát hành từ commit hiện tại hợp lệ (đủ tệp bắt buộc, không CRLF, không chứa mục cấm)."; rm -rf "$OUT_DIR"; else
  echo "OK: $FILE ($(wc -c < "$FILE") byte)"
  if command -v sha256sum >/dev/null; then sha256sum "$FILE"; else shasum -a 256 "$FILE"; fi
fi
