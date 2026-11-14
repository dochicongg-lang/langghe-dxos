# Lịch sử thay đổi

Theo khuôn dạng [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/) và [Semantic Versioning](https://semver.org/lang/vi/).
Số `#n` là pull request trên GitHub.

## [Chưa phát hành]

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

Bản đầu tiên dùng cho cuộc thi OLP Phần mềm nguồn mở 2026 (đề tài DX-OS Open-Core).

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
