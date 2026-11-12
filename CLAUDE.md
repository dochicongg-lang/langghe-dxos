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

## Trạng thái hiện tại (cập nhật 2026-11-12)
Hướng dẫn chạy từng bước cho người mới: `docs/HUONG-DAN-CHAY.md`. Người dùng là người mới, cần giải thích kỹ khi hướng dẫn chạy.

**Đã có (đều đã merge vào `main`):**
- **Tầng 1** (`docker-compose.yml`, mạng `dxos-net`, project `dxos-tier1`): PostgreSQL 16, MinIO (image `pgsty/minio` vì `minio/minio` đã bị gỡ khỏi Docker Hub), Keycloak 26.6.3, Flowable 7.0.1, etcd + APISIX 3.9.0, và `trace-api` (Tầng 3). Chỉ Keycloak, APISIX, Postgres và cổng console MinIO mở ra host; Flowable, MinIO API và `trace-api` chỉ truy cập qua APISIX.
- **Keycloak**: realm `dxos` nạp từ `keycloak/dxos-realm.json` (client `dxos-api` bí mật, `dxos-web` công khai PKCE; role `readwrite`/`readonly` xuất ra claim `policy`; user thử `tester`/`tester`). Realm **chỉ import khi chưa tồn tại**: sửa file này thì phải xóa realm hoặc `docker compose down -v` rồi lên lại.
- **APISIX**: route nằm trong etcd, tạo bằng `bash scripts/setup-apisix-routes.sh` (chạy lại sau khi xóa volume): `/api/workflow/*` (Flowable, JWT), `/api/trace/*` (JWT), `/api/public/trace/*` (công khai, giới hạn tần suất), host `s3.localhost` (S3/STS của MinIO).
- **MinIO OIDC**: JWT Keycloak -> STS `AssumeRoleWithWebIdentity` -> SigV4. Bucket `dxos-data` riêng tư; CORS do MinIO xử lý (không dùng plugin cors ở route S3 để tránh header trùng).
- **Tầng 2** (`frontend/`, Next.js 16, đăng nhập `keycloak-js` PKCE): trang Human, Process (Flowable), Data (chỉ mô tả), Intelligence (đọc dữ liệu IoT từ MinIO). Giao diện tự dựng theo phong cách TailAdmin, chưa dùng template gốc.
- **Tầng 3** (`services/trace-api`, Node + PostgreSQL database `traceability`): truy xuất nguồn gốc 7 công đoạn; ghi cần role `readwrite`; trang công khai `/verify/<mã>`.
- **IoT**: `backend/simulate-iot.js` (4 cảm biến xưởng gốm; `--post` ghi NDJSON lên MinIO qua APISIX).

**Việc còn dở / ý tưởng tiếp theo:** mã QR cho `/verify`; liên kết dữ liệu IoT vào công đoạn nung; phân quyền theo từng làng nghề; trang Data chưa tải lên/xuống tệp; quy trình Flowable thực tế (kiểm định lô hàng); README giới thiệu và CI (lint/build); đổi hết mật khẩu và khóa mẫu `change_me_*` trước khi triển khai thật; chưa thử đăng nhập SSO ở console MinIO bằng trình duyệt.

**Lưu ý kỹ thuật khi làm việc:**
- Next.js 16.4 khác bản đã biết: đọc `frontend/AGENTS.md` và `node_modules/next/dist/docs/` trước khi viết code; `useParams` phải nằm trong `<Suspense>`; không export dữ liệu dùng chung từ file `"use client"` cho server component.
- Windows: shell là PowerShell 5.1 (không có `&&`; truyền thân PR nhiều dòng bằng `--body-file`); script `.sh` chạy bằng Git Bash. Keycloak 26 yêu cầu user có email, họ, tên mới cấp được token.
- Quy trình git: làm trên nhánh riêng, mở PR vào `main` rồi merge; không commit `.env`, `node_modules`. Repo GitHub: `dochicongg-lang/langnghe-dx-os` (công khai).
