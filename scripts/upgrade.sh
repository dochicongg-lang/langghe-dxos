#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 The Làng Nghề Số contributors
# Cài đặt hoặc nâng cấp hệ thống bằng MỘT lệnh. Chạy lặp lại an toàn (idempotent).
#
#   bash scripts/upgrade.sh              đầy đủ: .env -> docker -> Keycloak -> APISIX/MinIO -> kiểm tra quyền
#   bash scripts/upgrade.sh --no-build   không dựng lại image (nhanh hơn khi chỉ đổi cấu hình)
#   bash scripts/upgrade.sh --skip-check bỏ bước kiểm tra quyền cuối cùng
#
# Việc script làm:
#   1. Tạo .env từ .env.example nếu chưa có; nếu đã có thì CHỈ bổ sung khóa còn thiếu (khóa "change_me_*" được
#      sinh ngẫu nhiên). Không bao giờ ghi đè giá trị đang dùng.
#   2. docker compose up -d --build, chờ các dịch vụ sẵn sàng.
#   3. scripts/setup-keycloak-roles.sh (vai trò, client thiết bị, user thử) và scripts/setup-apisix-routes.sh
#      (route, policy MinIO, tài khoản đọc cho trace-api, chuyển dữ liệu IoT cũ).
#   4. scripts/check-iot-permissions.sh: kiểm tra thật việc phân quyền.
# Frontend không do script này chạy: dùng `cd frontend && npm run dev`.
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib-env.sh

BUILD=1; CHECK=1
for a in "$@"; do
  case "$a" in
    --no-build) BUILD=0 ;;
    --skip-check) CHECK=0 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "Tùy chọn không hợp lệ: $a (xem: bash scripts/upgrade.sh --help)"; exit 1 ;;
  esac
done

TOTAL=5; CURRENT="khởi động"
step() { CURRENT="$2"; echo; echo "==> [$1/$TOTAL] $2"; }
trap 'rc=$?; [ $rc -ne 0 ] && { echo; echo "LỖI ở bước: $CURRENT (mã $rc). Sửa nguyên nhân rồi chạy lại, script chạy lặp lại an toàn."; }' EXIT

step 1 "Chuẩn bị .env"
command -v docker >/dev/null || { echo "Chưa cài Docker"; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker chưa chạy (hãy mở Docker Desktop)"; exit 1; }
[ -f .env ] && echo "Đã có .env: chỉ bổ sung khóa còn thiếu." || echo "Chưa có .env: tạo từ .env.example với khóa ngẫu nhiên."
ADDED=$(sync_env .env.example .env)
if [ -n "$ADDED" ]; then echo "Đã thêm vào .env: $(echo "$ADDED" | tr '\n' ' ')"; else echo ".env đã đủ khóa."; fi
set -a; . ./.env; set +a

step 2 "Khởi động các dịch vụ Docker"
if [ "$BUILD" = 1 ]; then docker compose up -d --build 2>&1 | tail -3; else docker compose up -d 2>&1 | tail -3; fi
# compose không khởi động lại container khi chỉ NỘI DUNG tệp cấu hình gắn vào (apisix/config.yaml) đổi: khởi động lại cổng gác để nhận cấu hình mới
# (ví dụ cổng nội bộ 9081 của route Flowable); không làm vậy thì sau khi nâng cấp trace-api không gọi được Flowable cho tới khi tự restart.
docker compose restart apisix >/dev/null 2>&1 || true
wait_healthy() { # tên container
  local i s
  for i in $(seq 1 60); do
    s=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null || echo none)
    { [ "$s" = healthy ] || [ "$s" = running ]; } && return 0
    sleep 3
  done
  echo "Dịch vụ $1 chưa sẵn sàng (trạng thái: $s). Xem: docker logs $1"; return 1
}
for c in dxos-postgres dxos-minio dxos-keycloak dxos-etcd dxos-apisix; do printf "  chờ %s ... " "$c"; wait_healthy "$c"; echo "sẵn sàng"; done
for i in $(seq 1 30); do
  curl -fs -H "X-API-KEY: $APISIX_ADMIN_KEY" "http://localhost:$APISIX_ADMIN_PORT/apisix/admin/routes" >/dev/null && break
  [ "$i" = 30 ] && { echo "Admin API của APISIX không phản hồi"; exit 1; }; sleep 2
done

step 3 "Keycloak: vai trò, client thiết bị, người dùng thử"
bash scripts/setup-keycloak-roles.sh | tail -1
bash scripts/setup-keycloak-login.sh | tail -1

step 4 "APISIX và MinIO: route, policy, tài khoản đọc, chuyển dữ liệu cũ"
bash scripts/setup-apisix-routes.sh | grep -E '^OK' || true

step 4b "Flowable: nạp quy trình hỗ trợ hồ sơ OCOP"
bash scripts/setup-ocop-workflow.sh | tail -1

step 5 "Kiểm tra phân quyền thật"
if [ "$CHECK" = 1 ]; then bash scripts/check-iot-permissions.sh | tail -3; else echo "Bỏ qua (--skip-check)."; fi

trap - EXIT
echo
echo "XONG. Chạy giao diện: cd frontend && npm run dev  ->  http://localhost:3000"
echo "Tài khoản thử (mật khẩu = tên): hoa (producer), tuan (coop-officer), ocop (ocop-officer), tester (editor = admin), viewer (readonly)."
WEAK=""
[ "${POSTGRES_PASSWORD:-}" = postgres ] && WEAK="$WEAK POSTGRES_PASSWORD"
[ "${MINIO_ROOT_PASSWORD:-}" = minioadmin123 ] && WEAK="$WEAK MINIO_ROOT_PASSWORD"
[ "${KEYCLOAK_ADMIN_PASSWORD:-}" = admin ] && WEAK="$WEAK KEYCLOAK_ADMIN_PASSWORD"
[ -n "$WEAK" ] && echo "CẢNH BÁO: còn mật khẩu mặc định yếu trong .env:$WEAK (đổi trước khi triển khai thật), và đổi/xóa các user thử (hoa, tuan, ocop, tester, viewer)."
exit 0
