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

# Vai trò: NGUỒN DUY NHẤT là config/access.json (sinh danh sách bằng scripts/gen-access.js)
while IFS='|' read -r role_name role_desc; do
  ensure_role "$role_name" "$role_desc"
done < <(node scripts/gen-access.js roles)

# Thuộc tính "coop" (mã HTX) của người dùng -> claim "coop" trong JWT
enable_unmanaged_attributes
ensure_coop_mapper

# Gateway IoT mặc định (service account, không đăng nhập bằng người dùng)
ensure_iot_client "$KEYCLOAK_IOT_CLIENT_ID" "$KEYCLOAK_IOT_CLIENT_SECRET"

kc add-roles -r "$R" --uusername tester --rolename editor
ensure_user viewer viewer readonly # user thử chỉ xem (đổi/xóa trước khi triển khai thật)

# Persona demo (một HTX mẫu `htx-demo`, khớp dữ liệu mẫu của trace-api). Mật khẩu = tên đăng nhập: CHỈ cho môi trường phát triển.
ensure_user hoa hoa producer              # chị Hoa, nghệ nhân (chủ thể sản xuất)
ensure_user tuan tuan coop-officer        # anh Tuấn, cán bộ HTX
ensure_user ocop ocop ocop-officer        # cán bộ đơn vị đầu mối OCOP
for u in hoa tuan; do set_user_attr "$u" coop htx-demo; done

# OTP (xác thực hai yếu tố) cho các vai trò có "mfa": true trong config/access.json (hiện: coop-officer), khi đăng nhập bằng trình duyệt
node scripts/setup-keycloak-mfa.js

# Gỡ quyền cũ: `readwrite` (MinIO đọc/ghi mọi thứ, gồm cả iot/) không còn dùng
for u in tester "service-account-$KEYCLOAK_CLIENT_ID"; do
  kc remove-roles -r "$R" --uusername "$u" --rolename readwrite >/dev/null 2>&1 || true
done
kc delete roles/readwrite -r "$R" >/dev/null 2>&1 || true

echo "OK: realm $R có các role từ config/access.json (admin, editor tạm, producer, coop-officer, ocop-officer, readonly, iot-writer), claim coop và persona hoa/tuan/ocop; gateway '$KEYCLOAK_IOT_CLIENT_ID' chỉ có iot-writer; role readwrite đã gỡ."
