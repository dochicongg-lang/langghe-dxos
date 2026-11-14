# Triển khai lên Internet

Tài liệu này là danh sách việc và các lệnh để đưa hệ thống ra Internet an toàn. **Hệ thống mới được chạy thật trên máy phát triển, chưa từng triển khai lên Internet**, nên tài liệu nêu rõ cả phần đã kiểm chứng và phần còn phải làm.

Đầu ra chính của việc chuẩn bị là công cụ rà soát:

```bash
node scripts/prod-check.js                      # rà soát .env hiện tại và trạng thái Keycloak đang chạy
node scripts/prod-check.js --env .env.production  # rà soát một tệp cấu hình sẽ dùng khi triển khai
```

Nó liệt kê mục **ĐẠT**, **LƯU Ý** và **KHÔNG ĐẠT** (thoát mã 1 nếu còn mục không đạt), không sửa gì. Chạy trên máy phát triển sẽ báo nhiều mục không đạt: đó là đúng, vì máy phát triển cố ý dùng mật khẩu mẫu, `start-dev` và tài khoản thử.

## 1. Chuẩn bị

- Máy chủ Linux có Docker Engine và Docker Compose v2, tối thiểu khoảng 4 GB RAM (ClamAV dùng 1 đến 2 GB), đĩa đủ cho dữ liệu và bản sao lưu.
- Tên miền và bản ghi DNS trỏ về máy chủ (ví dụ `truyxuat.example.vn` cho giao diện, `dangnhap.example.vn` cho Keycloak, một tên cho cổng gác API nếu tách riêng).
- Tường lửa: chỉ mở cổng **80** (cấp chứng chỉ) và **443**. Không mở 5432 (PostgreSQL), 9180 (Admin API của cổng gác), 8080 và 9080 ra Internet: để proxy HTTPS đứng trước.
- Không bao giờ chạy `seed-demo.js`, các script `check-*` và `demo-*` ở môi trường thật: chúng tạo dữ liệu thử và đăng nhập bằng tài khoản thử.

## 2. Bí mật

1. Tạo `.env` mới trên máy chủ từ `.env.example`, **đặt tay các mật khẩu quản trị TRƯỚC lần khởi động đầu tiên**: `POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD`, `KEYCLOAK_ADMIN_PASSWORD`, `FLOWABLE_ADMIN_PASSWORD`. Sinh chuỗi ngẫu nhiên: `openssl rand -hex 24`.
2. Các khóa còn lại bắt đầu bằng `change_me_` sẽ được `bash scripts/upgrade.sh` tự thay bằng chuỗi ngẫu nhiên 48 ký tự ở lần chạy đầu.
3. Đổi tên đăng nhập quản trị Keycloak khác `admin` (`KEYCLOAK_ADMIN`).
4. Đổi mật khẩu **sau khi đã có dữ liệu** (PostgreSQL, MinIO, Keycloak) là thao tác riêng cho từng dịch vụ, không chỉ sửa `.env`; vì vậy nên làm đúng ngay từ đầu.
5. `.env` và thư mục `backups/` chứa bí mật: chỉ chủ máy đọc được (`chmod 600 .env`), không đưa lên git.

## 3. Khóa dữ liệu: bắt buộc COMPLIANCE

Bản MinIO đang dùng cho phép tài khoản chỉ-xem gỡ khóa **Governance** khi đi thẳng vào MinIO. Chế độ **COMPLIANCE** chặn được (đã kiểm chứng bằng `node scripts/check-minio-lock-modes.js --yes`). Trong `.env` của máy chủ thật đặt:

```
IOT_LOCK_MODE=COMPLIANCE
IOT_LOCK_CONFIRM_COMPLIANCE=yes
IOT_RETENTION_DAYS=1825
```

COMPLIANCE **không hoàn tác**: tệp đã ghi không ai xóa được trước khi hết hạn, kể cả quản trị. Đó là mục đích của nó, nhưng nghĩa là không dùng dữ liệu thử ở môi trường này.

## 4. HTTPS và địa chỉ công khai

Hệ thống chưa kèm sẵn proxy HTTPS. Ví dụ dùng Caddy (cấp chứng chỉ Let's Encrypt tự động) đặt trước giao diện, Keycloak và cổng gác:

```
truyxuat.example.vn { reverse_proxy host.docker.internal:3000 }
dangnhap.example.vn { reverse_proxy keycloak:8080 }
api.example.vn      { reverse_proxy apisix:9080 }
```

Những thay đổi cấu hình phải làm cùng lúc:

| Việc | Cách làm |
|---|---|
| Địa chỉ công khai của Keycloak | đặt `KC_HOSTNAME_URL=https://dangnhap.example.vn` trong `.env` (đã tham số hóa trong `docker-compose.yml`); cần thêm biến proxy của Keycloak (`KC_PROXY_HEADERS=xforwarded`) trong tệp ghi đè compose của bạn |
| Client đăng nhập của giao diện | `bash scripts/set-public-urls.sh https://truyxuat.example.vn` (cập nhật đường dẫn quay lại, nguồn được phép gọi, đường dẫn sau đăng xuất; đã kiểm chứng chạy đúng và đảo ngược được) |
| CORS của cổng gác | đặt `FRONTEND_ORIGIN=https://truyxuat.example.vn` trong `.env`, rồi `bash scripts/setup-apisix-routes.sh` |
| Địa chỉ cho giao diện | đặt các biến `NEXT_PUBLIC_KEYCLOAK_URL`, `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_PUBLIC_BASE_URL` (nội dung mã QR) **lúc build**: `cd frontend && npm ci && npm run build && npm run start` |
| Chế độ chạy của Keycloak | thay `start-dev` bằng `start` kèm HTTPS và tên miền trong tệp ghi đè compose (xem tài liệu Keycloak "production configuration") |

### Việc còn phải làm trước khi triển khai thật (chưa có trong mã)

1. **Giao diện chưa được đóng gói thành container:** hiện chạy bằng `npm run start` trên máy chủ; cần Dockerfile cho `frontend/` nếu muốn quản lý bằng Compose.
2. **Trang Intelligence đọc số liệu cảm biến trực tiếp từ MinIO** qua host `s3.localhost` của cổng gác (xem `NEXT_PUBLIC_S3_ENDPOINT` và route `s3` trong `scripts/setup-apisix-routes.sh`, nơi tên miền `s3.localhost` được ghi cứng). Ở tên miền thật cần một tên miền cho dịch vụ này, hoặc chuyển trang đó sang đọc qua `trace-api`.
3. Trong realm Keycloak, địa chỉ `localhost` chỉ xuất hiện ở client `dxos-web` (đã có `set-public-urls.sh`). Các chỗ `localhost` còn lại trong cấu hình là nội bộ (lệnh chạy trong container, kiểm tra sức khỏe) hoặc chỉ dùng cho console MinIO vốn mặc định đã tắt (`MINIO_IDENTITY_OPENID_REDIRECT_URI`).
4. **Chưa có proxy HTTPS kèm sẵn, chưa có giám sát bên ngoài, chưa có kiểm thử tải.**

## 5. Tài khoản

- Xóa các tài khoản thử (`hoa`, `tuan`, `ocop`, `tester`, `viewer`) hoặc đặt mật khẩu mạnh riêng; tạo tài khoản thật và gán vai trò + thuộc tính hợp tác xã (`coop`).
- Vai trò `coop-officer` bắt buộc OTP khi đăng nhập trình duyệt. Muốn bật cho vai trò khác: `"mfa": true` trong `config/access.json` (hiện hỗ trợ một vai trò).
- Tài khoản quản trị Keycloak và quản trị MinIO chỉ dùng khi cần; không dùng hằng ngày.
- Chức năng "Quên mật khẩu" chưa bật (cần máy chủ SMTP); quy trình đặt lại hiện do quản trị làm.

## 6. Vận hành

- **Sao lưu:** đặt lịch `bash scripts/backup.sh --keep 7` (cron), đưa bản sao lưu ra khỏi máy chủ (chứa `.env`). Thử khôi phục định kỳ trên máy khác.
- **Tự phục hồi:** `bash scripts/heal.sh` định kỳ (xem `docs/HUONG-DAN-CHAY.md`, mục 13).
- **Nhật ký kiểm toán:** đã chống sửa lén và được neo định kỳ vào bucket có khóa; kiểm tra toàn vẹn ở trang Data.
- **Nâng cấp:** `git pull`, rồi `bash scripts/upgrade.sh` (an toàn chạy lại; tự restart cổng gác để nhận cấu hình mới).

## 7. Kiểm tra cuối

```bash
node scripts/prod-check.js --env .env       # không còn mục KHÔNG ĐẠT
docker compose ps                           # mọi dịch vụ running/healthy
```

Sau khi lên mạng: thử đăng nhập từ bên ngoài, tải một tệp đính kèm (bị quét mã độc), mở trang công khai `/verify/<mã>` bằng điện thoại 4G (kiểm tra chứng chỉ HTTPS và mã QR).
