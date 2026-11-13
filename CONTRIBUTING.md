# Đóng góp cho Làng Nghề Số

Cảm ơn bạn quan tâm đến dự án. Dự án phát hành theo [Apache-2.0](LICENSE); khi gửi đóng góp, bạn đồng ý đóng góp của mình được phát hành theo cùng giấy phép.

## Báo lỗi và đề xuất
- **Lỗi:** mở một [issue](../../issues/new?template=bug_report.md), mô tả cách tái hiện, kết quả mong đợi và thực tế, phiên bản (xem `CHANGELOG.md`).
- **Đề xuất:** mở issue theo mẫu "Đề xuất tính năng".
- **Lỗ hổng bảo mật:** không đăng công khai chi tiết khai thác; mở issue chỉ nêu rằng bạn có báo cáo bảo mật để nhóm liên hệ riêng.
- Các giới hạn đã biết của dự án được theo dõi bằng issue gắn nhãn `known-limitation`.

## Chạy dự án để phát triển
Xem mục "Chạy nhanh" và "Build từ mã nguồn" trong [README.md](README.md). Tóm tắt:
```bash
bash scripts/upgrade.sh         # hạ tầng Docker + cấu hình
cd frontend && npm ci && npm run dev
```

## Trước khi gửi pull request
Chạy các kiểm tra sau (CI chạy lại các bước 1–4 trên mỗi push và pull request):
```bash
node scripts/add-license-headers.js --check         # 1. mọi tệp mã có dòng giấy phép (thiếu thì bỏ --check để tự thêm)
cd services/trace-api && npm test                   # 2. test đơn vị
cd frontend && npx tsc --noEmit && npx eslint src   # 3. kiểu và lint
bash scripts/tests/test-env-sync.sh                 # 4. script tạo .env
bash scripts/check-iot-permissions.sh               # 5. phân quyền thật (cần hệ thống đang chạy)
node scripts/check-ocop-flow.js                     # 6. quy trình OCOP thật
```
Việc đụng tới phân quyền, cổng gác hay dữ liệu cần thêm kiểm tra chạy thật **có đối chứng dương** (chứng minh phép thử bắt được lỗi) vào các script `scripts/check-*`.

## Quy ước
- Tệp mã mới phải có dòng `SPDX-License-Identifier: Apache-2.0` ở đầu (chạy `node scripts/add-license-headers.js`).
- Quyền truy cập được khai báo ở **một nơi**: `config/access.json`; không ghi cứng tên vai trò ở nơi khác.
- Không commit `.env`, `node_modules`, khóa hay mật khẩu thật. Tầng 1 không có giao diện: mọi giao diện nằm ở `frontend/`.
- Mỗi thay đổi đáng chú ý ghi vào `CHANGELOG.md`, mục "Chưa phát hành".
