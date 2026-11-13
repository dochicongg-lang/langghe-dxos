#!/usr/bin/env bash
# Áp dụng theme đăng nhập "dxos" (keycloak/themes/dxos, gắn vào container qua docker-compose.yml) và các tính năng đăng nhập
# cho realm ĐANG CHẠY. Idempotent. Gồm: giao diện tiếng Việt (chỉ một ngôn ngữ nên không hiện hộp chọn ngôn ngữ và không phụ thuộc ngôn ngữ trình duyệt), "ghi nhớ đăng nhập", và chống dò mật khẩu
# (nhập sai 10 lần trong 15 phút thì khóa tạm, tăng dần 1 phút mỗi lần, tối đa 5 phút; KHÔNG khóa vĩnh viễn nên không gây kẹt demo).
# "Quên mật khẩu" chưa bật vì cần cấu hình email (SMTP).
# Dùng: bash scripts/setup-keycloak-login.sh   (sau khi Keycloak chạy và đã mount theme)
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
. scripts/lib-keycloak.sh

kc_login
kc update "realms/$R" \
  -s loginTheme=dxos \
  -s displayName="Làng Nghề Số" \
  -s internationalizationEnabled=true \
  -s 'supportedLocales=["vi"]' \
  -s defaultLocale=vi \
  -s rememberMe=true \
  -s bruteForceProtected=true \
  -s permanentLockout=false \
  -s failureFactor=10 \
  -s maxDeltaTimeSeconds=900 \
  -s waitIncrementSeconds=60 \
  -s maxFailureWaitSeconds=300 >/dev/null
echo "OK: realm $R dùng theme đăng nhập dxos (tiếng Việt, ghi nhớ đăng nhập, khóa tạm khi nhập sai nhiều lần)"
