#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 The Làng Nghề Số contributors
# Cập nhật địa chỉ công khai của giao diện trong client đăng nhập 'dxos-web' của Keycloak (đường dẫn quay lại sau đăng nhập, nguồn được phép gọi,
# đường dẫn sau đăng xuất). Realm nạp từ keycloak/dxos-realm.json đang ghi cứng http://localhost:3000, nên khi triển khai ở tên miền thật phải đổi.
# Dùng: bash scripts/set-public-urls.sh https://truyxuat.example.vn
#       bash scripts/set-public-urls.sh http://localhost:3000     (trả về mặc định phát triển)
# Chạy lặp lại an toàn. Cần Keycloak đang chạy. Nhớ đặt cùng giá trị cho FRONTEND_ORIGIN trong .env (cấu hình CORS của cổng gác).
set -euo pipefail
cd "$(dirname "$0")/.."
ORIGIN="${1:-}"
[[ "$ORIGIN" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || { echo "Dùng: bash scripts/set-public-urls.sh <địa-chỉ-giao-diện> (ví dụ https://truyxuat.example.vn, không có dấu / ở cuối)"; exit 1; }
set -a
. ./.env
set +a
. scripts/lib-keycloak.sh
kc_login >/dev/null
ID=$(kc get clients -r "$R" -q clientId=dxos-web --fields id --format csv --noquotes | tr -d '\r')
[ -n "$ID" ] || { echo "Không thấy client dxos-web trong realm $R"; exit 1; }
kc update "clients/$ID" -r "$R" -s "redirectUris=[\"$ORIGIN/*\"]" -s "webOrigins=[\"$ORIGIN\"]" -s "attributes.\"post.logout.redirect.uris\"=$ORIGIN/*"
echo "OK: client dxos-web chấp nhận giao diện tại $ORIGIN (redirectUris, webOrigins, post.logout.redirect.uris)."
case "$ORIGIN" in https://*) ;; *) echo "LƯU Ý: $ORIGIN không phải HTTPS, chỉ dùng cho phát triển." ;; esac
echo "Nhớ đặt FRONTEND_ORIGIN=$ORIGIN trong .env rồi chạy bash scripts/setup-apisix-routes.sh (CORS của cổng gác)."
