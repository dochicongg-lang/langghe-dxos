# Dàn ý slide "Làng Nghề Số" (đề xuất 12 slide, khoảng 10–12 phút kể cả demo)

Nguyên tắc: **3 câu chuyện**, không liệt kê 30 tính năng. Mỗi slide một ý chính, chữ ít, lời nói mang phần giải thích. Kể **kiến trúc trước, nghiệp vụ sau**. Chỗ có `[DEMO]` là lúc chuyển sang chạy thật (xem [TRINH-DIEN.md](TRINH-DIEN.md)).

| # | Tiêu đề slide | Nội dung trên slide | Ý chính khi nói |
|---|---|---|---|
| 1 | **Làng Nghề Số** | Tên dự án, logo, đội | Mô hình thực hành số cho làng nghề, theo khung DX-OS, hoàn toàn mã nguồn mở |
| 2 | **Vấn đề thật** | 3 dòng: nghệ nhân/HTX khó hiểu tiêu chí OCOP; người mua khó kiểm chứng nguồn gốc; số liệu sản xuất rời rạc, dễ bị nghi ngờ | Nút thắt là **niềm tin và hồ sơ**, không phải thiếu công nghệ |
| 3 | **Ranh giới chúng tôi giữ** | "Hội đồng OCOP của thành phố là nơi quyết định. Hệ thống **hỗ trợ và theo dõi**, không cấp giấy." | Đây là ranh giới pháp lý: tách "xác nhận của nền tảng" và "kết quả chính thức". Hầu hết giải pháp bỏ qua điều này |
| 4 | **Kiến trúc DX-OS 3 tầng** | Sơ đồ: Tầng 1 (Keycloak, APISIX, Flowable, PostgreSQL, MinIO) / Tầng 2 H-P-D-I / Tầng 3 nghiệp vụ truy xuất + OCOP | Lõi dùng chung, nghiệp vụ là tầng trên cùng. Làng nghề khác chạy nghiệp vụ khác mà không sửa lõi |
| 5 | **Câu chuyện 1: Tầng 1 không có giao diện** | Một dòng: "Mọi thứ đi qua MỘT cổng" + kết quả 401 / 200 | **[DEMO]** `docker compose ps`, `node scripts/demo-zero-trust.js` (mục 1–3) |
| 6 | **Câu chuyện 2: Zero-Trust** | 4 ý: JWT xác thực ở cổng; phân quyền theo vai trò từ một tệp; máy chủ tự đối chiếu số liệu cảm biến; nhật ký kiểm toán chuỗi băm | Zero-Trust đi xa hơn JWT: ngay cả dữ liệu thiết bị gửi lên cũng bị đối chiếu lại |
| 7 | **Bài học bảo mật** | "Tưởng Object Lock là đủ" → phát hiện MinIO cho mọi tài khoản gỡ khóa bằng một tiêu đề → chặn ở cổng gác | Kể như một câu chuyện. **[DEMO]** mục 5 và 8 của `demo-zero-trust.js`, nhật ký kiểm toán, nút kiểm tra toàn vẹn |
| 8 | **Vòng đời dữ liệu** | Nóng (PostgreSQL) → lạnh (MinIO, nén, có băm) + bất biến (Object Lock cho cảm biến) | Lõi không nghẽn nhưng dữ liệu lịch sử vẫn đọc lại và phân tích được. Nói rõ mới áp dụng cho một nguồn |
| 9 | **Câu chuyện 3: Chị Hoa nộp hồ sơ OCOP** | Sơ đồ quy trình: nộp → HTX sơ duyệt → (bổ sung) → cơ quan có thẩm quyền ghi kết quả | **[DEMO]** hoa nộp → tuan duyệt → ocop ghi kết quả (Flowable chạy thật) |
| 10 | **Người mua quét QR** | Ảnh chụp trang công khai: đường cong nhiệt độ thật, kết luận tự động, hai khối OCOP tách bạch | **[DEMO]** quét QR `GOM-BT-0001`. Nhấn mạnh: "đã đối chiếu", "chưa phải giấy chứng nhận" |
| 11 | **[I] Trí tuệ có giải thích được** | Bộ luật phân tích đường cong nung: đạt / cần xem lại / cảnh báo, kèm lý do | **[DEMO]** trang Intelligence. Trung thực: là luật, không phải học máy; ngưỡng minh họa, chờ chuyên gia xác nhận |
| 12 | **Giới hạn và hướng phát triển** | Đã làm / chưa làm (3 cột ngắn) + kiểm thử: 122 test + 4 bộ kiểm tra chạy thật | Nói thẳng giới hạn (xem dưới). Hướng sau: đối chiếu văn bản OCOP gốc, ký số lô cảm biến, GitOps/CI, thông báo, GS1 |

## Nội dung slide 12 (gợi ý)

**Đã làm:** lõi 5 thành phần mã nguồn mở; quy trình OCOP trên Flowable + tệp đính kèm; truy xuất có QR và bằng chứng nhiệt độ đã đối chiếu; phân quyền theo HTX; vòng đời dữ liệu nóng-lạnh; phân tích đường cong nung; nhật ký kiểm toán; cài đặt một lệnh.

**Chưa làm / cần làm tiếp (nói thẳng):**
- Đối chiếu quy định OCOP với **văn bản gốc** (hiện là số liệu minh họa, đánh dấu `verified: false`).
- Ngưỡng nung do **chuyên gia xác nhận**; cảm biến thật thay trình giả lập.
- GitOps/CI, thông báo email, liên kết tem/mã GS1, giấy phép nguồn mở cho kho mã.
- Neo băm đầu chuỗi nhật ký ra ngoài để chống cắt bớt dòng cuối.

## Gợi ý trình bày
- **Đừng khoe hết:** không đưa sơ đồ 30 bảng hay bảng xung đột vào slide; chúng là tài liệu nội bộ.
- **Mục nghiên cứu quy định thật (OCOP, truy xuất quốc gia)** chỉ cần 3 dòng: Hội đồng tỉnh là nơi duyệt thật; giấy chứng nhận có hiệu lực 36 tháng; QR cần liên kết GS1. Nguồn chưa đối chiếu văn bản gốc nên **không khẳng định chi tiết** trên slide.
- Mỗi demo **có phương án dự phòng** (xem mục E của TRINH-DIEN.md). Nếu hỏng, kể bằng ảnh chụp màn hình đã chuẩn bị sẵn.
- **Chuẩn bị ảnh chụp màn hình dự phòng** cho slide 5, 7, 9, 10, 11 ngay sau khi chạy thử thành công.
- Chuẩn bị trả lời 12 câu phản biện ở mục G của [TRINH-DIEN.md](TRINH-DIEN.md).
