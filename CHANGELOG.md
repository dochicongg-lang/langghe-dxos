# Lịch sử thay đổi

Theo khuôn dạng [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/) và [Semantic Versioning](https://semver.org/lang/vi/).
Số `#n` là pull request trên GitHub.

## [Chưa phát hành]

### Thêm
- **Ngành nghề (gốm, lụa) trên cùng một nền tảng:** `config/sectors.json` khai báo từng ngành và chuỗi công đoạn riêng (lụa: nuôi tằm, ươm tơ, dệt, nhuộm, kiểm định, đóng gói, phân phối). Ngành của sản phẩm suy ra từ danh mục nên không đổi cơ sở dữ liệu; máy chủ từ chối công đoạn không thuộc ngành (`services/trace-api/sectors.js`, có test); `GET /api/trace/sectors`; sản phẩm trả thêm `sector`, `sector_label`, `stages`. Dữ liệu mẫu có thêm hai sản phẩm lụa. Ngành lụa chưa có phân tích riêng (Intelligence); chỉ gốm có phân tích mẻ nung.
- **Giao diện làm lại theo hướng ít mà đủ:** trang chủ theo việc cần làm (khối chào kèm tra nhanh theo mã, bốn ô số, việc của bạn, ba bước hồ sơ, ngành nghề, sản phẩm gần đây); menu dùng biểu tượng và tên theo việc làm, không dùng thuật ngữ kỹ thuật; danh sách sản phẩm và hồ sơ OCOP có tìm kiếm, bộ lọc (ngành, trạng thái), biểu mẫu mở khi cần; trang Việc đang xử lý hiện bốn chặng của hồ sơ; trang Cấu trúc nền tảng minh họa bốn tầng H-P-D-I cho từng ngành; trang giới thiệu công khai `/gioi-thieu`; trang Trợ giúp; trang 404 và trang lỗi tiếng Việt; liên kết bỏ qua menu cho bàn phím.
- **Cửa sổ nổi Trợ giúp và Liên hệ:** liệt kê hướng dẫn và các kênh liên hệ (điện thoại, Zalo, Facebook, email) do đơn vị vận hành cấu hình bằng `NEXT_PUBLIC_SUPPORT_*` (`frontend/.env.example`); kênh nào để trống thì không hiện.
- **Trang tra cứu công khai theo ngành:** công đoạn và ba chương theo ngành của sản phẩm, ảnh minh họa, biểu tượng từng công đoạn.
- **Ảnh minh họa:** hình vẽ trong `frontend/public/illustrations/`; ảnh chụp (giấy phép Pexels) đặt ở `frontend/public/photos/` nhưng KHÔNG đưa lên kho mã (xem `CREDITS.md`); thiếu ảnh thì giao diện tự dùng hình vẽ hoặc ẩn.
- **Chuẩn bị triển khai Internet:** `scripts/prod-check.js` (rà soát mức sẵn sàng, có test), `scripts/set-public-urls.sh` (địa chỉ công khai của client đăng nhập), tham số hóa `KC_HOSTNAME_URL`, tài liệu `docs/TRIEN-KHAI-INTERNET.md`. Chưa triển khai thật.
- **Trợ lý hỏi đáp có nguồn và tác tử đề xuất có người duyệt:** trợ lý trả lời bằng cách trích quy định OCOP, hồ sơ nung, vai trò và hướng dẫn của hệ thống (kho tri thức dựng từ cấu hình nên số liệu luôn khớp; không đoán khi không tìm thấy); tác tử tạo đề xuất khi mẻ nung cần xem lại hoặc cảnh báo, chỉ gửi thông báo sau khi người có thẩm quyền (đúng HTX) duyệt (`scripts/check-assistant-agent.js`).
- **Hồ dữ liệu phân tích và truy vết nguồn gốc dữ liệu:** xuất bốn bộ dữ liệu (hồ sơ OCOP, lịch sử xử lý nóng và lạnh, mẻ nung, nhật ký kiểm toán) sang Parquet trong MinIO, phân tích bằng DuckDB (truy vấn mẫu cố định), sổ truy vết ghi nguồn và băm của mỗi lần xuất; thẻ "Hồ dữ liệu phân tích" ở trang Data (`scripts/check-lakehouse.js`).
- **Nhắc hạn, leo thang và thông báo trong ứng dụng:** nhắc cán bộ HTX khi hồ sơ gần hạn sơ duyệt (ngày làm việc), leo thang khi quá hạn, nhắc người nộp bổ sung hồ sơ, nhắc gia hạn khi kết quả OCOP sắp hết hiệu lực; chuông thông báo ở thanh đầu với trạng thái đã đọc theo từng người (`scripts/check-notifications.js`).
- **Neo nhật ký kiểm toán:** băm đầu chuỗi nhật ký được ghi định kỳ vào bucket riêng có Object Lock; kiểm tra toàn vẹn nay đối chiếu cả các bản neo nên phát hiện được việc cắt bớt dòng cuối và việc tính lại cả chuỗi (`scripts/check-audit-anchor.js`).
- **Quét mã độc tệp tải lên bằng ClamAV:** tệp đính kèm hồ sơ được quét trước khi lưu, mặc định từ chối khi không quét được; ghi nhận công cụ quét và thời điểm quét (`scripts/check-malware-scan.js`).
- **Sao lưu, khôi phục và tự phục hồi:** `scripts/backup.sh`, `scripts/restore.sh`, `scripts/heal.sh`; `trace-api` có healthcheck; kiểm chứng thật bằng `scripts/check-backup-restore.js`.

### Bảo mật
- `trace-api` không còn giữ mật khẩu admin của Flowable: gọi Flowable qua route nội bộ của cổng gác (cổng 9081 không publish, cần khóa riêng) chỉ cho ba thao tác của quy trình OCOP; mọi thao tác quản trị khác bị từ chối (`scripts/check-flowable-internal.js`).
- Vai trò chỉ-xem (`readonly`) không còn đọc được bucket tệp hồ sơ và bucket bản neo khi đi thẳng vào MinIO: policy dựng sẵn của MinIO được ghi đè bằng bản có Deny hai bucket nội bộ (`scripts/check-minio-direct.js`).

### Sửa
- **Gói phát hành bị CRLF:** tệp `.tar.gz` tạo bằng `git archive` trên Windows (`core.autocrlf=true`) chứa dấu xuống dòng CRLF làm script bash lỗi trên Linux/macOS. Nay có `.gitattributes` (luôn LF) và `scripts/make-release-archive.sh <phiên-bản>` (tạo gói rồi kiểm: đủ tệp, không CRLF, không chứa mục cấm); CI chạy `--check`. Các gói v0.1.0 đến v0.2.1 đã đăng bị lỗi này, hãy dùng gói phát hành mới. Đã kiểm chứng trong container Debian và Alpine (Node 22): 168/168 test đơn vị, cú pháp mọi script, build giao diện; chưa chạy toàn bộ docker compose trên Linux/macOS.
- Mã QR: đã kiểm chứng bản build chạy `-H 0.0.0.0` với `NEXT_PUBLIC_PUBLIC_BASE_URL` là địa chỉ LAN phục vụ `/verify/<mã>` và API công khai qua địa chỉ LAN; chưa thử bằng điện thoại thật.
- Dockerfile của `trace-api` sao chép mọi tệp `.js` (trước đây liệt kê từng tệp nên thêm module mới làm container không khởi động).

## [0.2.1] - 2026-11-14

### Sửa
- Tài liệu `docs/HUONG-DAN-CHAY.md`: sửa mục xác thực hai yếu tố (OTP): sau khi người dùng cài OTP, đăng nhập mật khẩu trực tiếp cũng bị đòi mã, kèm cách xử lý bằng `bash scripts/reset-otp.sh`; cập nhật mô tả trang Human, Process, Data, Intelligence và tên các màn hình tiếng Việt của Keycloak.
- Làm gọn tài liệu và lời văn trong README, NOTICE, CLAUDE.md và chú thích của `scripts/add-license-headers.js`; `scripts/seed-demo.js` không còn trỏ tới tài liệu đã gỡ.

### Xóa
- Gỡ khỏi kho mã hai tài liệu nội bộ không thuộc mã nguồn.

## [0.2.0] - 2026-11-14

### Thay đổi
- **Trang tra cứu công khai `/verify`** trình bày thành ba chương (người làm ra, ngọn lửa, chứng nhận) có thanh chương, tấm biển thông tin, đường cong nhiệt độ lò cỡ lớn có trục và điểm đỉnh; công đoạn chưa có bản ghi hiện thành khoảng trống nhìn thấy được (#25).
- **Ngôn ngữ giao diện dễ hiểu cho người không chuyên:** vai trò kèm mô tả, danh sách "Bạn có thể làm gì" thay cho mã quyền, kho dữ liệu mô tả bằng lời thường; mã quyền và tên policy chỉ hiện cho quản trị (#25).
- Trạng thái trống chỉ bước tiếp theo; nhãn kết luận có biểu tượng đi kèm màu; trang Process chỉ hiện quy trình của hệ thống (#25).
- Lưu ý dành cho nhà phát triển (quy định OCOP chưa đối chiếu, ngưỡng nung minh họa, dữ liệu mẫu) chuyển khỏi giao diện sang mục "Lưu ý cho nhóm phát triển" của README (#25).

### Thêm
- `scripts/reset-otp.sh`: xóa OTP của người dùng thử (mặc định `tuan`) để cài lại hoặc để các script kiểm tra đăng nhập mật khẩu trực tiếp chạy được (#26).
- Bản dịch tiếng Việt cho câu hướng dẫn cài OTP của Keycloak (#26).

### Sửa
- Ghi nhận và hướng dẫn xử lý lỗi: sau khi người dùng bắt buộc MFA cài OTP, Keycloak cũng đòi OTP ở đăng nhập mật khẩu trực tiếp (#26).

### Kiểm thử
- Chạy thử từ máy sạch (`docker compose down -v`, rồi `bash scripts/upgrade.sh` khoảng 5,5 phút, `seed-demo.js`): 122 test đơn vị và các bộ kiểm chứng thật qua cổng gác, Keycloak, Flowable, MinIO đều đạt.

## [0.1.1] - 2026-11-14

### Sửa
- CI trên GitHub: lệnh test của `trace-api` chạy được ở Node 22 (`node --test`), và sinh kiểu route của Next.js (`next typegen`) trước khi kiểm tra kiểu giao diện (#23). Nội dung sản phẩm không đổi so với 0.1.0.

## [0.1.0] - 2026-11-13

Bản đầu tiên của dự án (DX-OS Open-Core cho làng nghề).

### Thêm
- **Tầng 1 (lõi không giao diện):** Keycloak (đăng nhập một lần, JWT), Apache APISIX (cổng API), Flowable (quy trình BPMN), PostgreSQL, MinIO, đóng gói bằng Docker Compose, cài đặt và nâng cấp một lệnh `scripts/upgrade.sh` (#1, #11).
- **Tầng 2 (H-P-D-I):** giao diện Next.js gồm các trang Human, Process, Data, Intelligence; đăng nhập PKCE; trang Intelligence đọc số liệu cảm biến từ MinIO (#2, #4).
- **Tầng 3 (nghiệp vụ):** API `trace-api` truy xuất nguồn gốc 7 công đoạn, trang công khai `/verify/<mã>` kèm mã QR (#5, #8).
- **IoT:** trình giả lập cảm biến lò nung (#3); bằng chứng nhiệt độ nung do máy chủ tự đối chiếu với kho dữ liệu, kèm đánh giá chất lượng số liệu (#7, #8, #11); bucket có Object Lock chống sửa/xóa, phát hiện ghi đè, khóa theo từng gateway (#9, #10, #12).
- **Phân quyền nghiệp vụ theo HTX** từ một tệp duy nhất `config/access.json`, OTP cho cán bộ HTX, trang Process chỉ hiện quy trình của dự án (#14, #15).
- **Quy trình hồ sơ OCOP** trên Flowable (`workflows/dxos-ocop-support.bpmn20.xml`), lớp API trung gian, cấu hình quy tắc theo địa phương (`config/ocop-profiles.json`, mẫu Hà Nội, số liệu minh họa), giao diện lập, sơ duyệt, ghi kết quả (#16).
- **Tệp đính kèm hồ sơ** (kiểm loại theo nội dung, giới hạn cỡ, băm SHA-256) vào kho riêng không truy cập trực tiếp được; trang công khai hiển thị tách bạch "kết quả OCOP chính thức" và "xác nhận của nền tảng" (#17).
- **Vòng đời dữ liệu:** lưu trữ lịch sử hồ sơ đã kết thúc từ PostgreSQL sang MinIO (nén, có băm, kiểm tra đọc lại trước khi xóa) (#18).
- **Phân tích đường cong nung (tính năng [I]):** bộ luật giải thích được, cấu hình trong `config/kiln-profiles.json`, hiển thị ở trang Intelligence và trang công khai (#19).
- **Nhật ký kiểm toán hành vi API:** cổng gác ghi yêu cầu (không lưu token), bảng chỉ ghi thêm có chuỗi băm, trang quản trị kiểm tra toàn vẹn (#20).
- **Giao diện và đăng nhập:** bảng màu đất nung, theme đăng nhập Keycloak tiếng Việt, chống dò mật khẩu, dashboard và menu theo vai trò (#16).
- **Gói trình diễn:** kịch bản, dàn ý slide, nạp dữ liệu mẫu (`scripts/seed-demo.js`), minh họa Zero-Trust (`scripts/demo-zero-trust.js`) (#21).
- **Kiểm thử:** 122 test đơn vị và 4 bộ kiểm tra chạy thật qua cổng gác, Keycloak, Flowable, MinIO (`scripts/check-*.sh|js`).
- Giấy phép Apache-2.0 (`LICENSE`, `NOTICE`), dòng `SPDX-License-Identifier` ở đầu mọi tệp mã (`scripts/add-license-headers.js`, có chế độ `--check`), danh mục bên thứ ba (`THIRD-PARTY-NOTICES.md`), `CONTRIBUTING.md`, mẫu issue, quy trình CI (kiểm giấy phép, kiểu, lint, test).
### Bảo mật
- Chặn ở cổng gác lỗ hổng của bản MinIO đang dùng (mọi tài khoản STS gỡ được khóa Governance bằng tiêu đề bypass); chặn thao tác ghi vào Flowable của người không phải quản trị (#12, #13).

### Thay đổi
- Ghim ảnh `pgsty/minio` theo mã băm để bản dựng lặp lại được.

### Giới hạn đã biết
- Số liệu quy định OCOP và ngưỡng nung là minh họa, chưa đối chiếu văn bản gốc.
- Chuỗi băm nhật ký chưa neo ra ngoài nên không phát hiện được việc cắt bớt các dòng cuối.
- Chưa có GitOps đầy đủ, kiểm dịch mã độc ở biên, hồ dữ liệu phân tích (Parquet), tác tử AI/RAG.
