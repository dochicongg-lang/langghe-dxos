-- SPDX-License-Identifier: Apache-2.0
-- Copyright 2026 The Làng Nghề Số contributors
-- Ghi lại tệp đính kèm đã được quét mã độc bằng công cụ nào và lúc nào. Chỉ THÊM cột nullable (tệp cũ chưa quét thì để trống).

ALTER TABLE application_attachments ADD COLUMN IF NOT EXISTS scan_engine TEXT;
ALTER TABLE application_attachments ADD COLUMN IF NOT EXISTS scanned_at TIMESTAMPTZ;
