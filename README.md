# Làng Nghề Số (DX-OS Open-Core)

Mô hình thực hành số cho **làng nghề**, xây theo khung **DX-OS 3 tầng** và dùng hoàn toàn **phần mềm nguồn mở**.

Hệ thống giúp một sản phẩm làng nghề (ví dụ bình gốm Bát Tràng) có **hành trình truy xuất công khai**: người mua quét mã QR là thấy
nghệ nhân, các công đoạn sản xuất, **đường cong nhiệt độ lò nung thật** (kèm dấu cho biết máy chủ đã đối chiếu số liệu cảm biến)
và kết quả OCOP nếu có. Nghệ nhân và hợp tác xã được **hỗ trợ lập, sơ duyệt và theo dõi hồ sơ OCOP** trên một quy trình thật.

## Kiến trúc

| Tầng | Thành phần (đều mã nguồn mở) | Vai trò |
|---|---|---|
| **1. Lõi không giao diện** | Keycloak (đăng nhập một lần, JWT) · Apache APISIX (cổng gác) · Flowable (quy trình) · PostgreSQL + MinIO (dữ liệu) | Chỉ cung cấp dịch vụ qua REST API |
| **2. Không gian H-P-D-I** | Next.js | Giao diện dùng chung: Human, Process, Data, Intelligence; menu và dashboard theo vai trò |
| **3. Nghiệp vụ** | `trace-api` (Node.js) + trang công khai | Truy xuất nguồn gốc; hỗ trợ hồ sơ OCOP |

```
Trình duyệt ──JWT──► APISIX ──► trace-api ──► PostgreSQL (nóng)
                       │            ├────────► Flowable (quy trình hồ sơ OCOP, qua lớp API trung gian)
Quét QR ─► /verify ────┘            └────────► MinIO: tệp hồ sơ, kho lưu trữ lạnh
Cảm biến lò ──► MinIO (bucket Object Lock) ──► trace-api tự đối chiếu ──► bằng chứng nhiệt độ ──► phân tích đường cong nung
APISIX ──http-logger──► nhật ký kiểm toán (chỉ ghi thêm, chuỗi băm)
```

**Nguyên tắc:** Tầng 1 không có giao diện; mọi API được bảo vệ đều đi qua APISIX và xác thực JWT của Keycloak.

## Điểm nổi bật
- **Quy trình hồ sơ OCOP thật trên Flowable** (BPMN `workflows/dxos-ocop-support.bpmn20.xml`): nghệ nhân lập và nộp, cán bộ HTX sơ duyệt (đạt / cần bổ sung / không đạt), cán bộ đầu mối ghi kết quả chính thức. Quy tắc theo địa phương (ngưỡng sao, hiệu lực, danh mục giấy tờ) nằm trong `config/ocop-profiles.json`; **số liệu Hà Nội hiện là minh họa, chưa đối chiếu văn bản gốc**. Hệ thống **không cấp giấy OCOP**, chỉ hỗ trợ và theo dõi; trang công khai tách bạch "kết quả OCOP chính thức" và "xác nhận của nền tảng".
- **Tải ảnh/PDF hồ sơ** qua `trace-api` (kiểm quyền, đọc chữ ký nội dung, giới hạn cỡ, băm SHA-256) vào kho riêng mà người dùng cuối không chạm trực tiếp được.
- **Bằng chứng nhiệt độ nung do máy chủ tự đối chiếu**: trình duyệt chỉ gửi thiết bị và khoảng thời gian, số liệu do `trace-api` tự đọc và tính.
- **Số liệu cảm biến bất biến**: lưu ở bucket MinIO có **Object Lock (WORM)**; ghi đè hoặc xóa lén bị phát hiện và gắn cờ. Cổng gác chặn lỗ hổng gỡ khóa của MinIO bản đang dùng (đã kiểm chứng).
- **[I] Phân tích thông minh đường cong nung**: bộ luật giải thích được (đỉnh nhiệt, thời gian giữ, tốc độ gia nhiệt/làm nguội, so với mẻ khác, độ tin cậy dữ liệu); ngưỡng trong `config/kiln-profiles.json` là số liệu minh họa.
- **Vòng đời dữ liệu**: lịch sử hồ sơ đã kết thúc tự chuyển từ PostgreSQL (nóng) sang MinIO (lạnh, nén, có băm), kiểm tra đọc lại trước khi xóa ở tầng nóng.
- **Nhật ký kiểm toán hành vi API**: cổng gác ghi ai gọi gì, khi nào, kết quả (không lưu token); bảng chỉ ghi thêm và có chuỗi băm để phát hiện sửa lén.
- **Phân quyền nghiệp vụ theo HTX** từ một tệp duy nhất `config/access.json`: nghệ nhân, cán bộ HTX, cán bộ đơn vị đầu mối, quản trị, chỉ xem, thiết bị. Cổng gác, `trace-api`, MinIO và Keycloak đều sinh/đọc từ tệp này; mỗi vai trò chỉ thấy phần việc của mình.
- **OTP** cho cán bộ HTX khi đăng nhập trên trình duyệt; trang đăng nhập tiếng Việt, chống dò mật khẩu.
- **Cài đặt và nâng cấp một lệnh**, và các bộ kiểm tra chạy thật qua cổng gác.

## Chạy nhanh
Cần: Docker Desktop, Node.js, Git Bash (Windows). Mở **Git Bash** tại thư mục dự án:

```bash
bash scripts/upgrade.sh          # tạo .env, dựng và khởi động Docker, cấu hình Keycloak/APISIX/MinIO/Flowable, kiểm tra phân quyền
node scripts/seed-demo.js        # nạp dữ liệu mẫu cho trình diễn (chạy lặp lại an toàn)
cd frontend && npm install       # lần đầu
npm run dev                      # mở http://localhost:3000
```
Hướng dẫn từng bước cho người mới: [docs/HUONG-DAN-CHAY.md](docs/HUONG-DAN-CHAY.md).

**Tài khoản thử** (chỉ môi trường phát triển; mật khẩu trùng tên đăng nhập; đổi hoặc xóa trước khi triển khai thật):
`hoa` (nghệ nhân), `tuan` (cán bộ HTX, bắt dùng OTP), `ocop` (cán bộ đơn vị đầu mối), `tester` (quản trị), `viewer` (chỉ xem).

Địa chỉ: giao diện `http://localhost:3000` · cổng gác `http://localhost:9080` · Keycloak `http://localhost:8080`.
Trang truy xuất công khai: `http://localhost:3000/verify/GOM-BT-0001` (sau khi nạp dữ liệu mẫu có kết quả OCOP minh họa và kết luận phân tích mẻ nung).

## Build từ mã nguồn
Toàn bộ hệ thống dựng được từ mã nguồn bằng công cụ mã nguồn mở và cấu hình bằng biến môi trường (không phải sửa tệp mã):

1. **Yêu cầu:** Docker Engine và Docker Compose v2 (Docker Desktop trên Windows/macOS), Node.js 20 trở lên (khuyến nghị 22), Git, Bash (Git Bash trên Windows).
2. **Lấy mã:** `git clone` kho mã rồi `cd` vào thư mục dự án. Các script tự chuyển về thư mục gốc của kho mã nên chạy từ đâu cũng được.
3. **Cấu hình:** `scripts/upgrade.sh` tự tạo `.env` từ `.env.example` (các khóa `change_me_*` được sinh ngẫu nhiên). Muốn đổi cấu hình thì sửa `.env`.
4. **Dựng và chạy hạ tầng:** `bash scripts/upgrade.sh` dựng ảnh `trace-api` từ `services/trace-api/Dockerfile`, kéo các ảnh dịch vụ mã nguồn mở (phiên bản đã ghim trong `docker-compose.yml`), khởi động và cấu hình Keycloak, APISIX, MinIO, Flowable.
5. **Dựng giao diện:** `cd frontend && npm ci && npm run build && npm run start` (hoặc `npm run dev` khi phát triển).
6. **Kiểm tra bản dựng:** các lệnh ở mục "Kiểm thử" bên dưới.

Đã thử trên Windows 11 (Git Bash, Docker Desktop). Linux và macOS dùng cùng các lệnh nhưng **chưa thử trên máy thật**.

## Dữ liệu mẫu và công cụ thử
- Nạp dữ liệu mẫu (chạy lặp lại an toàn): `node scripts/seed-demo.js`.
- Minh họa Zero-Trust chạy trực tiếp (không đổi dữ liệu): `node scripts/demo-zero-trust.js`.
- Giả lập cảm biến lò: `node backend/simulate-iot.js --post` (liên tục) hoặc `--scenario firing|overheat|fast-ramp|low-peak --days-ago N` (ghi lùi một mẻ nung hoàn chỉnh).

## Cấu trúc thư mục
| Đường dẫn | Nội dung |
|---|---|
| `docker-compose.yml`, `.env.example` | hạ tầng Tầng 1 và `trace-api` |
| `config/` | `access.json` (ma trận quyền và trang theo vai trò, nguồn duy nhất), `ocop-profiles.json` (quy tắc OCOP theo địa phương), `kiln-profiles.json` (hồ sơ nung), `iot-devices.json` (danh bạ thiết bị) |
| `workflows/` | quy trình BPMN nạp vào Flowable |
| `keycloak/` | realm cho cài mới, theme đăng nhập tiếng Việt |
| `services/trace-api/` | API truy xuất, hồ sơ OCOP, phân quyền, bằng chứng IoT, phân tích nung, lưu trữ, nhật ký kiểm toán, migration, test |
| `frontend/` | giao diện Next.js |
| `backend/simulate-iot.js` | giả lập cảm biến và kịch bản mẻ nung |
| `scripts/` | cài đặt/nâng cấp, thiết lập Keycloak/APISIX/MinIO/Flowable, nạp dữ liệu mẫu, minh họa, các bộ kiểm tra |
| `docs/` | hướng dẫn chạy, kịch bản trình diễn, dàn ý slide |

## Kiểm thử
```bash
cd services/trace-api && npm test                   # 122 test đơn vị
cd frontend && npx tsc --noEmit && npx eslint src   # kiểu và lint
bash scripts/tests/test-env-sync.sh                 # script tạo .env
bash scripts/check-iot-permissions.sh               # phân quyền THẬT qua cổng gác, MinIO, Keycloak
node scripts/check-ocop-flow.js                     # quy trình hồ sơ OCOP thật (Flowable), tệp đính kèm, lưu trữ, trang công khai
node scripts/check-kiln-insight.js                  # phân tích mẻ nung thật (simulator ghi lùi các mẻ, tự dọn)
node scripts/check-audit-log.js                     # nhật ký kiểm toán thật, bất biến, phát hiện sửa lén
```

## Bảo mật
- Chỉ cổng gác (9080) và Keycloak (8080) mở ra mạng; PostgreSQL, console MinIO và Admin API của APISIX chỉ nghe trên máy chủ; Flowable, API kho lưu trữ và `trace-api` không mở cổng nào.
- Mật khẩu mặc định (PostgreSQL, MinIO, Keycloak admin) và tài khoản thử **phải đổi** trước khi triển khai thật. Chế độ khóa dữ liệu mặc định là Governance; khi triển khai thật nên dùng COMPLIANCE (không hoàn tác, cần xác nhận rõ ràng, xem hướng dẫn).
- Giới hạn đã biết: chuỗi băm của nhật ký chưa neo ra ngoài nên không phát hiện được việc cắt bớt các dòng cuối; console MinIO chưa bị chặn kho tệp; cấu hình OCOP và ngưỡng nung chưa được xác nhận. Chi tiết ở mục "Lưu ý cho nhóm phát triển" bên dưới.
- Hệ thống **hỗ trợ và theo dõi** quy trình chứng nhận; không tự cấp giấy chứng nhận của cơ quan có thẩm quyền.

## Lưu ý cho nhóm phát triển
Các điểm sau cố ý **không** hiển thị trên giao diện, nhưng cần nắm trước khi dùng thật hoặc trình diễn:

- **Quy định OCOP** (`config/ocop-profiles.json`, hồ sơ `hanoi-2026`): số liệu (thang điểm, ngưỡng sao, hiệu lực 36 tháng, danh mục giấy tờ, cấp thẩm quyền) tổng hợp từ báo chí và cổng thông tin, đặt `"verified": false`. Phải đối chiếu Quyết định 26/2026/QĐ-TTg và Quyết định 3488/QĐ-UBND trước khi dùng cho hồ sơ thật. Đổi tệp thì API và giao diện đổi theo, không cần sửa mã.
- **Ngưỡng nung** (`config/kiln-profiles.json`): khoảng nhiệt độ chuẩn, ngưỡng nguy hiểm, tốc độ gia nhiệt và làm nguội là số liệu minh họa theo hiểu biết chung, `"verified": false`. Cần thợ gốm hoặc chuyên gia xác nhận theo loại men, kích thước sản phẩm và lò thực tế. Kết luận phân tích chỉ hỗ trợ ra quyết định, không thay thế kiểm định chất lượng.
- **Dữ liệu trình diễn** (`node scripts/seed-demo.js`): số quyết định OCOP, điểm và ba sản phẩm gốm là dữ liệu mẫu, không phải hồ sơ thật. Không dùng số quyết định mẫu ở nơi công bố thật.
- **Dữ liệu cảm biến** do trình giả lập tạo (`node backend/simulate-iot.js --post --interval 2000 --batch 8`); khi chưa có thiết bị thật, trang Intelligence sẽ trống cho tới khi chạy lệnh này.
- **Quy trình mẫu của Flowable** bị ẩn ở trang Process; chỉ hiện quy trình thuộc hệ thống (`category = dxos`).
- **OTP của tài khoản `tuan`** (cán bộ HTX, bắt buộc MFA khi đăng nhập trình duyệt): sau khi `tuan` cài OTP, Keycloak cũng đòi mã OTP ở đăng nhập mật khẩu trực tiếp, nên các script kiểm tra đăng nhập bằng `tuan/tuan` (`check-iot-permissions.sh`, `check-ocop-flow.js`...) sẽ bị từ chối. Chạy `bash scripts/reset-otp.sh` để xóa OTP của `tuan` (cài lại ở lần đăng nhập trình duyệt kế tiếp) trước khi chạy script kiểm tra hoặc trước buổi trình diễn. Không có điện thoại thì dùng `node scripts/totp.js <khóa Base32>` để tính mã.
- **Xác nhận của nền tảng** ở trang công khai `/verify` luôn ghi rõ chưa phải giấy chứng nhận OCOP: đây là ranh giới pháp lý, giữ nguyên.

## Giấy phép và tài liệu dự án
Dự án phát hành theo **Giấy phép Apache, Phiên bản 2.0** (giấy phép nguồn mở được OSI chấp thuận): toàn văn ở [LICENSE](LICENSE),
thông báo bản quyền và mục đích giấy phép ở [NOTICE](NOTICE). Mỗi tệp mã nguồn có dòng `SPDX-License-Identifier: Apache-2.0` ở đầu tệp
(kiểm tra bằng `node scripts/add-license-headers.js --check`).

- Thư viện và dịch vụ bên thứ ba, giấy phép của từng thành phần: [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
- Lịch sử thay đổi: [CHANGELOG.md](CHANGELOG.md). Đóng góp: [CONTRIBUTING.md](CONTRIBUTING.md).
- Báo lỗi và đề xuất: mục **Issues** của kho mã (có mẫu sẵn). Kiểm tra tự động: GitHub Actions ([.github/workflows/ci.yml](.github/workflows/ci.yml)).
