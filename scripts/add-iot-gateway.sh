#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 The Làng Nghề Số contributors
# Thêm một gateway IoT mới (mỗi gateway xưởng nên có client riêng để thu hồi độc lập).
#
#   bash scripts/add-iot-gateway.sh <tên-client> [khóa-bí-mật]
#
# - Tạo client Keycloak <tên-client> (service account, chỉ role iot-writer). Không truyền khóa thì tự sinh ngẫu nhiên.
# - MinIO tự giới hạn client này chỉ ghi được vào iot/service-account-<tên-client>/ (không đọc, không ghi chỗ khác).
# - In khóa MỘT LẦN: đặt vào cấu hình của gateway đó (KEYCLOAK_IOT_CLIENT_ID / KEYCLOAK_IOT_CLIENT_SECRET).
# Sau đó khai báo thiết bị thuộc gateway trong config/iot-devices.json và chạy: docker compose restart trace-api
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
. scripts/lib-keycloak.sh

CID="${1:-}"
[ -n "$CID" ] || { echo "Dùng: bash scripts/add-iot-gateway.sh <tên-client> [khóa-bí-mật]"; exit 1; }
[[ "$CID" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$ ]] || { echo "Tên client chỉ gồm chữ, số, '-' và '_' (tối đa 60 ký tự)"; exit 1; }
SECRET="${2:-$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')}"

kc_login
ensure_iot_client "$CID" "$SECRET"

echo "OK: gateway '$CID' đã sẵn sàng (chỉ ghi được vào iot/service-account-$CID/)."
echo "    KEYCLOAK_IOT_CLIENT_ID=$CID"
echo "    KEYCLOAK_IOT_CLIENT_SECRET=$SECRET   <- chỉ hiện một lần, hãy lưu vào cấu hình của gateway"
echo "Bước tiếp: khai báo thiết bị của gateway này trong config/iot-devices.json rồi: docker compose restart trace-api"
