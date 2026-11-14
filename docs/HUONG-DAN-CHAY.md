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

Các trang khác để tham khảo: **Human** (tài khoản, vai trò và những việc bạn được làm), **Process** (các bước xử lý hồ sơ của hệ thống), **Data** (vòng đời dữ liệu; quản trị còn thấy việc chuyển dữ liệu cũ và nhật ký hoạt động), **Intelligence** (nhận định các mẻ nung và số liệu cảm biến).

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

Trang quản trị MinIO (xem tệp bằng giao diện) **mặc định KHÔNG được mở** vì nó đi thẳng vào MinIO mà không qua cổng gác. Cần dùng thì bật tạm cho quản trị viên (chỉ nghe trên chính máy chạy Docker): `docker compose -f docker-compose.yml -f docker-compose.console.yml up -d minio`, rồi mở http://localhost:9001, bấm **Keycloak SSO** và đăng nhập `tester`/`tester`. Dùng xong tắt lại bằng `docker compose up -d minio`.

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
Trang **Human** của giao diện hiện tài khoản, hợp tác xã, vai trò (kèm mô tả một câu) và danh sách "Bạn có thể làm gì" bằng tiếng Việt thường. Mã quyền và tên policy chỉ hiện trong mục "Chi tiết kỹ thuật" dành cho quản trị.

**Xác thực hai yếu tố (OTP) cho cán bộ HTX.** Tài khoản có vai trò `coop-officer` (như `tuan`) bị bắt dùng mã OTP khi đăng nhập trên trình duyệt: lần đầu Keycloak hiện màn hình "Cài đặt ứng dụng xác thực" để cài ứng dụng (Google Authenticator, FreeOTP...); các lần sau hỏi mã 6 số. Muốn thử mà không có điện thoại: ở màn hình cài OTP bấm **"Không quét được?"** để lấy khóa chữ, rồi chạy `node scripts/totp.js <khóa>` (có thể dán cả khoảng trắng) để lấy mã. Muốn bật OTP cho vai trò khác: thêm `"mfa": true` vào vai trò đó trong `config/access.json` rồi chạy `bash scripts/upgrade.sh` (hiện chỉ hỗ trợ một vai trò). Đăng nhập bằng mật khẩu trực tiếp qua API (dùng trong các script kiểm tra) chỉ không bị đòi OTP **chừng nào người đó chưa cài OTP**; sau khi `tuan` đã cài OTP, Keycloak cũng đòi mã OTP ở kiểu đăng nhập này nên các script đăng nhập bằng `tuan/tuan` (`check-iot-permissions.sh`, `check-ocop-flow.js`...) báo lỗi như "Không lấy được token persona". Khi đó chạy `bash scripts/reset-otp.sh` để xóa OTP của `tuan` (mặc định; có thể truyền tên người dùng khác), chạy lại script kiểm tra, rồi cài OTP lại ở lần đăng nhập trình duyệt kế tiếp. Cách thủ công: Keycloak → Users → Credentials → xóa OTP.

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

**Khuyến nghị cho triển khai thật: dùng COMPLIANCE.** Đã kiểm chứng (`node scripts/check-minio-lock-modes.js --yes`) cùng một yêu cầu khai thác, gửi thẳng vào MinIO bằng tài khoản chỉ-xem: với đối tượng **GOVERNANCE** hạn khóa bị gỡ (HTTP 200), với đối tượng **COMPLIANCE** yêu cầu bị từ chối (HTTP 400) và hạn khóa còn nguyên. Vì COMPLIANCE không hoàn tác được (kể cả root không xóa được trước khi hết hạn) nên môi trường phát triển giữ GOVERNANCE để dọn dữ liệu thử; khi triển khai thật hãy đặt `IOT_LOCK_MODE=COMPLIANCE` và `IOT_LOCK_CONFIRM_COMPLIANCE=yes` (script thiết lập không cho chạy COMPLIANCE nếu thiếu xác nhận). Chưa có bản MinIO nào mới hơn để nâng cấp (kiểm tra ngày 2026-11-14).

**Lưu ý về độ tin cậy của chế độ Governance.** Qua kiểm thử, bản MinIO đang dùng cho phép **bất kỳ tài khoản đăng nhập nào** (kể cả chỉ-đọc) gỡ hạn khóa Governance nếu gửi yêu cầu `PutObjectRetention` rỗng kèm tiêu đề `x-amz-bypass-governance-retention: true`, bất chấp policy. Vì vậy cổng APISIX chặn mọi yêu cầu đổi khóa đi qua `s3.localhost` (`?retention`, `?legal-hold`, `?object-lock` và tiêu đề bypass); `scripts/check-iot-permissions.sh` kiểm tra điều này. Đường vào **không qua cổng gác** (console MinIO ở cổng 9001, hay truy cập trực tiếp trong mạng Docker) thì chưa được chặn: không mở các đường đó ra ngoài. Chế độ `COMPLIANCE` được thiết kế để chống việc gỡ khóa này ở tầng lưu trữ, nên là lựa chọn nên dùng khi triển khai thật (chưa được kiểm thử ở đây vì không hoàn tác được).

**Giới hạn:** khóa chỉ bảo vệ khi truy cập qua MinIO. Nếu ai xóa cả ổ đĩa Docker (`docker compose down -v`) hoặc có quyền máy chủ thì dữ liệu vẫn mất, nên cần sao lưu riêng. Khóa cũng **không chứng minh số liệu là thật lúc ghi**: gateway bị lộ khóa vẫn ghi được số liệu mới trông hợp lý.

**Chọn số ngày giữ.** Mặc định 1825 ngày (5 năm). Cơ sở tham khảo (chưa phải tư vấn pháp lý, hãy xác nhận với chuyên gia): thời hiệu khởi kiện đòi bồi thường thiệt hại ngoài hợp đồng theo [Bộ luật Dân sự 2015](https://vbpl.vn:443/FileData/TW/Lists/vbpq/Attachments/95942/VanBanGoc_91.2015.QH13.P2.pdf) là 3 năm kể từ khi người bị hại biết quyền lợi bị xâm phạm; quy định truy xuất nguồn gốc thực phẩm của Bộ Công Thương nêu mốc lưu hồ sơ 60 tháng với sản phẩm không có hạn sử dụng ([nguồn tin](https://trungtamwto.vn/tin-tuc/33634-ap-dung-truy-xuat-nguon-goc-thuc-pham-tu-1511), gốm không phải thực phẩm nên chỉ để tham chiếu); hàng xuất khẩu sang EU thường phải lưu hồ sơ kỹ thuật 10 năm theo [Quy định an toàn sản phẩm chung (GPSR)](https://www.eurofins.com/consumer-product-testing/media-centre/news/know-the-obligations-of-manufacturers-under-the-gpsr/). Vì vậy: bán trong nước đặt 1825; xuất khẩu EU đặt 3650.

**Dọn số liệu cũ (việc của bạn).** Khi nâng cấp, số liệu cũ được **sao chép** sang `dxos-iot` và bản cũ trong `dxos-data/iot/` được giữ lại. Sau khi đã kiểm tra bucket mới chạy tốt, xóa bản cũ bằng:

```bash
docker exec dxos-minio sh -c "mc alias set local http://localhost:9000 minioadmin minioadmin123 && mc rm --recursive --force local/dxos-data/iot/"
```

(đổi `minioadmin`/`minioadmin123` theo `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` trong `.env` của bạn). Muốn dọn tệp thử trong `dxos-iot` ở chế độ Governance thì thêm `--versions --bypass`.

**Chuyển sang COMPLIANCE.** Đặt `IOT_LOCK_MODE=COMPLIANCE` trong `.env` không đủ: script thiết lập sẽ từ chối và giải thích, vì chế độ này không hoàn tác. Chỉ khi đã chắc chắn mới thêm `IOT_LOCK_CONFIRM_COMPLIANCE=yes`.

Chạy test của backend Tầng 3: `cd services/trace-api` rồi `npm test`. Kiểm thử script đồng bộ `.env`: `bash scripts/tests/test-env-sync.sh`. Kiểm tra phân quyền thật: `bash scripts/check-iot-permissions.sh`.

## 12. Quy trình hồ sơ OCOP (bản khung)

Hệ thống chỉ **hỗ trợ và theo dõi** việc lập hồ sơ OCOP. Kết quả chính thức do cơ quan có thẩm quyền quyết định, cán bộ đầu mối nhập vào. Cấu hình mặc định là **Thành phố Hà Nội** trong `config/ocop-profiles.json`, và đang đánh dấu **chưa đối chiếu văn bản gốc** (`"verified": false`; giao diện không hiện cảnh báo này, nó được ghi ở mục "Lưu ý cho nhóm phát triển" của README và trong issue công khai): trước khi dùng cho hồ sơ thật phải kiểm tra lại các quyết định được ghi ở đầu tệp đó.

**Chuẩn bị:** chạy `bash scripts/upgrade.sh` (bước 4b nạp quy trình vào Flowable), rồi `cd frontend && npm run dev`.

**Kịch bản trình diễn (mỗi bước đổi tài khoản; mật khẩu = tên đăng nhập):**
1. `hoa` (nghệ nhân): vào mục **Hồ sơ OCOP**, tạo hồ sơ (chọn nhóm, tự chấm A/B/C, đánh dấu giấy tờ), mở hồ sơ rồi bấm **Nộp hồ sơ**. Nếu thiếu giấy tờ bắt buộc, hệ thống từ chối và nói rõ.
2. `tuan` (cán bộ HTX): lần đầu đăng nhập bằng trình duyệt sẽ bị bắt cài OTP (xem mục về OTP; mã tính bằng `node scripts/totp.js <khóa>`; cần cài lại thì `bash scripts/reset-otp.sh`). Mở hồ sơ, chọn **Sơ duyệt: Đạt**, **Yêu cầu bổ sung** hoặc **Không đạt** (hai trường hợp sau bắt buộc ghi lý do). Nếu yêu cầu bổ sung, `hoa` nộp lại.
3. `ocop` (cán bộ đơn vị đầu mối): với hồ sơ đã sơ duyệt đạt, nhập điểm chính thức, số quyết định, ngày quyết định. Hạng sao và ngày hết hạn (36 tháng) do hệ thống tính từ cấu hình.

Trang chi tiết hiển thị bước hiện tại của quy trình, lịch sử xử lý (chỉ ghi thêm) và kết quả chính thức. Tự kiểm tra toàn bộ quy trình thật qua cổng gác, Keycloak và Flowable: `node scripts/check-ocop-flow.js` (mỗi lần chạy tạo vài hồ sơ thử).

## 13. Sao lưu, khôi phục và tự phục hồi

**Sao lưu** (an toàn chạy khi hệ thống đang chạy; MinIO bị dừng vài giây để dữ liệu nhất quán, thêm `--hot` để bỏ qua bước dừng):

```bash
bash scripts/backup.sh                 # ra backups/<ngày-giờ>/
bash scripts/backup.sh /đường/dẫn/khác # hoặc chọn thư mục
```

**Sao lưu định kỳ và giữ N bản:** `bash scripts/backup.sh --keep 7` sau khi sao lưu xong chỉ giữ 7 bản mới nhất trong `backups/` (chỉ xóa thư mục tên dạng ngày-giờ có `SHA256SUMS`, không đụng thư mục khác). Chạy lặp trong một cửa sổ: `bash scripts/backup-loop.sh 24 7` (mỗi 24 giờ, giữ 7 bản). Hệ thống KHÔNG tự cài lịch vào hệ điều hành; muốn chạy nền hãy tự đặt lịch:

- Linux/macOS (cron): `0 2 * * * cd /đường/dẫn/dự-án && bash scripts/backup.sh --keep 7 >> backups/backup.log 2>&1`
- Windows (Task Scheduler, mở PowerShell): `schtasks /Create /SC DAILY /ST 02:00 /TN "LangNgheSo-Backup" /TR "\"C:\Program Files\Git\bin\bash.exe\" -lc 'cd /c/đường/dẫn/dự-án && bash scripts/backup.sh --keep 7'"`

Bản sao lưu gồm: từng CSDL PostgreSQL (Keycloak, Flowable, truy xuất), toàn bộ dữ liệu MinIO (mọi bucket, phiên bản, khóa Object Lock, tài khoản và policy), `.env`, thư mục `config/` và tệp mã kiểm tra `SHA256SUMS`. **Thư mục này chứa mật khẩu trong `.env`**: cất ở nơi an toàn, không đưa lên git (`backups/` đã được loại khỏi git).

**Khôi phục** (XÓA dữ liệu hiện có và thay bằng bản sao lưu, nên bắt buộc có `--yes`):

```bash
bash scripts/restore.sh backups/<ngày-giờ> --yes
```

Script kiểm tra mã `SHA256SUMS` trước tiên: bản sao lưu hỏng hoặc bị sửa thì dừng ngay, chưa đụng tới dữ liệu hiện tại. Nếu `.env` hiện tại khác `env.backup` trong bản sao lưu, hãy chép `env.backup` thành `.env` trước khi khôi phục (mật khẩu phải khớp với dữ liệu). Route của cổng gác nằm trong etcd và được tạo lại bằng `bash scripts/upgrade.sh` nếu cần.

**Tự phục hồi:** mọi dịch vụ đã có `restart: unless-stopped`; `trace-api` có healthcheck. `bash scripts/heal.sh` khởi động lại container đang dừng hoặc báo unhealthy và sửa lỗi 502 ở cổng gác (APISIX giữ địa chỉ cũ của container đã được tạo lại). Chạy định kỳ bằng cron (`*/2 * * * * cd /đường/dẫn/dự-án && bash scripts/heal.sh`), Task Scheduler (Windows), hoặc `bash scripts/heal.sh --watch 60` giữ trong một cửa sổ.

**Kiểm chứng thật:** `node scripts/check-backup-restore.js` tạo dấu thử ở cả ba kho (một sản phẩm, một đối tượng MinIO, một người dùng Keycloak), sao lưu, xóa, khôi phục, rồi kiểm tra cả ba trở lại và hệ thống vẫn dùng được (mất vài phút).

## 14. Quét mã độc tệp tải lên

Tệp đính kèm hồ sơ OCOP được quét bằng ClamAV (dịch vụ `clamav` trong `docker-compose.yml`) **trước khi** ghi vào kho tệp. Tệp nhiễm bị từ chối (mã 422) và không được lưu. Mặc định "đóng khi lỗi": ClamAV chưa sẵn sàng thì tải lên bị từ chối (mã 503) với thông báo thử lại sau; đặt `CLAMAV_REQUIRED=false` trong `.env` chỉ khi thử nghiệm.

Lưu ý: ClamAV cần khoảng 1–2 GB RAM và vài phút để nạp cơ sở dữ liệu virus ở lần khởi động đầu (cần Internet để cập nhật; kiểm tra bằng `docker compose ps`, cột health). Kiểm chứng thật: `node scripts/check-malware-scan.js` (gồm tệp thử EICAR, tệp mang chuỗi thử riêng của dự án `clamav/dxos-selftest.ndb`, và việc tải lên bị từ chối khi tắt ClamAV).

## 15. Neo nhật ký kiểm toán

Chuỗi băm của nhật ký một mình không phát hiện được việc cắt bớt các dòng cuối hay tính lại cả chuỗi. Vì vậy `trace-api` ghi định kỳ (mặc định mỗi 60 phút, `ANCHOR_INTERVAL_MINUTES`; 0 để tắt) một bản neo gồm số thứ tự và băm của dòng cuối vào bucket `dxos-audit` (có Object Lock, tài khoản `trace-anchor` không xóa được). Nút "Kiểm tra toàn vẹn nhật ký" ở trang Data đối chiếu cả các bản neo. Quản trị có thể neo ngay bằng `POST /api/trace/audit/anchor`. Kiểm chứng thật, gồm cả hai kiểu tấn công và việc khôi phục sau đó: `node scripts/check-audit-anchor.js`.

## 16. Quyền của trace-api đối với Flowable

Flowable REST không có phân quyền mịn: một tài khoản chỉ có quyền `access-rest-api` vẫn quản lý được engine, tạo/xóa người dùng và triển khai/xóa quy trình. Vì vậy hệ thống không dựa vào "người dùng Flowable ít quyền" mà giới hạn ở cổng gác. `trace-api` gọi Flowable qua một **route nội bộ** của APISIX trên cổng 9081 (chỉ trong mạng Docker, không publish ra máy chủ), kèm khóa riêng `FLOWABLE_PROXY_KEY` trong `.env`. Route này gắn mật khẩu admin của Flowable ở phía cổng gác và chỉ cho đúng ba thao tác: bắt đầu quy trình hồ sơ OCOP, xem việc của MỘT tiến trình, hoàn thành việc. Mọi thao tác khác trả 403, nên nếu `trace-api` bị chiếm thì kẻ tấn công cũng không xóa được quy trình hay tạo người dùng Flowable.

Khi đổi `apisix/config.yaml` hoặc nạp lại route: `docker compose restart apisix` rồi `bash scripts/setup-apisix-routes.sh` (hoặc `bash scripts/upgrade.sh`). Kiểm chứng thật: `node scripts/check-flowable-internal.js` (thử từ bên trong container `trace-api` mọi thao tác nguy hiểm, cộng luồng OCOP đầy đủ).

## 17. Nhắc hạn, leo thang và thông báo

Hệ thống tự quét hồ sơ OCOP mỗi giờ (`NOTIFY_INTERVAL_MINUTES` trong `.env`, 0 để tắt) và tạo thông báo hiện ở **chuông** trên thanh đầu của giao diện:

| Tình huống | Ai được nhắc | Mức |
|---|---|---|
| Hồ sơ chờ HTX sơ duyệt đủ 12 ngày làm việc | Cán bộ HTX của hợp tác xã đó | Cảnh báo |
| Quá hạn sơ duyệt 15 ngày làm việc | Cán bộ HTX, quản trị và cán bộ đầu mối OCOP (leo thang) | Khẩn |
| HTX yêu cầu bổ sung đã 7 ngày chưa nộp lại | Người nộp hồ sơ | Cảnh báo |
| Đã sơ duyệt đạt, chờ kết quả chính thức 20 ngày | Cán bộ đầu mối OCOP | Cảnh báo |
| Kết quả OCOP còn 180 ngày (mở cửa sổ gia hạn) | Chủ hồ sơ và cán bộ HTX | Cảnh báo |
| Còn 120 ngày (nhắc gấp) hoặc đã hết hiệu lực | Chủ hồ sơ và cán bộ HTX | Khẩn |

Mỗi sự việc chỉ thông báo một lần; trạng thái "đã đọc" riêng cho từng người; thông báo gắn với một hợp tác xã không hiện cho người của hợp tác xã khác. Các ngưỡng nằm trong `config/ocop-profiles.json` (`communeReviewWorkingDays`, `renewalWindowDays`, khối `reminders`). Quản trị có thể quét ngay bằng `POST /api/trace/notifications/scan`. **Giới hạn:** ngày làm việc chỉ trừ thứ Bảy và Chủ nhật (chưa trừ ngày lễ); chưa gửi email (cần máy chủ SMTP). Kiểm chứng thật: `node scripts/check-notifications.js`.

## 18. Hồ dữ liệu phân tích và truy vết nguồn gốc dữ liệu

Dữ liệu chính của hệ thống nằm ở PostgreSQL (đang dùng) và kho lưu trữ lạnh. Để phân tích nhanh mà không làm chậm hệ thống, quản trị có thể xuất bản sao dạng bảng cột (**Parquet**) sang MinIO (tiền tố `lake/` của bucket tệp) và chạy phân tích trên đó bằng **DuckDB**. Ở trang **Data**, thẻ "Hồ dữ liệu phân tích":

- Nút **Xuất dữ liệu sang hồ ngay** (hoặc tự động mỗi `LAKE_INTERVAL_HOURS` giờ, mặc định 24, 0 để tắt) tạo bốn bộ dữ liệu: hồ sơ OCOP, lịch sử xử lý (gộp cả tầng nóng và các tệp đã lưu trữ lạnh), mẻ nung có bằng chứng cảm biến, nhật ký kiểm toán (đã bỏ đường dẫn và địa chỉ IP).
- Mỗi lần xuất tạo tệp **mới** (không ghi đè) và ghi **truy vết nguồn gốc**: dữ liệu lấy từ bảng nào, từ tệp lưu trữ nào (kèm mã kiểm tra), số dòng, mã kiểm tra của chính tệp Parquet. Tệp được đọc lại và đối chiếu mã trước khi ghi sổ; khi phân tích, mã trong sổ phải khớp tệp thật, nếu không truy vấn bị từ chối.
- Năm phân tích mẫu: hồ sơ theo trạng thái, hồ sơ theo tháng và số sao trung bình, lịch sử theo tầng lưu trữ, mẻ nung theo kết luận, yêu cầu API theo nhóm mã trạng thái. Hệ thống không nhận câu lệnh SQL tùy ý từ người dùng.

**Giới hạn:** phân tích chỉ đọc lần xuất mới nhất của mỗi bộ dữ liệu (chưa gộp nhiều lần xuất); truy vết ở mức bộ dữ liệu (chưa tới từng cột). Chỉ quản trị dùng được; người dùng khác bị từ chối (403) và không đọc được bucket tệp. Kiểm chứng thật: `node scripts/check-lakehouse.js`.

## 19. Trợ lý hỏi đáp và đề xuất của hệ thống (trang Intelligence)

**Hỏi đáp.** Thẻ "Hỏi đáp về hồ sơ OCOP và hệ thống" trả lời các câu như "hồ sơ OCOP nhóm hàng thủ công cần giấy tờ gì", "bao nhiêu điểm thì được 4 sao", "kết quả OCOP có hiệu lực bao lâu". Trợ lý **tra cứu** trong quy định OCOP, hồ sơ nung, danh sách vai trò và hướng dẫn của hệ thống rồi **trích lại đoạn phù hợp nhất kèm nguồn**; nó không dùng mô hình sinh văn bản, nên không bịa: nếu không tìm thấy thì nói rõ là chưa có thông tin. Vì kho tri thức dựng từ chính các tệp cấu hình nên số liệu (hạng sao, hạn, hiệu lực, giấy tờ) luôn khớp hệ thống đang chạy. Muốn bổ sung hướng dẫn: sửa `config/assistant-faq.json` rồi khởi động lại `trace-api` (`docker compose restart trace-api`). Mọi vai trò dùng được API đều hỏi được.

**Đề xuất chờ duyệt** (cán bộ HTX và quản trị). Khi phân tích mẻ nung cho kết luận **Cần xem lại** hoặc **Cảnh báo**, hệ thống tạo một đề xuất kèm lý do và căn cứ (tự động ngay khi công đoạn nung có bằng chứng cảm biến được ghi; quản trị cũng quét tay được bằng `POST /api/trace/agent/scan`). Hệ thống **không tự làm gì**: chỉ khi bạn bấm **Duyệt và gửi thông báo** thì thông báo mới tới cán bộ HTX của hợp tác xã sở hữu sản phẩm (hoặc quản trị nếu sản phẩm chưa thuộc hợp tác xã nào); bấm **Từ chối** thì không có gì được gửi. Cán bộ HTX chỉ thấy và duyệt đề xuất của hợp tác xã mình; một đề xuất không duyệt được hai lần.

**Giới hạn:** chưa có mô hình ngôn ngữ (tìm kiếm theo từ khóa, chưa hiểu nghĩa); tác tử mới theo dõi mẻ nung; có thể gắn thêm mô hình mã nguồn mở chạy cục bộ (ví dụ Ollama) nếu có máy đủ mạnh. Kiểm chứng thật: `node scripts/check-assistant-agent.js`.

## Gói phát hành và Linux/macOS

Tạo gói phát hành bằng `bash scripts/make-release-archive.sh 0.3.0` (kiểm đủ tệp, không CRLF, không chứa `.env`/`backups`). Đừng tự chạy `git archive` trên Windows. Mã QR quét được bằng điện thoại khi build giao diện với `NEXT_PUBLIC_PUBLIC_BASE_URL=http://<IP-LAN>:3000`, rồi `npm run start -- -H 0.0.0.0` (điện thoại cùng Wi-Fi; Windows có thể hỏi mở cổng tường lửa). Đã kiểm chứng trang `/verify/<mã>` mở được qua địa chỉ LAN; chưa thử bằng điện thoại thật.

## 20. Đưa hệ thống ra Internet

Xem [TRIEN-KHAI-INTERNET.md](TRIEN-KHAI-INTERNET.md). Trước tiên chạy `node scripts/prod-check.js` để biết hệ thống còn thiếu gì (mật khẩu mẫu, khóa dữ liệu chưa ở chế độ COMPLIANCE, HTTPS, chế độ Keycloak, tài khoản thử...). Hệ thống hiện mới chạy thật trên máy phát triển, chưa triển khai thật lên Internet.
