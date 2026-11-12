#!/usr/bin/env bash
# Hàm dùng chung cho việc đồng bộ file .env (được `source`, không chạy trực tiếp).

rand_secret() { od -An -N24 -tx1 /dev/urandom | tr -d ' \n'; } # 48 ký tự hex ngẫu nhiên

# sync_env <file-mẫu> <file-đích>
# Bổ sung vào file đích những khóa còn THIẾU so với file mẫu; KHÔNG bao giờ sửa khóa đã có.
# Khóa có giá trị mẫu bắt đầu bằng "change_me" được thay bằng chuỗi ngẫu nhiên (không lưu mật khẩu mẫu yếu).
# In ra TÊN các khóa đã thêm (không in giá trị, tránh lộ khóa ra màn hình/log).
sync_env() {
  local ex="$1" tgt="$2" line key val
  [ -f "$tgt" ] || : > "$tgt"
  # Chuẩn hóa xuống dòng CRLF -> LF (CRLF làm giá trị biến có ký tự \r thừa khi `source`)
  if grep -q $'\r' "$tgt" 2>/dev/null; then tr -d '\r' < "$tgt" > "$tgt.tmp" && mv "$tgt.tmp" "$tgt"; fi
  # Đảm bảo file kết thúc bằng xuống dòng trước khi nối thêm
  if [ -s "$tgt" ] && [ -n "$(tail -c1 "$tgt")" ]; then echo >> "$tgt"; fi
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    key="${BASH_REMATCH[1]}"; val="${BASH_REMATCH[2]}"
    if ! grep -qE "^${key}=" "$tgt"; then
      [[ "$val" == change_me* ]] && val="$(rand_secret)"
      printf '%s=%s\n' "$key" "$val" >> "$tgt"
      echo "$key"
    fi
  done < "$ex"
}
