-- SPDX-License-Identifier: Apache-2.0
-- Copyright 2026 The Làng Nghề Số contributors
-- Đề xuất của tác tử theo sự kiện (ví dụ mẻ nung bị cảnh báo): tác tử CHỈ đề xuất, một người có thẩm quyền phải duyệt thì hành động mới được thực hiện
-- (human-in-the-loop). Mỗi đề xuất nêu lý do kèm bằng chứng; dedupe_key duy nhất để cùng một sự kiện chỉ có một đề xuất. Chỉ THÊM bảng.

CREATE TABLE IF NOT EXISTS agent_proposals (
  id            SERIAL PRIMARY KEY,
  dedupe_key    TEXT NOT NULL UNIQUE,
  kind          TEXT NOT NULL,
  severity      TEXT NOT NULL CHECK (severity IN ('warn', 'alert')),
  title         TEXT NOT NULL,
  rationale     TEXT NOT NULL,
  subject       TEXT NOT NULL,          -- đối tượng liên quan (mã sản phẩm)
  coop          TEXT,                   -- mã HTX của đối tượng (để phân quyền người duyệt); NULL nếu chưa gắn HTX
  action        JSONB NOT NULL,         -- hành động sẽ làm khi được duyệt
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by    TEXT,
  decided_at    TIMESTAMPTZ,
  decision_note TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_agent_proposals_status ON agent_proposals(status, id DESC);
