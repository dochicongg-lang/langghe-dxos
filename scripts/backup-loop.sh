#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 The Làng Nghề Số contributors
# Sao lưu định kỳ trong một cửa sổ terminal: chạy scripts/backup.sh mỗi <giờ> giờ và chỉ giữ <số-bản> bản mới nhất.
# Dùng: bash scripts/backup-loop.sh [giờ=24] [số-bản-giữ=7]
# Thay cho vòng lặp này có thể dùng cron (Linux/macOS) hoặc Task Scheduler (Windows), xem docs/HUONG-DAN-CHAY.md, mục 13.
# Script KHÔNG tự cài lịch vào hệ điều hành; dừng bằng Ctrl+C.
set -uo pipefail
cd "$(dirname "$0")/.."
HOURS="${1:-24}"
KEEP="${2:-7}"
case "$HOURS$KEEP" in '' | *[!0-9]*) echo "Dùng: bash scripts/backup-loop.sh [giờ] [số-bản-giữ] (cả hai là số nguyên dương)"; exit 1 ;; esac
[ "$HOURS" -ge 1 ] && [ "$KEEP" -ge 1 ] || { echo "Cả hai tham số phải >= 1"; exit 1; }
echo "Sao lưu mỗi $HOURS giờ, giữ $KEEP bản mới nhất. Dừng bằng Ctrl+C."
while true; do
  echo "[$(date +%Y-%m-%dT%H:%M:%S%z)] bắt đầu sao lưu"
  if bash scripts/backup.sh --keep "$KEEP" > /tmp/dxos-backup-last.log 2>&1; then
    echo "[$(date +%Y-%m-%dT%H:%M:%S%z)] xong: $(grep '^XONG' /tmp/dxos-backup-last.log)"
  else
    echo "[$(date +%Y-%m-%dT%H:%M:%S%z)] LỖI sao lưu, xem /tmp/dxos-backup-last.log:"
    tail -5 /tmp/dxos-backup-last.log
  fi
  sleep $((HOURS * 3600))
done
