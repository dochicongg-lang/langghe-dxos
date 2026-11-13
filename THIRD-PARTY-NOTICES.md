# Thành phần và thư viện bên thứ ba

Dự án phát hành theo **Apache-2.0** (xem `LICENSE`, `NOTICE`). Tệp này nêu rõ các thành phần bên thứ ba dự án dùng, giấy phép của từng
thành phần, và cách dự án dùng chúng. **Dự án không sao chép, không chỉnh sửa và không phát hành kèm mã nguồn của bất kỳ dự án nào khác
trong kho mã**: các thư viện được cài qua trình quản lý gói (`npm ci`) và các dịch vụ chạy từ ảnh Docker chính thức chưa sửa đổi.

## 1. Dịch vụ chạy trong Docker (chưa sửa đổi, chạy như tiến trình riêng, giao tiếp qua mạng)

| Thành phần | Ảnh (phiên bản) | Giấy phép | Vai trò |
|---|---|---|---|
| Keycloak | `quay.io/keycloak/keycloak:26.6.3` | Apache-2.0 | Đăng nhập một lần (SSO), JWT, OTP |
| Apache APISIX | `apache/apisix:3.9.0-debian` | Apache-2.0 | Cổng API, kiểm soát truy cập biên mạng |
| etcd | `quay.io/coreos/etcd:v3.5.14` | Apache-2.0 | Kho cấu hình của APISIX |
| Flowable REST | `flowable/flowable-rest:7.0.1` | Apache-2.0 | Động cơ quy trình BPMN |
| PostgreSQL | `postgres:16` | PostgreSQL License (kiểu BSD/MIT) | Dữ liệu có cấu trúc |
| MinIO | `pgsty/minio` (ghim theo mã băm trong `docker-compose.yml`) | **AGPL-3.0** | Lưu trữ đối tượng (tệp, số liệu cảm biến, kho lạnh) |

**Về MinIO (AGPL-3.0):** dự án chỉ chạy MinIO như một dịch vụ riêng, dùng ảnh Docker nguyên bản và giao tiếp qua giao thức S3 chuẩn.
Mã của dự án **không** nhúng, liên kết hay sửa đổi mã MinIO, nên giấy phép AGPL của MinIO không áp đặt lên mã của dự án. Ảnh chính thức
`minio/minio` đã bị gỡ khỏi Docker Hub; dự án dùng bản phân phối cộng đồng `pgsty/minio` và ghim theo mã băm để bản dựng lặp lại được.

**Về Docker:** Docker Engine và Docker Compose là mã nguồn mở (Apache-2.0). Docker Desktop (Windows/macOS) là phần mềm riêng của
Docker Inc., chỉ là cách tiện lợi để chạy Docker Engine; trên Linux dùng thẳng Docker Engine.

## 2. Thư viện Node.js dùng trực tiếp

Phiên bản chính xác nằm trong `package-lock.json` của từng thư mục; cài bằng `npm ci`.

**`frontend/` (giao diện Next.js)**

| Thư viện | Phiên bản | Giấy phép | Dùng để |
|---|---|---|---|
| next | 16.4.6 | MIT | Khung ứng dụng web |
| react, react-dom | 19.3.0 | MIT | Thư viện giao diện |
| keycloak-js | 26.2.5 | Apache-2.0 | Đăng nhập PKCE với Keycloak |
| qrcode | 1.5.4 | MIT | Sinh mã QR |
| tailwindcss, @tailwindcss/turbopack | 4.3.3 | MIT | Kiểu dáng (khi build) |
| typescript | 5.9.3 | Apache-2.0 | Kiểm tra kiểu (khi phát triển) |
| eslint, eslint-config-next, @types/* | 9.39.5 / 16.4.6 / các bản | MIT | Kiểm tra mã, khai báo kiểu (khi phát triển) |

**`services/trace-api/` (API Tầng 3)**

| Thư viện | Phiên bản | Giấy phép | Dùng để |
|---|---|---|---|
| pg | 8.23.1 | MIT | Kết nối PostgreSQL |

Phần còn lại của `trace-api` chỉ dùng thư viện chuẩn của Node.js (không phụ thuộc thêm).

## 3. Tóm tắt giấy phép của toàn bộ cây phụ thuộc (kể cả gián tiếp)

Kiểm tra bằng cách đọc trường `license` trong `package.json` của từng gói đã cài (ngày 13/11/2026):

- **`frontend/`:** MIT (303), ISC (19), Apache-2.0 (20), BSD-2-Clause (7), BSD-3-Clause (2), MPL-2.0 (3), và một số gói đơn lẻ:
  CC-BY-4.0 (dữ liệu `caniuse-lite`), CC0-1.0, 0BSD, BlueOak-1.0.0, Python-2.0 (`argparse`, chỉ khi phát triển),
  và **một gói `Apache-2.0 AND LGPL-3.0-or-later`** (thư viện nhị phân tùy chọn của bộ tối ưu ảnh Next.js; dự án không dùng tính năng tối ưu
  ảnh, không sửa đổi và không phát hành kèm gói này).
- **`services/trace-api/`:** MIT (12), ISC (2).

Tất cả đều là giấy phép tự do, tương thích với việc phát hành mã của dự án theo Apache-2.0. Dự án không sửa đổi mã của bất kỳ thư viện nào.

## 4. Phông chữ và tài nguyên

| Tài nguyên | Giấy phép | Cách dùng |
|---|---|---|
| Be Vietnam Pro | SIL Open Font License 1.1 | Phông giao diện, nạp lúc build qua `next/font` (không lưu trong kho mã) |
| Geist Mono | SIL Open Font License 1.1 | Phông cho mã và khóa, nạp lúc build qua `next/font` |
| PatternFly (trong theme đăng nhập Keycloak) | MIT | Theme đăng nhập `keycloak/themes/dxos` **kế thừa** theme `keycloak.v2` có sẵn của Keycloak; dự án chỉ thêm tệp CSS và bản dịch của riêng mình |

## 5. Tài liệu tham khảo và nội dung do dự án tự viết

- Toàn bộ mã, kịch bản, cấu hình, tài liệu và quy trình BPMN trong kho mã này do nhóm dự án viết, phát hành theo Apache-2.0.
- Số liệu quy định OCOP và ngưỡng nung trong `config/` là **số liệu minh họa** tổng hợp từ nguồn công khai, chưa đối chiếu văn bản gốc
  (đã đánh dấu `verified: false`), không phải trích dẫn nguyên văn từ văn bản pháp luật.
