# Hướng dẫn chạy và xem kết quả (dành cho người mới)

Tài liệu này dẫn bạn từng bước: bật hệ thống, chạy giả lập IoT, rồi **nhìn thấy số liệu trên trình duyệt**.
Mỗi bước có mục "Kết quả đúng trông như thế nào" để bạn tự kiểm tra.

## 0. Hiểu nhanh hệ thống (1 phút)

```
Cảm biến giả lập            MinIO (kho tệp)            Trình duyệt
simulate-iot.js  ──ghi──▶   bucket dxos-iot    ◀─đọc──  Trang Intelligence
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

> **Lối tắt (khuyên dùng): một lệnh làm cả bước 3, 4 và cài đặt Keycloak/MinIO.** Chạy trong **Git Bash** tại thư mục dự án:
>
> ```bash
> bash scripts/upgrade.sh
> ```
>
> Script tự tạo `.env` nếu chưa có (khóa `change_me_*` được sinh ngẫu nhiên), nếu đã có thì **chỉ bổ sung khóa còn thiếu** và không bao giờ ghi đè giá trị đang dùng; khởi động Docker, chờ các dịch vụ sẵn sàng, thiết lập vai trò/route/policy rồi chạy kiểm tra phân quyền thật.
> Chạy lại bất cứ lúc nào (cài mới hay nâng cấp sau khi kéo code mới) đều an toàn. Có thêm `--no-build` (không dựng lại image) và `--skip-check`.
> Nếu thành công, bạn có thể bỏ qua phần còn lại của bước 3 và bước 4 bên dưới (chúng là cách làm từng bước để hiểu hệ thống), rồi sang bước chạy giao diện.
> Nếu một bước lỗi, script dừng và nói rõ lỗi ở bước nào; sửa nguyên nhân rồi chạy lại.

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
[iot] đã ghi 8 bản ghi -> s3://dxos-iot/iot/service-account-dxos-iot/2026-11-12/2026-11-12T13-56-45-960Z.ndjson
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
docker exec dxos-minio sh -c "mc alias set local http://localhost:9000 minioadmin minioadmin123 && mc ls -r local/dxos-iot/iot/"
```

(Dùng `MINIO_ROOT_USER` và `MINIO_ROOT_PASSWORD` trong `.env` của bạn nếu đã đổi.)

Trang quản trị MinIO (xem tệp bằng giao diện): http://localhost:9001 (chỉ mở được từ chính máy chạy Docker; cổng này không được mở ra mạng vì không đi qua cổng gác). Bấm **Keycloak SSO** rồi đăng nhập `tester`/`tester`.

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
| Simulator: `Keycloak trả về 401 khi lấy token` hoặc `thiếu KEYCLOAK_IOT_CLIENT_SECRET` | Thiếu hoặc sai `KEYCLOAK_IOT_CLIENT_ID/SECRET`, hoặc chưa tạo client thiết bị | Đảm bảo `.env` khớp `.env.example`, rồi chạy `bash scripts/setup-keycloak-roles.sh` |
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

Mở http://localhost:3000/verify/GOM-BT-0001. Người mua quét mã QR dán trên sản phẩm sẽ vào đúng trang này. Mã QR nằm ở trang chi tiết sản phẩm phía nhân viên (thẻ **Mã QR tra cứu nguồn gốc**): bấm *Tải mã QR (SVG)* để lấy ảnh đem đi in. Khi chạy ở máy bạn, mã trỏ tới `localhost` nên điện thoại chưa quét được; khi triển khai thật, đặt biến `NEXT_PUBLIC_PUBLIC_BASE_URL` (ví dụ `https://truyxuat.ten-mien-cua-ban.vn`) trong môi trường chạy frontend.
Trang chỉ hiện thông tin được phép công bố: **không** có tên người ghi nhận hay thông tin nội bộ.

### 11c. Phân quyền (để hiểu cách hệ thống bảo vệ dữ liệu)

Hệ thống có **vai trò nghiệp vụ** và **sở hữu**: mỗi người thuộc một hợp tác xã (HTX), mỗi sản phẩm thuộc một HTX và có người tạo (chủ sở hữu).

| Người dùng (vai trò) | Xem sản phẩm | Tạo sản phẩm | Thêm công đoạn |
|---|---|---|---|
| Chưa đăng nhập | Không (401), chỉ `/verify/...` | Không | Không |
| `readonly` (`viewer`) | Tất cả | Không (403) | Không (403) |
| `ocop-officer` (`ocop`): cán bộ đơn vị đầu mối OCOP | Tất cả | Không | Không |
| `producer` (`hoa`): chủ thể sản xuất (hộ, doanh nghiệp, HTX, nghệ nhân) | Sản phẩm **cùng HTX** | Có, cho HTX của mình | Chỉ sản phẩm **do mình tạo** |
| `coop-officer` (`tuan`): cán bộ HTX | Sản phẩm cùng HTX | Có, cho HTX của mình | Mọi sản phẩm **cùng HTX** |
| `admin` (hoặc `editor` cũ, như `tester`) | Tất cả | Có | Có |
| Thiết bị IoT (`iot-writer`, client `dxos-iot`) | Không (403) | Không (403) | Không (403) |

Sản phẩm mà bạn không được xem sẽ hiện như "không tìm thấy" (không báo là có tồn tại). Người dùng chưa thuộc HTX nào sẽ không thấy sản phẩm của HTX nào và không tạo được sản phẩm.

Tài khoản thử (cho **môi trường phát triển**, mật khẩu = tên đăng nhập; đổi hoặc xóa trước khi triển khai thật), cùng HTX mẫu `htx-demo`:
`hoa` (producer), `tuan` (coop-officer), `ocop` (ocop-officer), `tester` (editor = admin), `viewer` (readonly).
Trang **Human** của giao diện hiện HTX và quyền hiệu lực của người đang đăng nhập.

**Muốn đổi quyền:** sửa duy nhất tệp `config/access.json` (ma trận vai trò × hành động × phạm vi `all`/`coop`/`own`/`self`), rồi chạy `bash scripts/upgrade.sh`.
Từ tệp đó hệ thống tự sinh: kiểm tra quyền trong `trace-api`, đoạn kiểm tra ở cổng gác, policy MinIO và danh sách vai trò Keycloak, nên không phải sửa nhiều nơi.
`editor` là bí danh **tạm thời** của `admin` trong lúc chuyển sang vai trò nghiệp vụ.

Role gán cho người dùng trong Keycloak (http://localhost:8080, đăng nhập `admin`/`admin`, realm **dxos** → Users → Role mapping). Mã HTX của người dùng là thuộc tính `coop` (Users → Attributes), ví dụ `htx-demo`; người dùng phải đăng nhập lại (hoặc đợi làm mới token) để nhận thay đổi.

**Dữ liệu cảm biến (thư mục `iot/` trong MinIO) có quyền riêng**, tách khỏi quyền ghi dữ liệu ứng dụng:

| Ai | Đọc `iot/` | Ghi/xóa trong `iot/` | Ghi dữ liệu ứng dụng ngoài `iot/` |
|---|---|---|---|
| `editor` (nhân viên) | Có | **Không** (không thể giả mạo hay xóa số liệu cảm biến) | Có |
| `readonly` | Có | Không | Không |
| `iot-writer` (thiết bị, client `dxos-iot`) | Không | **Chỉ ghi mới, và chỉ trong thư mục riêng của gateway đó** (`iot/service-account-<client>/`) | Không |

Nhờ đó, bằng chứng nhiệt độ lò trên trang `/verify` không thể bị nhân viên sửa. Thiết bị dùng client Keycloak riêng `dxos-iot`
(khóa `KEYCLOAK_IOT_CLIENT_SECRET` trong `.env`), mỗi gateway xưởng nên có client riêng để có thể thu hồi độc lập.
Token của thiết bị cũng bị cổng gác chặn ở API Workflow và API truy xuất nguồn gốc.

**Khóa theo từng gateway:** mỗi gateway chỉ ghi được vào thư mục riêng `iot/service-account-<client>/` (MinIO tự áp dụng bằng
biến `${jwt:preferred_username}` trong policy). Danh bạ `config/iot-devices.json` cho biết mỗi thiết bị (`kiln-01`, ...) thuộc gateway nào,
và khi dựng bằng chứng nung, `trace-api` **chỉ đọc thư mục của gateway sở hữu thiết bị đó**. Vì vậy một gateway bị lộ khóa không giả được số liệu
của thiết bị thuộc gateway khác, kể cả khi nó ghi bản ghi mang `deviceId` trùng vào thư mục của chính nó.

Thêm một gateway mới (ví dụ xưởng thứ hai):

```bash
bash scripts/add-iot-gateway.sh dxos-iot-xuong2      # tạo client riêng, in khóa MỘT lần: lưu vào cấu hình của gateway đó
```

Rồi khai báo thiết bị của gateway trong `config/iot-devices.json` (ví dụ `"kiln-02": "dxos-iot-xuong2"`) và chạy `docker compose restart trace-api`.
Gateway đó đăng nhập bằng `KEYCLOAK_IOT_CLIENT_ID`/`KEYCLOAK_IOT_CLIENT_SECRET` của nó. Nếu một gateway bị lộ khóa: xóa client đó trong Keycloak (Clients → xóa) là thu hồi ngay, không ảnh hưởng gateway khác.

**Nếu bạn đã chạy hệ thống từ trước** (realm Keycloak cũ, role cũ `readwrite`): thêm `KEYCLOAK_IOT_CLIENT_ID=dxos-iot` và
`KEYCLOAK_IOT_CLIENT_SECRET=...` vào `.env` (xem `.env.example`), rồi chạy lần lượt (không cần xóa dữ liệu):

```bash
docker compose up -d
bash scripts/setup-keycloak-roles.sh
bash scripts/setup-apisix-routes.sh
```

Bước `setup-apisix-routes.sh` cũng tự chuyển dữ liệu IoT cũ (`iot/<ngày>/`) vào thư mục của gateway mặc định, và cần `docker compose up -d --build trace-api` để nạp danh bạ thiết bị. Trên web **không cần đăng nhập lại** để nhận vai trò mới: Keycloak tính lại vai trò mỗi khi làm mới token, và khi gặp lỗi 403 giao diện tự làm mới token một lần rồi thử lại (token cũ tối đa vài phút là cũng tự đổi). Nếu vẫn thấy lỗi quyền, hãy đăng xuất rồi đăng nhập lại. Kiểm tra việc tách quyền bằng `bash scripts/check-iot-permissions.sh` (cuối dòng phải thấy `TẤT CẢ ĐẠT`).

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

### 11e. Gắn dữ liệu cảm biến lò vào công đoạn nung

1. Chạy simulator ghi lên MinIO để có dữ liệu: `node backend/simulate-iot.js --post` (để chạy vài phút rồi nhấn Ctrl+C).
2. Trong trang chi tiết sản phẩm, ở form **Thêm công đoạn** chọn *Nung / hoàn thiện*; hiện thêm mục **Gắn dữ liệu cảm biến lò**. Nhập mã thiết bị (`kiln-01`), giờ bắt đầu và giờ kết thúc nằm trong lúc simulator đang chạy, rồi bấm *Ghi nhận công đoạn*.
3. Máy chủ tự đọc nhiệt độ lò trong khoảng đó từ MinIO bằng một tài khoản **chỉ đọc** (`trace-reader`) và tính nhiệt độ thấp nhất/trung bình/cao nhất cùng đường cong. Trình duyệt không gửi số liệu nào lên, nên không thể khai khống. Kết quả hiện cả ở trang nhân viên và trang `/verify`.

**Chất lượng số liệu.** Khi dựng bằng chứng, máy chủ còn đánh giá dữ liệu và hiện kết quả ngay dưới biểu đồ (cả ở trang `/verify`):
- *Độ phủ dữ liệu* và *khoảng trống lớn nhất*: nếu cảm biến mất kết nối nhiều (độ phủ dưới 80%) thì có cờ cảnh báo màu vàng.
- Mẫu nằm **ngoài khoảng giá trị hợp lý** của thiết bị (`min`/`max` trong `config/iot-devices.json`, ví dụ lò nung 0–1400 °C) bị **loại** khỏi tóm tắt và được báo số lượng; giá trị đổi nhanh quá `maxRatePerSec` được gắn cờ.
Nhờ đó số liệu giả lộ liễu (như 9999 °C) không lọt vào bằng chứng, kể cả khi gateway bị lộ khóa. Giới hạn: số liệu giả nhưng trông hợp lý thì chưa phát hiện được.
Sửa giới hạn trong `config/iot-devices.json` rồi chạy `docker compose restart trace-api`.

Nếu báo *"Chưa cấu hình tài khoản đọc MinIO"*: thêm hai dòng `TRACE_S3_USER=trace-reader` và `TRACE_S3_PASSWORD=...` vào file `.env` (xem `.env.example`), chạy `bash scripts/setup-apisix-routes.sh` rồi `docker compose up -d --build trace-api`.

### 11f. Khóa chống sửa/xóa số liệu cảm biến (Object Lock)

**Ý tưởng (cho người mới):** hãy hình dung một chiếc két sắt có khóa hẹn giờ. Mỗi tệp số liệu cảm biến, ngay khi được ghi, bị khóa trong một khoảng thời gian: trong thời gian đó không thể xóa hay ghi đè. Mục đích là bảo đảm số liệu đã ghi thì không bị sửa lén hay xóa về sau, để bằng chứng nung trên `/verify` đứng vững khi có tranh chấp.

**Cách hệ thống làm:**
- Số liệu IoT nằm ở bucket riêng **`dxos-iot`** (tạo sẵn bởi `upgrade.sh`), **không** nằm chung với dữ liệu ứng dụng ở `dxos-data`. Object Lock chỉ bật được lúc tạo bucket, nên không thể bật cho bucket cũ.
- Cấu hình trong `.env`: `IOT_BUCKET`, `IOT_LOCK_MODE` (`GOVERNANCE` hoặc `COMPLIANCE`), `IOT_RETENTION_DAYS` (số ngày giữ, mặc định 1825 = 5 năm). Đổi giá trị chỉ áp cho tệp ghi **sau đó**.
- Ghi đè cùng tên tệp không làm mất bản cũ (chỉ tạo phiên bản mới, bản cũ vẫn bị khóa). Xóa thường chỉ tạo "dấu xóa" làm tệp biến mất khỏi danh sách. `trace-api` luôn đọc **bản ghi đầu tiên** của mỗi tệp và gắn cờ cảnh báo trên bằng chứng nếu thấy tệp bị ghi đè hoặc bị yêu cầu xóa.
- Nhân viên (`editor`) bị chặn mọi thao tác ghi/xóa/đổi khóa trên bucket này; thiết bị chỉ ghi mới vào thư mục riêng.

**Hai chế độ:**
| Chế độ | Ý nghĩa | Khi nào dùng |
|---|---|---|
| `GOVERNANCE` (mặc định) | Người thường không phá được; quản trị viên (root) vẫn gỡ được bằng đặc quyền bypass. Dọn dẹp dữ liệu thử được. | Phát triển, thử nghiệm, demo |
| `COMPLIANCE` | Đến cả root cũng không xóa/sửa được trước khi hết hạn. **Không hoàn tác**: dữ liệu thử cũng nằm lại đến hết hạn. | Triển khai thật |

**Lưu ý quan trọng về độ tin cậy của chế độ Governance.** Qua kiểm thử, bản MinIO đang dùng cho phép **bất kỳ tài khoản đăng nhập nào** (kể cả chỉ-đọc) gỡ hạn khóa Governance nếu gửi yêu cầu `PutObjectRetention` rỗng kèm tiêu đề `x-amz-bypass-governance-retention: true`, bất chấp policy. Vì vậy cổng APISIX chặn mọi yêu cầu đổi khóa đi qua `s3.localhost` (`?retention`, `?legal-hold`, `?object-lock` và tiêu đề bypass); `scripts/check-iot-permissions.sh` kiểm tra điều này. Đường vào **không qua cổng gác** (console MinIO ở cổng 9001, hay truy cập trực tiếp trong mạng Docker) thì chưa được chặn: không mở các đường đó ra ngoài. Chế độ `COMPLIANCE` được thiết kế để chống việc gỡ khóa này ở tầng lưu trữ, nên là lựa chọn nên dùng khi triển khai thật (chưa được kiểm thử ở đây vì không hoàn tác được).

**Giới hạn:** khóa chỉ bảo vệ khi truy cập qua MinIO. Nếu ai xóa cả ổ đĩa Docker (`docker compose down -v`) hoặc có quyền máy chủ thì dữ liệu vẫn mất, nên cần sao lưu riêng. Khóa cũng **không chứng minh số liệu là thật lúc ghi**: gateway bị lộ khóa vẫn ghi được số liệu mới trông hợp lý.

**Chọn số ngày giữ.** Mặc định 1825 ngày (5 năm). Cơ sở tham khảo (chưa phải tư vấn pháp lý, hãy xác nhận với chuyên gia): thời hiệu khởi kiện đòi bồi thường thiệt hại ngoài hợp đồng theo [Bộ luật Dân sự 2015](https://vbpl.vn:443/FileData/TW/Lists/vbpq/Attachments/95942/VanBanGoc_91.2015.QH13.P2.pdf) là 3 năm kể từ khi người bị hại biết quyền lợi bị xâm phạm; quy định truy xuất nguồn gốc thực phẩm của Bộ Công Thương nêu mốc lưu hồ sơ 60 tháng với sản phẩm không có hạn sử dụng ([nguồn tin](https://trungtamwto.vn/tin-tuc/33634-ap-dung-truy-xuat-nguon-goc-thuc-pham-tu-1511), gốm không phải thực phẩm nên chỉ để tham chiếu); hàng xuất khẩu sang EU thường phải lưu hồ sơ kỹ thuật 10 năm theo [Quy định an toàn sản phẩm chung (GPSR)](https://www.eurofins.com/consumer-product-testing/media-centre/news/know-the-obligations-of-manufacturers-under-the-gpsr/). Vì vậy: bán trong nước đặt 1825; xuất khẩu EU đặt 3650.

**Dọn số liệu cũ (việc của bạn).** Khi nâng cấp, số liệu cũ được **sao chép** sang `dxos-iot` và bản cũ trong `dxos-data/iot/` được giữ lại. Sau khi đã kiểm tra bucket mới chạy tốt, xóa bản cũ bằng:

```bash
docker exec dxos-minio sh -c "mc alias set local http://localhost:9000 minioadmin minioadmin123 && mc rm --recursive --force local/dxos-data/iot/"
```

(đổi `minioadmin`/`minioadmin123` theo `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` trong `.env` của bạn). Muốn dọn tệp thử trong `dxos-iot` ở chế độ Governance thì thêm `--versions --bypass`.

**Chuyển sang COMPLIANCE.** Đặt `IOT_LOCK_MODE=COMPLIANCE` trong `.env` không đủ: script thiết lập sẽ từ chối và giải thích, vì chế độ này không hoàn tác. Chỉ khi đã chắc chắn mới thêm `IOT_LOCK_CONFIRM_COMPLIANCE=yes`.

Chạy test của backend Tầng 3: `cd services/trace-api` rồi `npm test`. Kiểm thử script đồng bộ `.env`: `bash scripts/tests/test-env-sync.sh`. Kiểm tra phân quyền thật: `bash scripts/check-iot-permissions.sh`.
