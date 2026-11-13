-- G2.4: tệp đính kèm hồ sơ OCOP (ảnh sản phẩm, giấy tờ). Nội dung nằm ở MinIO (bucket tệp, khóa object_key);
-- bảng này giữ siêu dữ liệu và băm SHA-256 để kiểm tra toàn vẹn khi tải xuống. Gỡ tệp chỉ đánh dấu removed_at
-- (đối tượng trong MinIO được giữ làm bằng chứng). Chỉ THÊM bảng.

CREATE TABLE IF NOT EXISTS application_attachments (
  id             SERIAL PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES ocop_applications(id),
  doc_key        TEXT NOT NULL,                 -- khóa giấy tờ trong danh mục của profile (ví dụ anh-san-pham)
  filename       TEXT NOT NULL,                 -- tên đã làm sạch
  content_type   TEXT NOT NULL,                 -- loại THẬT theo chữ ký nội dung
  size           INTEGER NOT NULL CHECK (size > 0),
  sha256         TEXT NOT NULL,
  object_key     TEXT NOT NULL,
  uploaded_by    TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at     TIMESTAMPTZ,
  removed_by     TEXT
);

CREATE INDEX IF NOT EXISTS idx_app_att_app ON application_attachments(application_id) WHERE removed_at IS NULL;
