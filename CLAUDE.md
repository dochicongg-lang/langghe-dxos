# Dự án: DX-OS Open-Core cho Làng Nghề Số (OLP 2026)

## Bối cảnh
Đây là một dự án tham gia cuộc thi Phần mềm Nguồn mở OLP 2026.
Mục tiêu là xây dựng một mô hình thực hành số dựa trên Khung kiến trúc DX-OS 3 tầng:
- Tầng 1 (Headless Core): Cung cấp dịch vụ lõi qua API, không có UI. Bắt buộc phải có: Identity/SSO, API Gateway, Workflow Engine, và Data (SQL & Object Storage).
- Tầng 2 (H-P-D-I): Giao diện người dùng và các cổng dịch vụ dùng chung, thể hiện sự tiến hóa từ Human -> Process -> Data -> Intelligence.
- Tầng 3 (Nghiệp vụ): Các ứng dụng chuyên ngành (ví dụ: truy xuất nguồn gốc sản phẩm làng nghề).

## Công nghệ đã chọn
- **Identity**: Keycloak
- **API Gateway**: Apache APISIX
- **Workflow**: Flowable
- **Database**: PostgreSQL
- **Object Storage**: MinIO
- **Frontend**: Next.js (dựa trên template TailAdmin)

## Quy tắc và Ranh giới Kiến trúc
- **TUYỆT ĐỐI KHÔNG** viết code giao diện (UI) trong Tầng 1. Mọi dịch vụ ở Tầng 1 chỉ được giao tiếp qua REST API.
- Luôn ưu tiên các giải pháp mã nguồn mở.
- Khi tạo file `docker-compose.yml`, hãy đặt tất cả các service vào một mạng bridge chung và sử dụng biến môi trường từ file `.env`.
- Mọi API được bảo vệ phải đi qua API Gateway (APISIX) và xác thực JWT token từ Keycloak.

## Lệnh thường dùng
- Khởi động hệ thống: `docker compose up -d`
- Chạy frontend: `cd frontend && npm run dev`
- Chạy script giả lập IoT: `node backend/simulate-iot.js`
