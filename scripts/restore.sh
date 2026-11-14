#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 The Làng Nghề Số contributors
# Khôi phục từ một thư mục do scripts/backup.sh tạo: kiểm tra nguyên vẹn (SHA256SUMS), rồi GHI ĐÈ dữ liệu hiện tại bằng bản sao lưu.
#
# Dùng: bash scripts/restore.sh <thư-mục-sao-lưu> --yes
#   --yes là bắt buộc vì việc này XÓA dữ liệu hiện có (PostgreSQL và MinIO). .env hiện tại KHÔNG bị ghi đè: nếu mật khẩu trong .env khác
#   bản sao lưu thì lấy lại bản gốc từ <thư-mục>/env.backup trước (kiểm tra bằng diff), nếu không các dịch vụ sẽ không đăng nhập được với nhau.
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1

SRC=""
YES=0
for a in "$@"; do
  case "$a" in
    --yes) YES=1 ;;
    *) SRC="$a" ;;
  esac
done
[ -n "$SRC" ] && [ -d "$SRC" ] || { echo "Dùng: bash scripts/restore.sh <thư-mục-sao-lưu> --yes"; exit 1; }
[ "$YES" = 1 ] || { echo "Việc này XÓA dữ liệu hiện có và thay bằng bản sao lưu '$SRC'. Thêm --yes để xác nhận."; exit 1; }

set -a
. ./.env
set +a
ABS=$(cd "$SRC" && (pwd -W 2>/dev/null || pwd))

echo "==> [1/5] Kiểm tra nguyên vẹn bản sao lưu"
(cd "$SRC" && sha256sum -c SHA256SUMS --quiet) || { echo "LỖI: bản sao lưu hỏng hoặc bị sửa, dừng (chưa đụng tới dữ liệu hiện tại)."; exit 1; }
if ! diff -q .env "$SRC/env.backup" >/dev/null 2>&1; then
  echo "CẢNH BÁO: .env hiện tại KHÁC env.backup trong bản sao lưu. Nếu mật khẩu khác, hãy chép env.backup thành .env rồi chạy lại."
fi

PROJECT=$(docker inspect dxos-minio --format '{{ index .Config.Labels "com.docker.compose.project" }}' 2>/dev/null || echo dxos-tier1)
VOL="${PROJECT}_minio-data"

echo "==> [2/5] Dừng các dịch vụ dùng dữ liệu"
docker compose stop trace-api apisix keycloak flowable minio >/dev/null
docker compose up -d postgres >/dev/null
for _ in $(seq 1 30); do
  [ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' dxos-postgres)" = "healthy" ] && break
  sleep 2
done

echo "==> [3/5] Khôi phục PostgreSQL"
for DB in "$KEYCLOAK_DB" "$FLOWABLE_DB" "$TRACE_DB"; do
  docker exec dxos-postgres psql -U "$POSTGRES_USER" -d postgres -qc "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)" -c "CREATE DATABASE \"$DB\" OWNER \"$POSTGRES_USER\""
  docker exec -i dxos-postgres pg_restore -U "$POSTGRES_USER" -d "$DB" --no-owner --exit-on-error < "$SRC/pg-$DB.dump"
  echo "  $DB: đã khôi phục"
done

echo "==> [4/5] Khôi phục MinIO (volume $VOL)"
docker run --rm -v "$VOL":/data -v "$ABS":/backup:ro alpine sh -c "find /data -mindepth 1 -delete && tar xzf /backup/minio-data.tar.gz -C /data"

echo "==> [5/5] Khởi động lại toàn bộ"
docker compose up -d >/dev/null
docker compose restart apisix >/dev/null # route của cổng gác nằm trong etcd (không bị đụng tới); khởi động lại để nhận đúng địa chỉ container
for _ in $(seq 1 60); do
  c=$(curl -s -w "%{http_code}" "http://localhost:${APISIX_GATEWAY_PORT:-9080}/api/public/trace/khong-co" | tail -c 3) || c=000 # cổng gác đang khởi động lại: curl lỗi không được làm dừng script
  [ "$c" = 404 ] && break
  sleep 3
done
echo
echo "XONG. Khôi phục từ $SRC. Kiểm tra: node scripts/demo-zero-trust.js"
echo "Nếu đăng nhập hoặc gọi API lỗi lạ, chạy bash scripts/upgrade.sh (an toàn chạy lại)."
