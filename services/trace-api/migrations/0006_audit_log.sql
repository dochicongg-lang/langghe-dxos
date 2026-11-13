-- SPDX-License-Identifier: Apache-2.0
-- Copyright 2026 The Làng Nghề Số contributors
-- Nhật ký kiểm toán hành vi API (ai gọi gì, khi nào, kết quả ra sao): CHỈ GHI THÊM.
-- Bất biến ở hai lớp: (1) trigger từ chối UPDATE/DELETE/TRUNCATE; (2) chuỗi băm SHA-256 nối các dòng
-- (hash = SHA-256(prev_hash + nội dung dòng)) nên mọi sửa/xóa lén, kể cả khi tắt trigger bằng quyền cao, đều bị phát hiện
-- khi kiểm tra chuỗi. KHÔNG lưu token hay mật khẩu. Chỉ THÊM bảng.

CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  ts          TIMESTAMPTZ NOT NULL,              -- thời điểm cổng gác nhận yêu cầu
  actor       TEXT,                              -- tên đăng nhập (preferred_username) hoặc NULL nếu ẩn danh
  roles       TEXT NOT NULL DEFAULT '',          -- vai trò theo token, nối bằng dấu phẩy
  verified    BOOLEAN NOT NULL DEFAULT FALSE,    -- TRUE khi yêu cầu thành công (token đã được xác thực); yêu cầu bị từ chối thì danh tính chỉ là tự khai
  ip          TEXT NOT NULL DEFAULT '',
  method      TEXT NOT NULL,
  path        TEXT NOT NULL,
  status      INTEGER NOT NULL,
  route       TEXT NOT NULL DEFAULT '',
  latency_ms  INTEGER NOT NULL DEFAULT 0,
  prev_hash   TEXT NOT NULL,
  hash        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor);

CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log chỉ được ghi thêm (không sửa, không xóa)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_no_change ON audit_log;
CREATE TRIGGER audit_log_no_change BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

DROP TRIGGER IF EXISTS audit_log_no_truncate ON audit_log;
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();
