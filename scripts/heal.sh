#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 The Làng Nghề Số contributors
# Tự phục hồi một lượt: khởi động lại container của hệ thống đang dừng hoặc báo "unhealthy", và sửa lỗi 502 ở cổng gác
# (APISIX giữ địa chỉ cũ của container trace-api sau khi nó được tạo lại). Chạy lặp lại an toàn; không đụng tới dữ liệu.
#
# Dùng một lần:      bash scripts/heal.sh
# Chạy định kỳ (cron, mỗi 2 phút):   */2 * * * * cd /đường/dẫn/dự-án && bash scripts/heal.sh >> backups/heal.log 2>&1
# (Windows: Task Scheduler gọi Git Bash với lệnh trên.) Vòng lặp tự chạy: bash scripts/heal.sh --watch [giây]
set -uo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1
[ -f .env ] && { set -a; . ./.env; set +a; }

heal_once() {
  local changed=0 c state health
  for c in dxos-postgres dxos-minio dxos-keycloak dxos-flowable dxos-etcd dxos-apisix dxos-trace-api dxos-clamav; do
    state=$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null) || continue # container chưa từng tạo: bỏ qua
    health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$c" 2>/dev/null)
    if [ "$state" != "running" ]; then
      echo "$(date +%Y-%m-%dT%H:%M:%S%z) $c đang '$state', khởi động lại"
      docker start "$c" >/dev/null && changed=1
    elif [ "$health" = "unhealthy" ]; then
      echo "$(date +%Y-%m-%dT%H:%M:%S%z) $c báo unhealthy, khởi động lại"
      docker restart "$c" >/dev/null && changed=1
    fi
  done
  # Cổng gác trả 502/503/504 cho một tuyến công khai (trả 404 là bình thường: trace-api trả lời "không có sản phẩm") => khởi động lại APISIX
  local code
  code=$(curl -s -m 10 -w "%{http_code}" "http://localhost:${APISIX_GATEWAY_PORT:-9080}/api/public/trace/khong-co" | tail -c 3)
  case "$code" in
    502 | 503 | 504)
      if [ "$(docker inspect -f '{{.State.Status}}' dxos-trace-api 2>/dev/null)" = "running" ]; then
        echo "$(date +%Y-%m-%dT%H:%M:%S%z) cổng gác trả $code dù trace-api đang chạy, khởi động lại dxos-apisix"
        docker restart dxos-apisix >/dev/null && changed=1
      fi
      ;;
  esac
  [ "$changed" = 0 ] && echo "$(date +%Y-%m-%dT%H:%M:%S%z) mọi thứ bình thường (cổng gác: $code)"
  return 0
}

if [ "${1:-}" = "--watch" ]; then
  while true; do
    heal_once
    sleep "${2:-60}"
  done
else
  heal_once
fi
