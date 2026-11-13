#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 The Làng Nghề Số contributors
# Kiểm thử hàm sync_env (scripts/lib-env.sh) trên thư mục tạm. Dùng: bash scripts/tests/test-env-sync.sh
set -uo pipefail
cd "$(dirname "$0")/../.."
. scripts/lib-env.sh
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
FAIL=0
ok() { if eval "$2"; then echo "PASS  $1"; else echo "FAIL  $1"; FAIL=1; fi; }

cat > "$T/example" <<'EOF'
# chú thích bỏ qua
A=giatri_a
SECRET_X=change_me_x
SECRET_Y=change_me_y
PORT=8080
EOF

# 1) Chưa có .env: tạo đủ khóa, khóa change_me_* được sinh ngẫu nhiên
ADDED=$(sync_env "$T/example" "$T/env1")
ok "tạo mới: thêm đủ 4 khóa" '[ "$(echo "$ADDED" | wc -l)" = 4 ]'
ok "tạo mới: giá trị thường giữ nguyên" 'grep -qx "A=giatri_a" "$T/env1" && grep -qx "PORT=8080" "$T/env1"'
ok "tạo mới: change_me_* thành chuỗi hex 48 ký tự" 'grep -qE "^SECRET_X=[0-9a-f]{48}$" "$T/env1"'
ok "tạo mới: hai khóa ngẫu nhiên khác nhau" '[ "$(grep ^SECRET_X= "$T/env1" | cut -d= -f2)" != "$(grep ^SECRET_Y= "$T/env1" | cut -d= -f2)" ]'
ok "tạo mới: không còn change_me" '! grep -q change_me "$T/env1"'

# 2) Đã có .env: không ghi đè giá trị cũ, chỉ thêm khóa thiếu (kể cả khi file không kết thúc bằng xuống dòng và có CRLF)
printf 'A=cua_toi\r\nSECRET_X=giu_nguyen\r\nPORT=9999' > "$T/env2"
ADDED=$(sync_env "$T/example" "$T/env2")
ok "nâng cấp: chỉ thêm khóa thiếu (SECRET_Y)" '[ "$ADDED" = "SECRET_Y" ]'
ok "nâng cấp: giá trị cũ không bị sửa" 'grep -qx "A=cua_toi" "$T/env2" && grep -qx "SECRET_X=giu_nguyen" "$T/env2" && grep -qx "PORT=9999" "$T/env2"'
ok "nâng cấp: đã chuẩn hóa CRLF" '! grep -q $'"'"'\r'"'"' "$T/env2"'
ok "nâng cấp: khóa thêm nằm trên dòng riêng" '[ "$(wc -l < "$T/env2")" = 4 ]'

# 3) Chạy lần hai: không thêm gì
ADDED=$(sync_env "$T/example" "$T/env2")
ok "idempotent: lần hai không thêm gì" '[ -z "$ADDED" ]'

# 4) .env.example thật của dự án: mọi khóa đều đưa được vào .env rỗng và không còn change_me
sync_env .env.example "$T/real" >/dev/null
ok ".env.example thật: không còn mật khẩu mẫu change_me" '! grep -q change_me "$T/real"'
ok ".env.example thật: có KEYCLOAK_IOT_CLIENT_SECRET ngẫu nhiên" 'grep -qE "^KEYCLOAK_IOT_CLIENT_SECRET=[0-9a-f]{48}$" "$T/real"'

[ "$FAIL" = 0 ] && echo "TẤT CẢ ĐẠT" || echo "CÓ MỤC KHÔNG ĐẠT"
exit "$FAIL"
