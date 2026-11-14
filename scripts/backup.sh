#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 The Làng Nghề Số contributors
# Sao lưu toàn bộ dữ liệu của hệ thống ra một thư mục (mặc định backups/<ngày-giờ>/, đã loại khỏi git):
#   - PostgreSQL: từng CSDL (Keycloak, Flowable, traceability) bằng pg_dump định dạng custom;
#   - MinIO: toàn bộ thư mục dữ liệu (mọi bucket, phiên bản, khóa Object Lock, tài khoản và policy) dạng tar.gz;
#   - .env (CHỨA MẬT KHẨU: thư mục sao lưu phải được bảo vệ như bí mật) và cấu hình;
#   - SHA256SUMS để restore.sh kiểm tra nguyên vẹn trước khi khôi phục.
# Route của cổng gác không cần sao lưu: nằm trong etcd và được tạo lại bằng scripts/setup-apisix-routes.sh (upgrade.sh gọi nó).
#
# Dùng: bash scripts/backup.sh [thư-mục-đích] [--hot] [--keep N]
#   Mặc định tạm dừng MinIO vài giây khi nén để dữ liệu nhất quán; --hot bỏ qua bước dừng (nhanh hơn, có thể lệch nếu đang ghi).
#   --keep N: sau khi sao lưu xong, chỉ giữ N bản MỚI NHẤT trong backups/ (xóa bản cũ hơn; chỉ xóa thư mục tên <ngày>-<giờ> có SHA256SUMS).
# Chạy định kỳ: bash scripts/backup-loop.sh [giờ] [số-bản-giữ], hoặc cron/Task Scheduler (xem docs/HUONG-DAN-CHAY.md, mục 13).
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1 # Git Bash trên Windows: không đổi đường dẫn /data thành đường dẫn Windows
SUM="sha256sum"; command -v sha256sum >/dev/null 2>&1 || SUM="shasum -a 256" # macOS không có sha256sum

HOT=0
DEST=""
KEEP=0
PREV=""
for a in "$@"; do
  if [ "$PREV" = "--keep" ]; then
    case "$a" in '' | *[!0-9]* | 0) echo "LỖI: --keep cần một số nguyên dương"; exit 1 ;; esac
    KEEP="$a"
    PREV=""
    continue
  fi
  case "$a" in
    --hot) HOT=1 ;;
    --keep) PREV="--keep" ;;
    *) DEST="$a" ;;
  esac
done
[ "$PREV" = "--keep" ] && { echo "LỖI: --keep cần một số nguyên dương"; exit 1; }

set -a
. ./.env
set +a

STAMP=$(date +%Y%m%d-%H%M%S)
DEST="${DEST:-backups/$STAMP}"
mkdir -p "$DEST"
chmod 700 "$DEST" 2>/dev/null || true
# đường dẫn tuyệt đối dạng host (Git Bash: pwd -W cho đường dẫn Windows để docker -v hiểu)
ABS=$(cd "$DEST" && (pwd -W 2>/dev/null || pwd))

for c in dxos-postgres dxos-minio; do
  [ "$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null)" = "true" ] || { echo "LỖI: container $c chưa chạy (docker compose up -d)."; exit 1; }
done
PROJECT=$(docker inspect dxos-minio --format '{{ index .Config.Labels "com.docker.compose.project" }}')
VOL="${PROJECT}_minio-data"

echo "==> [1/4] PostgreSQL"
for DB in "$KEYCLOAK_DB" "$FLOWABLE_DB" "$TRACE_DB"; do
  docker exec dxos-postgres pg_dump -U "$POSTGRES_USER" -d "$DB" -Fc > "$DEST/pg-$DB.dump"
  [ -s "$DEST/pg-$DB.dump" ] || { echo "LỖI: bản sao lưu CSDL $DB rỗng"; exit 1; }
  echo "  $DB: $(wc -c < "$DEST/pg-$DB.dump") byte"
done

echo "==> [2/4] MinIO (volume $VOL)"
RESTART=0
trap '[ "$RESTART" = 1 ] && docker start dxos-minio >/dev/null 2>&1 || true' EXIT
if [ "$HOT" = 0 ]; then
  docker stop dxos-minio >/dev/null
  RESTART=1
fi
docker run --rm -v "$VOL":/data:ro -v "$ABS":/backup alpine sh -c "tar czf /backup/minio-data.tar.gz -C /data ."
if [ "$RESTART" = 1 ]; then
  docker start dxos-minio >/dev/null
  RESTART=0
  for _ in $(seq 1 30); do
    [ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' dxos-minio)" = "healthy" ] && break
    sleep 2
  done
fi
echo "  minio-data.tar.gz: $(wc -c < "$DEST/minio-data.tar.gz") byte"

echo "==> [3/4] Cấu hình và .env"
cp .env "$DEST/env.backup"
chmod 600 "$DEST/env.backup" 2>/dev/null || true
mkdir -p "$DEST/config"
cp -r config/. "$DEST/config/"
{
  echo "thời điểm: $(date +%Y-%m-%dT%H:%M:%S%z)"
  echo "commit: $(git rev-parse HEAD 2>/dev/null || echo không-có-git)"
  docker ps --format '{{.Names}} {{.Image}}' | sort
} > "$DEST/manifest.txt"

echo "==> [4/4] Mã kiểm tra nguyên vẹn"
(cd "$DEST" && find . -type f ! -name SHA256SUMS | sort | xargs $SUM > SHA256SUMS)
echo "  $(wc -l < "$DEST/SHA256SUMS") tệp"

if [ "$KEEP" -gt 0 ]; then
  # chỉ dọn trong backups/, chỉ thư mục dạng <8 chữ số>-<6 chữ số> có SHA256SUMS (không đụng thư mục khác)
  OLD=$(ls -1d backups/[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9] 2>/dev/null | sort | head -n "-$KEEP" || true)
  for d in $OLD; do
    [ -f "$d/SHA256SUMS" ] && rm -rf "$d" && echo "  đã xóa bản cũ: $d"
  done
fi

echo
echo "XONG. Bản sao lưu: $DEST"
echo "CẢNH BÁO: thư mục này chứa .env (mật khẩu) và dữ liệu; cất ở nơi an toàn, KHÔNG đưa lên git."
echo "Khôi phục: bash scripts/restore.sh $DEST --yes"
