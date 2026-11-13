# Kịch bản trình diễn "Làng Nghề Số" (6 phút, 3 câu chuyện)

Nguyên tắc: **3 câu chuyện, không phải 30 tính năng.** Kể **kiến trúc trước, nghiệp vụ sau**: lõi DX-OS dùng chung được cho nhiều nghiệp vụ; OCOP là nghiệp vụ minh họa vì phức tạp và có thật ngoài đời.

| # | Câu chuyện | Thời lượng | Điều ban giám khảo phải nhớ |
|---|---|---|---|
| 1 | Kiến trúc: lõi không giao diện, mọi thứ qua một cổng | 2 phút | Tầng 1 headless, cùng một API cho mọi giao diện, 401 so với 200 |
| 2 | Bảo mật: không tin ai theo mặc định, kể cả dữ liệu cảm biến | 2 phút | Zero-Trust, lỗ hổng MinIO đã phát hiện và chặn, nhật ký kiểm toán không sửa lén được |
| 3 | Nghiệp vụ: chị Hoa nộp hồ sơ OCOP, anh Tuấn duyệt, người mua quét QR | 2 phút | Quy trình thật trên Flowable, đường cong nhiệt độ thật đã đối chiếu, tách bạch "xác nhận của nền tảng" và "kết quả chính thức" |

---

## A. Chuẩn bị (làm trước giờ diễn 30 phút)

1. **Bật Docker Desktop**, mở Git Bash tại thư mục dự án.
2. Cài/nâng cấp và kiểm tra phân quyền thật (có chạy bộ kiểm tra, mất vài phút):
   ```bash
   bash scripts/upgrade.sh
   ```
3. Nạp dữ liệu mẫu (chạy lặp lại an toàn, cái gì có rồi thì bỏ qua):
   ```bash
   node scripts/seed-demo.js
   ```
   Sau bước này có sẵn: sản phẩm `GOM-BT-0001` (mẻ nung chuẩn + hồ sơ OCOP đã đủ quy trình, 4 sao minh họa), `GOM-BT-0002` (mẻ nung quá nhiệt), `GOM-BT-0003` (gia nhiệt quá nhanh). **Không** có sẵn hồ sơ để làm trực tiếp trên sân khấu.
4. Chạy giao diện:
   ```bash
   cd frontend && npm run dev
   ```
5. **Mở sẵn 3 cửa sổ trình duyệt riêng** (cửa sổ ẩn danh, mỗi người một cửa sổ để khỏi phải đăng xuất): `hoa` (nghệ nhân), `tuan` (cán bộ HTX) hoặc `tester` (xem ghi chú OTP), `ocop` (cán bộ đầu mối). Mật khẩu trùng tên đăng nhập. Đăng nhập sẵn cả ba.
6. **OTP của `tuan`** (cán bộ HTX bắt buộc OTP khi đăng nhập trình duyệt): lần đầu đăng nhập sẽ bị bắt cài. Bấm "Không quét được mã vạch?" lấy khóa chữ rồi tính mã 6 số bằng `node scripts/totp.js "<khóa>"` (mã đổi mỗi 30 giây). **Làm trước giờ diễn.** Nếu chưa kịp, dùng `tester` (quản trị) thay `tuan` ở bước sơ duyệt và nói rõ đó là thay thế.
7. Chuẩn bị 1–2 **ảnh sản phẩm** (JPG/PNG/WEBP, tối đa 5 MB) trên máy để tải lên lúc chị Hoa lập hồ sơ.
8. **Quét QR bằng điện thoại thật** (chưa được thử trên điện thoại thật, cần làm thử trước):
   - Máy chạy giao diện và điện thoại cùng mạng WiFi; mở tường lửa cho cổng 3000.
   - Tạo `frontend/.env.local` có dòng `NEXT_PUBLIC_PUBLIC_BASE_URL=http://<địa-chỉ-IP-LAN-của-máy>:3000`.
   - Chạy bản đóng gói thay cho `npm run dev` (bản dev có thể chặn tài nguyên từ địa chỉ lạ): `npm run build` rồi `npm run start -- -H 0.0.0.0`.
   - Trang công khai gọi API cùng nguồn (Next chuyển tiếp tới cổng gác), nên điện thoại chỉ cần vào được cổng 3000.
   - **Phương án dự phòng:** mở `http://localhost:3000/verify/GOM-BT-0001` ở một cửa sổ khác (thu nhỏ như khung điện thoại) và nói đó là màn hình người mua thấy.

**Kiểm tra nhanh trước khi lên sân khấu:**
```bash
docker compose ps                       # 7 dịch vụ đang chạy
node scripts/demo-zero-trust.js         # kỳ vọng: "Tất cả như mong đợi."
```

---

## B. Câu chuyện 1: Kiến trúc (2 phút)

**Lời mở:** "Chúng tôi không xây một ứng dụng OCOP. Chúng tôi xây một **lõi DX-OS** để bất kỳ làng nghề nào cũng chạy được nghiệp vụ của mình trên đó. Để chứng minh, chúng tôi chạy nghiệp vụ OCOP, vì nó phức tạp và có thật ngoài đời."

1. Chỉ **sơ đồ 3 tầng** (README hoặc slide). Tầng 1 gồm Keycloak (đăng nhập một lần), APISIX (cổng gác), Flowable (quy trình), PostgreSQL và MinIO (dữ liệu). **Tầng 1 không có giao diện**, chỉ có REST API.
2. Chạy `docker compose ps`: 7 dịch vụ; chỉ cổng gác (9080) và Keycloak (8080) mở ra mạng; cơ sở dữ liệu, console kho lưu trữ và Admin API của cổng gác chỉ nghe trên chính máy chủ; còn Flowable, API kho lưu trữ và `trace-api` **không mở cổng nào**, chỉ vào được qua cổng gác.
3. Chạy đầu `node scripts/demo-zero-trust.js` (mục 1–3): không có token thì **401**, có token của chị Hoa thì **200**, token giả mạo vẫn **401**.

**Câu chốt:** "Cùng một API phục vụ trình duyệt, điện thoại, hay hệ thống khác. Giao diện chỉ là một khách hàng của lõi."

---

## C. Câu chuyện 2: Bảo mật (2 phút)

**Lời mở:** "Chúng tôi tưởng khóa dữ liệu chống sửa (Object Lock) là đủ, cho đến khi tự kiểm tra và phát hiện điều này."

1. Chạy hết `node scripts/demo-zero-trust.js` (mỗi dòng có giải thích sẵn). Nhấn vào hai ý:
   - **Mục 8:** bản MinIO đang dùng cho **bất kỳ tài khoản nào** gỡ được khóa chống sửa chỉ bằng một tiêu đề đặc biệt, bất chấp chính sách phân quyền. Chúng tôi đã kiểm chứng và chặn ở cổng gác. Bài học: bật tính năng bảo mật chưa đủ, phải thử tấn công thật.
   - **Mục 5:** cổng gác từng gắn quyền admin của Flowable cho mọi yêu cầu, nên người chỉ-xem xóa được cả quy trình. Đã vá, đã kiểm chứng.
2. Cuối kết quả của script là **dấu vết**: chính các lần thử vừa rồi đã nằm trong **nhật ký kiểm toán**. Mở trang **Data** bằng tài khoản `tester`, thẻ "Nhật ký kiểm toán", bấm **"Kiểm tra toàn vẹn chuỗi băm"**: mỗi dòng nối băm với dòng trước, nên sửa hay xóa lén đều bị phát hiện.
3. (Nếu còn thời gian) nói thêm: số liệu cảm biến lò nằm trong kho có Object Lock; máy chủ **tự đọc và đối chiếu** chứ không tin con số trình duyệt gửi lên.

**Câu chốt:** "Zero-Trust của chúng tôi đi xa hơn JWT: ngay cả số liệu thiết bị gửi lên cũng bị máy chủ đối chiếu lại với bản gốc."

---

## D. Câu chuyện 3: Nghiệp vụ (2 phút)

**Lời mở:** "Chị Hoa là nghệ nhân gốm Bát Tràng, muốn đăng ký OCOP cho bình gốm của mình. Chúng tôi **không cấp giấy OCOP**, vì người quyết định thật là Hội đồng OCOP của thành phố. Hệ thống giúp chị chuẩn bị hồ sơ đúng và theo dõi tiến độ."

1. **Cửa sổ `hoa`:** mục **Hồ sơ OCOP**, lập hồ sơ mới: nhập tên sản phẩm, chọn nhóm "Hàng thủ công mỹ nghệ", tự chấm A/B/C (ví dụ 30/20/25), giao diện hiện **hạng sao dự kiến**; tick giấy tờ; tạo hồ sơ nháp. Mở hồ sơ, **tải ảnh sản phẩm** lên mục "Ảnh sản phẩm và bao bì" (hình thu nhỏ hiện ngay). Để trống ô "mã truy xuất liên quan" ở bước này (xem ghi chú cuối mục). Bấm **Nộp hồ sơ**. Trạng thái thành "Chờ HTX sơ duyệt", và trang hồ sơ cho thấy **Flowable đang ở bước "HTX sơ duyệt"**.
2. **Cửa sổ `tuan` (hoặc `tester`):** trang tổng quan có mục **"Việc của bạn"** hiện hồ sơ chờ duyệt; mở hồ sơ, xem ảnh, bấm **"Sơ duyệt: Đạt"**. (Muốn nhấn mạnh quy trình: thử "Yêu cầu bổ sung" kèm lý do, chị Hoa nhận lại và nộp lại.)
3. **Cửa sổ `ocop`:** hồ sơ đã sơ duyệt đạt hiện ở "Việc của bạn". Nhập **điểm chính thức, số quyết định, ngày quyết định** (đóng vai cán bộ ghi lại quyết định của Hội đồng). Hệ thống tự suy ra **hạng sao** và **ngày hết hiệu lực (36 tháng)** theo cấu hình của địa phương. Hồ sơ chuyển "Đã được công nhận".
4. **Quét QR:** mở sản phẩm `GOM-BT-0001` ở mục Truy xuất nguồn gốc (có mã QR), quét bằng điện thoại. Người mua thấy:
   - **Kết quả OCOP chính thức** (hạng sao, cơ quan, số quyết định, còn hiệu lực đến ngày nào) và, **tách riêng**, **Xác nhận của nền tảng** (ghi rõ "chưa phải giấy chứng nhận OCOP");
   - **Hành trình sản phẩm** với **đường cong nhiệt độ lò thật**, dấu "máy chủ đã đối chiếu với dữ liệu cảm biến" và **kết luận phân tích tự động** ("Đạt chuẩn nung").
5. **Điểm nhấn trí tuệ [I] (30 giây):** mở trang **Intelligence** (tài khoản `tester`): ba mẻ nung ở ba mức (đạt, cần xem lại, cảnh báo quá nhiệt), mỗi mẻ kèm lý do bằng tiếng Việt.

**Câu chốt:** "Người mua biết nghệ nhân, biết quy trình, thấy nhiệt độ lò **thật**, và biết rõ đâu là xác nhận của nền tảng, đâu là kết quả chính thức của cơ quan có thẩm quyền."

> **Ghi chú:** hồ sơ làm trực tiếp trên sân khấu không gắn mã truy xuất nên **không** hiện ở trang công khai; trang đích của câu chuyện là `GOM-BT-0001` đã có sẵn (hồ sơ và mẻ nung nạp từ bước chuẩn bị). Nói rõ điều này nếu bị hỏi.

---

## E. Nếu có sự cố trên sân khấu

| Triệu chứng | Cách xử lý |
|---|---|
| Đăng nhập báo lỗi hoặc treo | `docker compose ps`; Keycloak cần ~1 phút sau khi bật. Chạy lại `bash scripts/upgrade.sh --skip-check` |
| `tuan` đòi OTP nhưng chưa cài | Dùng `tester` thay `tuan` và nói rõ |
| Thiếu dữ liệu mẫu | `node scripts/seed-demo.js` (an toàn chạy lại) |
| Điện thoại không mở được QR | Dùng phương án dự phòng: mở `/verify/GOM-BT-0001` ở cửa sổ khác |
| Cảnh báo "Phiên đăng nhập đã hết hạn" | Bấm "Đăng nhập lại" |
| Lệnh `check-*` hoặc `demo-*` lỗi | Chạy `bash scripts/upgrade.sh`; đảm bảo `.env` có đủ khóa (script tự bổ sung khóa thiếu) |

---

## F. Dọn dẹp sau buổi diễn

- **Hồ sơ OCOP làm trên sân khấu:** không cần dọn nếu muốn giữ; nếu cần xóa, dùng SQL trong PostgreSQL (bảng `ocop_applications`, `ocop_application_history`, `application_attachments`, `ocop_results`).
- **OTP của `tuan`:** nếu muốn trả về trạng thái ban đầu thì xóa thông tin xác thực OTP của người dùng này trong Keycloak.
- **Số liệu cảm biến mẫu** nằm trong bucket có Object Lock (chế độ Governance, giữ lâu); chỉ quản trị MinIO xóa được bằng đặc quyền bypass, ví dụ (ngày tính theo hôm nạp dữ liệu, mốc lùi 40/41/42 ngày):
  ```bash
  set -a; . ./.env; set +a
  for N in 40 41 42; do D=$(node -e "const d=new Date();d.setUTCDate(d.getUTCDate()-$N);console.log(d.toISOString().slice(0,10))")
    docker exec dxos-minio sh -c "mc alias set r http://localhost:9000 '$MINIO_ROOT_USER' '$MINIO_ROOT_PASSWORD' >/dev/null && mc rm --recursive --versions --force --bypass r/dxos-iot/iot/service-account-dxos-iot/$D/"
  done
  ```
  (Nếu đã đổi sang chế độ COMPLIANCE thì **không** xóa được trước khi hết hạn: đó chính là mục đích của chế độ này.)
- **Nhật ký kiểm toán** chỉ ghi thêm, không xóa được và đó là chủ đích.

---

## G. Câu hỏi phản biện thường gặp và cách trả lời trung thực

1. **"Workflow của em đâu? 6 quy trình mẫu của Flowable không phải của em."**
   Quy trình `dxos-ocop-support` do nhóm viết (BPMN trong `workflows/`), nạp vào Flowable tự động; trình duyệt không gọi Flowable trực tiếp mà đi qua lớp API trung gian có kiểm quyền. Có kiểm tra thật cả các nhánh: đạt, cần bổ sung rồi nộp lại, không đạt.
2. **"Em dẫn quy định OCOP của Hà Nội, có đọc văn bản gốc chưa?"**
   Chưa. Số liệu lấy từ báo chí và cổng thông tin, nên cấu hình `ocop-profiles.json` đánh dấu `verified: false` và giao diện hiển thị cảnh báo. Điểm thiết kế là mọi ngưỡng nằm trong cấu hình theo địa phương, đối chiếu văn bản gốc xong chỉ việc sửa tệp.
3. **"[I] (trí tuệ) của em là gì? Có AI không?"**
   Là bộ **luật có thể giải thích** trên số liệu đã đối chiếu (đỉnh nhiệt, thời gian giữ, tốc độ gia nhiệt/làm nguội, so với mẻ khác, độ tin cậy dữ liệu), không phải học máy. Lý do: dữ liệu còn ít, cần giải thích được từng kết luận cho thợ gốm, và an toàn hơn. Ngưỡng hiện là số liệu minh họa, cần chuyên gia xác nhận. Hướng sau: phát hiện bất thường thống kê khi có đủ dữ liệu.
4. **"Vòng đời dữ liệu?"**
   Lịch sử hồ sơ đã kết thúc và quá hạn giữ được tự động chuyển từ PostgreSQL sang MinIO (nén, có băm, đọc lại được để phân tích), có kiểm tra đọc lại trước khi xóa ở tầng nóng. Mới áp dụng cho một nguồn dữ liệu.
5. **"GitOps và hạ tầng như mã?"**
   Hạ tầng khai báo bằng `docker-compose.yml`, cấu hình quyền sinh từ `config/access.json`, cài đặt một lệnh, nhưng **chưa có quy trình GitOps/CI** đầy đủ. Đây là hướng phát triển.
6. **"Cảm biến là giả lập?"**
   Có, đang dùng trình giả lập đi qua đúng đường của thiết bị thật (tài khoản dịch vụ riêng, ghi vào thư mục riêng của từng gateway). Hạn chế đã biết: ai giữ khóa của chính gateway đó vẫn ghi được số liệu trông hợp lý; hướng khắc phục là ký số từng lô.
7. **"Hệ thống có tự cấp giấy OCOP không?"**
   Không, và cố ý tách bạch: "xác nhận của nền tảng" khác với "kết quả OCOP chính thức do cơ quan có thẩm quyền quyết định". Trang công khai hiển thị hai khối riêng.
8. **"Dùng cho làng nghề khác được không?"**
   Được ở mức cấu hình: quyền (`access.json`), quy tắc OCOP theo địa phương (`ocop-profiles.json`), hồ sơ nung (`kiln-profiles.json`), danh bạ thiết bị. Nghiệp vụ khác (đào tạo nghề, du lịch làng nghề) cần thêm quy trình và API, nhưng lõi giữ nguyên.
9. **"Mật khẩu mặc định, tài khoản thử?"**
   Chỉ là môi trường phát triển. Danh sách việc phải làm trước khi triển khai thật (đổi mật khẩu, xóa tài khoản thử, chế độ khóa COMPLIANCE, HTTPS, thu hẹp địa chỉ chuyển hướng) đã ghi trong tài liệu.
10. **"Chuỗi băm của nhật ký chống được gì? Có bị qua mặt không?"**
    Phát hiện được sửa nội dung, xóa giữa chuỗi, chèn dòng. **Chưa** phát hiện được việc cắt bớt các dòng cuối chuỗi, hoặc kẻ có quyền siêu người dùng cơ sở dữ liệu tính lại cả chuỗi, vì băm đầu chuỗi chưa được neo ra ngoài (hướng sau: ghi băm định kỳ vào kho có Object Lock hoặc ký số).
11. **"Kiểm thử thế nào?"**
    122 test đơn vị và 4 bộ kiểm tra chạy thật qua cổng gác, Keycloak, Flowable, MinIO (phân quyền, quy trình OCOP, phân tích mẻ nung, nhật ký kiểm toán), đều có đối chứng dương để chứng minh phép thử bắt được lỗi.
12. **"Giấy phép nguồn mở?"**
    Toàn bộ thành phần nền là mã nguồn mở. Kho mã của dự án **chưa có tệp giấy phép**: cần chọn một giấy phép nguồn mở trước khi công bố chính thức.
