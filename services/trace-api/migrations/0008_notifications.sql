-- SPDX-License-Identifier: Apache-2.0
-- Copyright 2026 The Làng Nghề Số contributors
-- Thông báo trong ứng dụng (nhắc hạn xử lý hồ sơ, leo thang khi quá hạn, nhắc gia hạn kết quả OCOP, đề xuất của tác tử chờ duyệt).
-- Thông báo gửi tới một người cụ thể (for_user) hoặc tới một vai trò, tùy chọn giới hạn trong một HTX (for_role + for_coop).
-- dedupe_key duy nhất: mỗi sự việc chỉ thông báo một lần dù quét lại nhiều lần. Trạng thái đã đọc theo từng người (notification_reads),
-- vì thông báo gửi cho vai trò dùng chung cho nhiều người. Chỉ THÊM bảng.

CREATE TABLE IF NOT EXISTS notifications (
  id         BIGSERIAL PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  kind       TEXT NOT NULL,
  level      TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warn', 'alert')),
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  link       TEXT,
  for_user   TEXT,
  for_role   TEXT,
  for_coop   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (for_user IS NOT NULL OR for_role IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(for_user) WHERE for_user IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_role ON notifications(for_role) WHERE for_role IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);

CREATE TABLE IF NOT EXISTS notification_reads (
  notification_id BIGINT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  username        TEXT NOT NULL,
  read_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, username)
);
