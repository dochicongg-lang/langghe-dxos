# Làng Nghề Số (DX-OS Open-Core)

Mô hình thực hành số cho **làng nghề**, xây theo khung **DX-OS 3 tầng** và dùng hoàn toàn **phần mềm nguồn mở**.
Dự án tham gia cuộc thi Phần mềm Nguồn mở OLP 2026.

Hệ thống giúp một sản phẩm làng nghề (ví dụ bình gốm Bát Tràng) có **hành trình truy xuất công khai**: người mua quét mã QR là thấy
nghệ nhân, các công đoạn sản xuất và **đường cong nhiệt độ lò nung thật**, kèm dấu cho biết máy chủ đã đối chiếu số liệu cảm biến.

## Kiến trúc

| Tầng | Thành phần (đều mã nguồn mở) | Vai trò |
|---|---|---|
| **1. Lõi không giao diện** | Keycloak (đăng nhập một lần, JWT) · Apache APISIX (cổng gác) · Flowable (quy trình) · PostgreSQL + MinIO (dữ liệu) | Chỉ cung cấp dịch vụ qua REST API |
| **2. Không gian H-P-D-I** | Next.js | Giao diện dùng chung: Human, Process, Data, Intelligence |
| **3. Nghiệp vụ** | `trace-api` (Node.js) + trang công khai | Truy xuất nguồn gốc sản phẩm làng nghề |

```
Trình duyệt ──JWT──► APISIX ──► trace-api ──► PostgreSQL
Quét QR ───────────► /verify/<mã> ──► API công khai
Cảm biến lò ──► MinIO (bucket có Object Lock) ──► trace-api tự đối chiếu ──► bằng chứng nhiệt độ
```

**Nguyên tắc:** Tầng 1 không có giao diện; mọi API được bảo vệ đều đi qua APISIX và xác thực JWT của Keycloak.

## Điểm nổi bật
- **Bằng chứng nhiệt độ nung do máy chủ tự đối chiếu**: trình duyệt chỉ gửi thiết bị và khoảng thời gian, số liệu do `trace-api` tự đọc và tính.
- **Số liệu cảm biến bất biến**: lưu ở bucket MinIO có **Object Lock (WORM)**; ghi đè hoặc xóa lén bị phát hiện và gắn cờ trên bằng chứng.
- **Khóa theo từng gateway**: mỗi gateway chỉ ghi được vào thư mục riêng; thiết bị gắn với đúng gateway sở hữu.
- **Phân quyền nghiệp vụ theo HTX** từ một tệp duy nhất `config/access.json`: nghệ nhân, cán bộ HTX, cán bộ đơn vị đầu mối, quản trị, chỉ xem, thiết bị. Cổng gác, `trace-api`, MinIO và Keycloak đều sinh/đọc từ tệp này.
- **OTP** cho cán bộ HTX khi đăng nhập trên trình duyệt.
- **Cài đặt và nâng cấp một lệnh**, và bộ kiểm tra phân quyền chạy thật qua cổng gác.

## Chạy nhanh
Cần: Docker Desktop, Node.js, Git Bash (Windows). Mở **Git Bash** tại thư mục dự án:

```bash
bash scripts/upgrade.sh          # tạo .env, dựng và khởi động Docker, cấu hình Keycloak/APISIX/MinIO, kiểm tra phân quyền
cd frontend && npm install       # lần đầu
npm run dev                      # mở http://localhost:3000
node backend/simulate-iot.js --post   # (tùy chọn) giả lập cảm biến lò nung ghi vào MinIO
```
Hướng dẫn từng bước cho người mới: [docs/HUONG-DAN-CHAY.md](docs/HUONG-DAN-CHAY.md).

**Tài khoản thử** (chỉ môi trường phát triển; mật khẩu trùng tên đăng nhập; đổi hoặc xóa trước khi triển khai thật):
`hoa` (nghệ nhân), `tuan` (cán bộ HTX, bắt dùng OTP), `ocop` (cán bộ đơn vị đầu mối), `tester` (quản trị), `viewer` (chỉ xem).

Địa chỉ: giao diện `http://localhost:3000` · cổng gác `http://localhost:9080` · Keycloak `http://localhost:8080`.
Trang truy xuất công khai: `http://localhost:3000/verify/GOM-BT-0001`.

## Cấu trúc thư mục
| Đường dẫn | Nội dung |
|---|---|
| `docker-compose.yml`, `.env.example` | hạ tầng Tầng 1 và `trace-api` |
| `config/` | `access.json` (ma trận quyền, nguồn duy nhất), `iot-devices.json` (danh bạ thiết bị) |
| `keycloak/` | realm cho cài mới |
| `services/trace-api/` | API truy xuất, phân quyền, bằng chứng IoT, migration, test |
| `frontend/` | giao diện Next.js |
| `backend/simulate-iot.js` | giả lập cảm biến |
| `scripts/` | cài đặt/nâng cấp, thiết lập Keycloak/APISIX/MinIO, kiểm tra phân quyền |

## Kiểm thử
```bash
cd services/trace-api && npm test                   # test đơn vị
cd frontend && npx tsc --noEmit && npx eslint src   # kiểu và lint
bash scripts/tests/test-env-sync.sh                 # script tạo .env
bash scripts/check-iot-permissions.sh               # kiểm tra phân quyền THẬT qua cổng gác, MinIO, Keycloak
```

## Bảo mật
- Chỉ cổng gác (9080) và Keycloak (8080) mở ra mạng; PostgreSQL, console MinIO và Admin API của APISIX chỉ nghe trên máy chủ.
- Mật khẩu mặc định (PostgreSQL, MinIO, Keycloak admin) và tài khoản thử **phải đổi** trước khi triển khai thật. Chế độ khóa dữ liệu mặc định là Governance; khi triển khai thật nên dùng COMPLIANCE (không hoàn tác, cần xác nhận rõ ràng, xem hướng dẫn).
- Hệ thống **hỗ trợ và theo dõi** quy trình chứng nhận; không tự cấp giấy chứng nhận của cơ quan có thẩm quyền.

## Giấy phép
Chưa có tệp giấy phép trong kho mã; cần chọn một giấy phép nguồn mở trước khi công bố chính thức.
