-- Vòng đời dữ liệu: sổ các lần lưu trữ từ tầng nóng (PostgreSQL) sang tầng lạnh (MinIO, tiền tố archive/).
-- Mỗi dòng trỏ tới một đối tượng NDJSON nén gzip kèm băm SHA-256 để kiểm tra toàn vẹn khi đọc lại. Chỉ THÊM bảng.

CREATE TABLE IF NOT EXISTS archive_runs (
  id           SERIAL PRIMARY KEY,
  source_table TEXT NOT NULL,
  cutoff       TIMESTAMPTZ NOT NULL,              -- chỉ lưu trữ bản ghi cũ hơn mốc này
  row_count    INTEGER NOT NULL CHECK (row_count > 0),
  object_key   TEXT NOT NULL,
  sha256       TEXT NOT NULL,
  size         INTEGER NOT NULL,
  triggered_by TEXT NOT NULL,                     -- scheduler hoặc tên quản trị viên
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
