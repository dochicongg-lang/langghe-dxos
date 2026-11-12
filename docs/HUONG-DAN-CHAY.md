# Hướng dẫn chạy và xem kết quả (dành cho người mới)

Tài liệu này dẫn bạn từng bước: bật hệ thống, chạy giả lập IoT, rồi **nhìn thấy số liệu trên trình duyệt**.
Mỗi bước có mục "Kết quả đúng trông như thế nào" để bạn tự kiểm tra.

## 0. Hiểu nhanh hệ thống (1 phút)

```
Cảm biến giả lập            MinIO (kho tệp)            Trình duyệt
simulate-iot.js  ──ghi──▶   bucket dxos-data   ◀─đọc──  Trang Intelligence
        │                        ▲                           │
        └─── xin "thẻ ra vào" ───┤                           │
             (JWT) từ Keycloak   │                           │
                          APISIX (cổng gác) ◀────────────────┘
```

- **Keycloak**: nơi đăng nhập, cấp "thẻ ra vào" (JWT).
- **APISIX**: cổng gác, mọi yêu cầu đều đi qua đây.
- **MinIO**: kho lưu tệp. Số liệu cảm biến được lưu thành tệp `.ndjson` (mỗi dòng là một bản ghi JSON).
- **PostgreSQL, Flowable**: cơ sở dữ liệu và quy trình, chạy nền (trang Process dùng Flowable).
- **Frontend (Next.js)**: giao diện web tại http://localhost:3000.

## 1. Cần cài sẵn

| Phần mềm | Kiểm tra bằng lệnh | Ghi chú |
|---|---|---|
| Docker Desktop | `docker --version` | Mở Docker Desktop và chờ nó báo "running" |
| Node.js 18 trở lên | `node -v` | Dùng chạy frontend và simulator |
| Git (kèm Git Bash) | `git --version` | Script `.sh` chạy bằng Git Bash |

## 2. Chuẩn bị file cấu hình (chỉ làm lần đầu)

Mở terminal tại thư mục dự án (`langnghe-dx-os`):

```bash
cp .env.example .env
```

File `.env` chứa mật khẩu mẫu, đủ để chạy thử trên máy bạn. **Không đưa `.env` lên GitHub** (đã được bỏ qua sẵn).

## 3. Bật hệ thống Tầng 1

```bash
docker compose up -d --build
```

Lần đầu Docker tải các image nên mất vài phút. Sau đó kiểm tra:

```bash
docker compose ps
```

**Kết quả đúng:** có 7 dòng (`dxos-postgres`, `dxos-minio`, `dxos-keycloak`, `dxos-flowable`, `dxos-etcd`, `dxos-apisix`, `dxos-trace-api`); các dòng postgres, minio, keycloak, etcd ghi `(healthy)`, còn lại ghi `Up`.
Keycloak cần khoảng 30–60 giây mới `healthy`. Nếu chưa, chờ rồi chạy lại `docker compose ps`.

## 4. Tạo các tuyến đường (route) trên cổng gác APISIX

Mở **Git Bash** tại thư mục dự án (không dùng cmd) và chạy:

```bash
bash scripts/setup-apisix-routes.sh
```

**Kết quả đúng:** thấy các dòng bắt đầu bằng `OK:`, ví dụ
`OK: route /api/workflow/* ...` và `OK: S3/STS qua http://s3.localhost:9080 ...`.

Làm lại bước này mỗi khi bạn xóa dữ liệu Docker (`docker compose down -v`), vì route được lưu trong etcd.

## 5. Chạy giả lập IoT

### 5a. Thử nhanh: chỉ in ra màn hình (không cần Docker)

```bash
node backend/simulate-iot.js --count 3 --interval 1000
```

**Kết quả đúng:** 3 lượt, mỗi lượt 4 dòng JSON, ví dụ:

```
{"deviceId":"kiln-01","deviceName":"Lò nung gốm số 1","metric":"temperature","value":842.9,"unit":"°C","timestamp":"2026-11-12T13:55:51.374Z"}
```

Đọc dòng trên: thiết bị "Lò nung gốm số 1" đo **nhiệt độ** được **842.9 °C** lúc `timestamp`.
Có 4 cảm biến: nhiệt độ lò nung, nhiệt độ xưởng, độ ẩm xưởng, độ ẩm kho đất sét.

### 5b. Chạy thật: ghi số liệu lên MinIO qua APISIX

```bash
node backend/simulate-iot.js --post --interval 2000 --batch 8
```

- `--interval 2000`: cứ 2 giây đo một lượt.
- `--batch 8`: gom đủ 8 bản ghi thì ghi một tệp lên MinIO.
- Dừng bằng **Ctrl+C** (script ghi nốt số liệu còn lại rồi thoát).

**Kết quả đúng:** ngoài các dòng JSON, cứ vài giây có thêm dòng:

```
[iot] đã ghi 8 bản ghi -> s3://dxos-data/iot/2026-11-12/2026-11-12T13-56-45-960Z.ndjson
```

Dòng này xuất hiện ở "kênh lỗi" của terminal nên có thể có màu khác; đó là bình thường.
**Hãy để cửa sổ terminal này chạy**, rồi mở cửa sổ terminal thứ hai cho bước 6.

Nếu thấy `[iot] ghi MinIO thất bại: ...`, xem phần "Gặp lỗi" ở cuối.

## 6. Chạy giao diện web

Ở terminal thứ hai:

```bash
cd frontend
npm install
npm run dev
```

(`npm install` chỉ cần làm lần đầu, mất 1–2 phút.)

**Kết quả đúng:** terminal in `✓ Ready` và địa chỉ `http://localhost:3000`.

## 7. Xem kết quả trên trình duyệt

1. Mở http://localhost:3000. Trang tự chuyển sang màn hình đăng nhập của Keycloak.
2. Đăng nhập bằng tài khoản thử: **tester** / **tester**.
3. Bạn quay lại giao diện Làng Nghề Số. Bấm **Intelligence** ở thanh bên trái.

**Kết quả đúng trên trang Intelligence:**
- 4 thẻ: *Lò nung gốm số 1 – Nhiệt độ*, *Xưởng tạo hình – Nhiệt độ*, *Xưởng tạo hình – Độ ẩm*, *Kho đất sét – Độ ẩm*.
- Mỗi thẻ có số lớn (giá trị mới nhất), biểu đồ đường xu hướng, và ba ô Thấp nhất / Trung bình / Cao nhất.
- Bảng "10 bản ghi mới nhất" ở dưới.
- Trang tự làm mới mỗi 10 giây; bạn sẽ thấy "điểm" tăng dần và số thay đổi khi simulator còn chạy. Có nút **Làm mới** để tải ngay.

Nếu trang ghi "Chưa có dữ liệu": simulator (bước 5b) chưa chạy hoặc chưa ghi tệp nào. Chạy nó, chờ vài chục giây.

Các trang khác để tham khảo: **Human** (hồ sơ của bạn từ token), **Process** (danh sách quy trình Flowable), **Data** (mô tả).

## 8. Tự kiểm tra từng lớp bằng dòng lệnh (tùy chọn, giúp hiểu hệ thống)

Kiểm tra cổng gác đang chặn người lạ (phải trả về **401**):

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:9080/api/workflow/repository/process-definitions
```

Xem các tệp số liệu đã nằm trong MinIO (đọc bằng quyền quản trị, chạy trong container):

```bash
docker exec dxos-minio sh -c "mc alias set local http://localhost:9000 minioadmin minioadmin123 && mc ls -r local/dxos-data/iot/"
```

(Dùng `MINIO_ROOT_USER` và `MINIO_ROOT_PASSWORD` trong `.env` của bạn nếu đã đổi.)

Trang quản trị MinIO (xem tệp bằng giao diện): http://localhost:9001. Bấm **Keycloak SSO** rồi đăng nhập `tester`/`tester`.

## 9. Dừng và dọn dẹp

- Dừng simulator và frontend: nhấn **Ctrl+C** ở từng terminal.
- Tắt hệ thống Docker nhưng **giữ dữ liệu**: `docker compose down`
- Tắt và **xóa sạch dữ liệu** (làm lại từ đầu): `docker compose down -v` (sau đó làm lại từ bước 3).

## 10. Gặp lỗi?

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| `docker: command not found` | Chưa cài hoặc chưa mở Docker Desktop | Cài/mở Docker Desktop, mở lại terminal |
| Trang web: "Không thể đăng nhập" | Keycloak chưa sẵn sàng | Chờ `docker compose ps` báo `(healthy)` rồi tải lại trang |
| `[iot] ghi MinIO thất bại: STS 400 ... aud` hoặc `STS 4xx` | Realm Keycloak cũ, thiếu cấu hình mới | Xem mục "Cập nhật realm" bên dưới |
| Simulator: `Keycloak trả về 401 khi lấy token` | Sai `KEYCLOAK_CLIENT_SECRET` | Đảm bảo `.env` khớp `.env.example` |
| Intelligence: "Không đọc được dữ liệu: Failed to fetch" | Route S3 chưa tạo, hoặc `s3.localhost` không phân giải được | Chạy lại bước 4; dùng Chrome/Edge (tự hiểu `*.localhost`) |
| Cổng đã bị chiếm (port is already allocated) | Chương trình khác dùng cổng 8080/9080/9000/5432 | Tắt chương trình đó hoặc đổi cổng trong `.env` |
| `bash: ... not found` khi chạy script | Không dùng Git Bash | Mở Git Bash rồi chạy lại |

### Cập nhật realm Keycloak (khi kéo code mới về)

Realm chỉ được nạp **một lần** khi chưa tồn tại. Khi file `keycloak/dxos-realm.json` thay đổi, cần xóa realm cũ để nạp lại:

```bash
docker compose down -v
docker compose up -d --build
bash scripts/setup-apisix-routes.sh
```

(Lệnh `down -v` xóa toàn bộ dữ liệu Docker của dự án, kể cả số liệu IoT đã ghi.)

## 11. Tầng 3: Truy xuất nguồn gốc sản phẩm làng nghề

Đây là ứng dụng nghiệp vụ đầu tiên của dự án: theo dõi một sản phẩm (ví dụ bình gốm) qua 7 công đoạn
**Nguyên liệu → Sơ chế → Tạo hình → Nung/hoàn thiện → Kiểm định → Đóng gói → Phân phối**.
Dịch vụ `trace-api` chạy trong Docker, lưu dữ liệu ở PostgreSQL (database `traceability`, tự tạo, tự nạp 2 sản phẩm mẫu).

### 11a. Xem phía nhân viên (cần đăng nhập)

1. Bật hệ thống và frontend như các bước 3–6 ở trên (nhớ `docker compose up -d --build` lần đầu để dựng `trace-api`, và chạy `bash scripts/setup-apisix-routes.sh`).
2. Mở http://localhost:3000, đăng nhập `tester` / `tester`, bấm **Truy xuất nguồn gốc** (mục "Nghiệp vụ · Tầng 3" ở thanh bên trái).

**Kết quả đúng:** bảng có 2 sản phẩm mẫu `GOM-BT-0001` (Bình gốm men rạn Bát Tràng) và `LUA-VP-0007` (Khăn lụa tơ tằm).

- Bấm vào một mã để xem **tiến trình công đoạn** (✓ là đã có), **dòng thời gian** và thông tin sản phẩm.
- Form **Thêm sản phẩm** (bên phải trang danh sách): nhập tên, bấm *Tạo sản phẩm*; để trống ô mã thì hệ thống tự sinh mã.
- Form **Thêm công đoạn** (trong trang chi tiết): chọn công đoạn, địa điểm, ghi chú rồi bấm *Ghi nhận công đoạn*; dòng mới hiện ngay trên dòng thời gian.

### 11b. Xem phía người mua (không cần đăng nhập)

Mở http://localhost:3000/verify/GOM-BT-0001. Đây là trang bạn có thể in thành mã QR dán lên sản phẩm.
Trang chỉ hiện thông tin được phép công bố: **không** có tên người ghi nhận hay thông tin nội bộ.

### 11c. Phân quyền (để hiểu cách hệ thống bảo vệ dữ liệu)

| Người dùng | Xem danh sách/chi tiết | Tạo sản phẩm, thêm công đoạn |
|---|---|---|
| Chưa đăng nhập | Không (401), chỉ dùng được trang `/verify/...` | Không |
| Có role `readonly` | Có | Không (403) |
| Có role `readwrite` (như `tester`) | Có | Có |

Role gán cho người dùng trong Keycloak (http://localhost:8080, đăng nhập `admin`/`admin`, realm **dxos** → Users → Role mapping).

### 11d. Thử bằng dòng lệnh (tùy chọn)

Tra cứu công khai, không cần token (đúng sẽ thấy JSON của sản phẩm):

```bash
curl http://localhost:9080/api/public/trace/GOM-BT-0001
```

Gọi API nội bộ không có token (đúng sẽ trả về `401`, cổng gác chặn):

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:9080/api/trace/products
```

Dịch vụ `trace-api` **không mở cổng ra máy bạn**; chỉ vào được qua APISIX, nên mọi truy cập đều qua kiểm tra của cổng gác.
Tuyến công khai bị giới hạn 5 yêu cầu/giây mỗi địa chỉ để tránh bị dò quét mã.
