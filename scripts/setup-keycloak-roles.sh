#!/usr/bin/env bash
# Áp dụng mô hình vai trò mới cho realm Keycloak ĐANG CHẠY (realm chỉ được import khi chưa tồn tại,
# nên sửa keycloak/dxos-realm.json không tự cập nhật realm cũ). Chạy lặp lại an toàn.
#
#   editor     nhân viên: tạo/sửa dữ liệu ứng dụng; MinIO đọc/ghi nhưng KHÔNG ghi/xóa trong iot/
#   readonly   chỉ xem
#   iot-writer thiết bị: chỉ ghi vào thư mục riêng của gateway trong iot/ (client riêng, mặc định `dxos-iot`),
#              không đọc, không gọi API nghiệp vụ. Thêm gateway khác: bash scripts/add-iot-gateway.sh <client>
#
# Dùng: bash scripts/setup-keycloak-roles.sh   (sau `docker compose up -d`)
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
. scripts/lib-keycloak.sh

kc_login

ensure_role editor "Nhân viên: tạo/sửa dữ liệu ứng dụng; MinIO đọc/ghi mọi bucket NHƯNG KHÔNG ghi/xóa trong iot/"
ensure_role readonly "Chỉ xem; MinIO policy readonly (đọc mọi bucket)"
ensure_role iot-writer "Thiết bị IoT: chỉ ghi (PutObject) vào thư mục riêng của gateway trong iot/, không đọc, không gọi API nghiệp vụ"

# Gateway IoT mặc định (service account, không đăng nhập bằng người dùng)
ensure_iot_client "$KEYCLOAK_IOT_CLIENT_ID" "$KEYCLOAK_IOT_CLIENT_SECRET"

kc add-roles -r "$R" --uusername tester --rolename editor

# Gỡ quyền cũ: `readwrite` (MinIO đọc/ghi mọi thứ, gồm cả iot/) không còn dùng
for u in tester "service-account-$KEYCLOAK_CLIENT_ID"; do
  kc remove-roles -r "$R" --uusername "$u" --rolename readwrite >/dev/null 2>&1 || true
done
kc delete roles/readwrite -r "$R" >/dev/null 2>&1 || true

echo "OK: realm $R có role editor / readonly / iot-writer; gateway '$KEYCLOAK_IOT_CLIENT_ID' chỉ có iot-writer; role readwrite đã gỡ."
