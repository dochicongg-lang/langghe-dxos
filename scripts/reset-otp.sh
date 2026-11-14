#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 The Làng Nghề Số contributors
# Đặt lại OTP của một người dùng thử (mặc định: tuan) để lần đăng nhập trình duyệt kế tiếp lại được yêu cầu cài OTP.
#
# Vì sao cần: khi người dùng thuộc vai trò bắt buộc MFA đã cài OTP, Keycloak cũng đòi mã OTP ở đăng nhập mật khẩu trực tiếp
# (grant_type=password), nên các script kiểm tra đăng nhập bằng tuan/tuan sẽ bị từ chối. Chạy script này trước khi chạy
# các script kiểm tra, hoặc trước buổi trình diễn để cài OTP lại từ đầu.
# Dùng: bash scripts/reset-otp.sh [tên-người-dùng]
set -euo pipefail
cd "$(dirname "$0")/.."
set -a
. ./.env
set +a
. scripts/lib-keycloak.sh

U="${1:-tuan}"
kc_login
id=$(kc get users -r "$R" -q "username=$U" --fields id --format csv --noquotes | tr -d '\r')
[ -n "$id" ] || { echo "Không có người dùng $U"; exit 1; }

n=0
while IFS=, read -r cid ctype; do
  cid=$(echo "$cid" | tr -d '\r')
  ctype=$(echo "$ctype" | tr -d '\r')
  if [ "$ctype" = "otp" ]; then
    kc delete "users/$id/credentials/$cid" -r "$R"
    n=$((n + 1))
  fi
done < <(kc get "users/$id/credentials" -r "$R" --fields id,type --format csv --noquotes)

echo "OK: đã xóa $n thiết bị OTP của $U. Lần đăng nhập trình duyệt kế tiếp sẽ yêu cầu cài OTP lại."
