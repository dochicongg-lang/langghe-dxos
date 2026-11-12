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
- Chạy script giả lập IoT: `node backend/simulate-iot.js` (thêm `--post` để ghi lên MinIO)
- Cài đặt/nâng cấp một lệnh (idempotent): `bash scripts/upgrade.sh` (đồng bộ `.env` chỉ bổ sung khóa thiếu và sinh khóa `change_me_*` ngẫu nhiên, `docker compose up`, `setup-keycloak-roles.sh`, `setup-apisix-routes.sh`, `check-iot-permissions.sh`)
- Test backend Tầng 3: `cd services/trace-api && npm test` (node:test, không cần cài thêm); test script `.env`: `bash scripts/tests/test-env-sync.sh`

## Trạng thái hiện tại (cập nhật 2026-11-12)
Hướng dẫn chạy từng bước cho người mới: `docs/HUONG-DAN-CHAY.md`. Người dùng là người mới, cần giải thích kỹ khi hướng dẫn chạy.

**Đã có (đều đã merge vào `main`):**
- **Tầng 1** (`docker-compose.yml`, mạng `dxos-net`, project `dxos-tier1`): PostgreSQL 16, MinIO (image `pgsty/minio` vì `minio/minio` đã bị gỡ khỏi Docker Hub), Keycloak 26.6.3, Flowable 7.0.1, etcd + APISIX 3.9.0, và `trace-api` (Tầng 3). Chỉ Keycloak, APISIX, Postgres và cổng console MinIO mở ra host; Flowable, MinIO API và `trace-api` chỉ truy cập qua APISIX.
- **Keycloak**: realm `dxos` nạp từ `keycloak/dxos-realm.json` (client `dxos-api` bí mật, `dxos-web` công khai PKCE; role `editor`/`readonly`/`iot-writer` xuất ra claim `policy` (tên role = tên policy MinIO; policy `editor` và `iot-writer` là policy tùy chỉnh do `scripts/setup-apisix-routes.sh` tạo, vì policy dựng sẵn `readwrite` của MinIO cho phép ghi cả `iot/`); client `dxos-iot` (service account, chỉ role `iot-writer`) là danh tính của gateway IoT/simulator (mỗi gateway một client, thêm bằng `bash scripts/add-iot-gateway.sh <client>`; dùng chung hàm trong `scripts/lib-keycloak.sh`); user thử `tester`/`tester`). Realm **chỉ import khi chưa tồn tại**: sửa file này thì phải xóa realm hoặc `docker compose down -v` rồi lên lại, hoặc (với thay đổi vai trò) chạy `bash scripts/setup-keycloak-roles.sh` để áp dụng vào realm đang chạy (idempotent; kiểm tra bằng `bash scripts/check-iot-permissions.sh`).
- **APISIX**: route nằm trong etcd, tạo bằng `bash scripts/setup-apisix-routes.sh` (chạy lại sau khi xóa volume): `/api/workflow/*` (Flowable, JWT), `/api/trace/*` (JWT) — hai route JWT còn có plugin `serverless-pre-function` (pha `rewrite`, vì `proxy-rewrite` thay header Authorization trước pha `access`) chỉ cho qua token có role `editor`/`readonly` (`claim_schema` của openid-connect KHÔNG áp dụng cho token bearer nên không dùng được), `/api/public/trace/*` (công khai, giới hạn tần suất), host `s3.localhost` (S3/STS của MinIO).
- **MinIO OIDC**: JWT Keycloak -> STS `AssumeRoleWithWebIdentity` -> SigV4. Bucket `dxos-data` riêng tư; CORS do MinIO xử lý (không dùng plugin cors ở route S3 để tránh header trùng).
- **Tầng 2** (`frontend/`, Next.js 16, đăng nhập `keycloak-js` PKCE): trang Human, Process (Flowable), Data (chỉ mô tả), Intelligence (đọc dữ liệu IoT từ MinIO). Giao diện tự dựng theo phong cách TailAdmin, chưa dùng template gốc.
- **Tầng 3** (`services/trace-api`, Node + PostgreSQL database `traceability`): truy xuất nguồn gốc 7 công đoạn; xem cần role `editor` hoặc `readonly`, ghi cần `editor` (token `iot-writer` bị từ chối); trang công khai `/verify/<mã>`. Công đoạn nung có thể gắn bằng chứng IoT (cột `iot` JSONB: min/avg/max + đường cong ≤60 điểm của cảm biến lò trong khoảng nung); client chỉ gửi `{deviceId, from, to}`; `trace-api` (`services/trace-api/iot.js`) tự đọc MinIO bằng tài khoản **chỉ đọc** `trace-reader` (policy `trace-iot-read`: GetObject/ListBucket trên `iot/*`, tạo bởi `scripts/setup-apisix-routes.sh`, mật khẩu `TRACE_S3_PASSWORD` trong `.env`) rồi tự tính tóm tắt và đóng dấu `verifiedAt`. Nguồn tin cậy là dữ liệu trong MinIO: `editor` bị Deny ghi/xóa `iot/`; mỗi gateway (`iot-writer`) chỉ ghi được vào thư mục riêng `iot/service-account-<client>/` (policy dùng `${jwt:preferred_username}`; MinIO KHÔNG nhận claim tùy chỉnh hay `azp` làm biến policy, đã thử); danh bạ `config/iot-devices.json` (mount vào trace-api, nạp lúc khởi động) gán mỗi thiết bị cho một gateway và trace-api chỉ đọc thư mục của gateway sở hữu, nên gateway khác bị lộ khóa không giả được số liệu của thiết bị này. Còn hạn chế: ai giữ khóa CHÍNH gateway đó (hoặc admin MinIO/Keycloak) vẫn giả được số liệu thiết bị của gateway đó; muốn chặt hơn cần Object Lock hoặc ký số từng lô. `trace-api` còn đánh giá chất lượng (`iot.quality`: độ phủ, khoảng trống lớn nhất, số lần đổi nhanh; loại mẫu ngoài `min`/`max` của thiết bị trong `config/iot-devices.json` và gắn cờ `low-coverage`/`out-of-range`/`rapid-change`/`few-samples`, hiển thị ở `KilnEvidence`); số liệu giả nhưng trông hợp lý thì chưa phát hiện được. Trang nội bộ có mã QR (`frontend/src/components/QrCode.tsx`, thư viện `qrcode`) dẫn tới `/verify/<mã>`; địa chỉ lấy từ `NEXT_PUBLIC_PUBLIC_BASE_URL` (bỏ trống = địa chỉ đang mở, nên ở máy local điện thoại chưa quét được).
- **IoT**: `backend/simulate-iot.js` (4 cảm biến xưởng gốm; `--post` ghi NDJSON lên MinIO qua APISIX, đăng nhập bằng client thiết bị `dxos-iot` qua client_credentials).

**Việc còn dở / ý tưởng tiếp theo:** phân quyền theo từng làng nghề; trang Data chưa tải lên/xuống tệp; quy trình Flowable thực tế (kiểm định lô hàng); README giới thiệu và CI (lint/build); đổi hết mật khẩu và khóa mẫu `change_me_*` trước khi triển khai thật; chưa thử đăng nhập SSO ở console MinIO bằng trình duyệt.

**Lưu ý kỹ thuật khi làm việc:**
- Next.js 16.4 khác bản đã biết: đọc `frontend/AGENTS.md` và `node_modules/next/dist/docs/` trước khi viết code; `useParams` phải nằm trong `<Suspense>`; không export dữ liệu dùng chung từ file `"use client"` cho server component.
- Phản hồi 403 do đoạn Lua ở APISIX phải tự đặt header `Access-Control-Allow-Origin` (Lua chạy trước plugin cors nên không được thêm header), nếu không trình duyệt chỉ báo "Failed to fetch". Keycloak tính lại vai trò khi làm mới token (đã kiểm chứng), nên `apiFetch` trong `AuthProvider.tsx` gặp 403 sẽ ép làm mới token một lần, cập nhật vai trò rồi thử lại; không cần bắt người dùng đăng nhập lại. User thử: `tester` (editor), `viewer` (readonly).
- Gọi API có tiếng Việt từ Windows bằng curl: ghi JSON ra tệp UTF-8 rồi gửi `--data-binary @tệp` kèm `-H "Content-Type: application/json; charset=utf-8"`; gõ thẳng tiếng Việt trong `-d` sẽ bị hỏng dấu (giao diện web không bị). Đừng chạy `npm install` khi `npm run dev` đang chạy (Turbopack lỗi 500); `TaskStop` không diệt hết cây tiến trình Next.js, kiểm tra cổng 3000 rồi `Stop-Process` nếu còn sót.
- Windows: shell là PowerShell 5.1 (không có `&&`; truyền thân PR nhiều dòng bằng `--body-file`); script `.sh` chạy bằng Git Bash. Keycloak 26 yêu cầu user có email, họ, tên mới cấp được token.
- Quy trình git: làm trên nhánh riêng, mở PR vào `main` rồi merge; không commit `.env`, `node_modules`. Repo GitHub: `dochicongg-lang/langnghe-dx-os` (công khai).
