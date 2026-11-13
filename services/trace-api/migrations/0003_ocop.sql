-- SPDX-License-Identifier: Apache-2.0
-- Copyright 2026 The Làng Nghề Số contributors
-- G2: hồ sơ OCOP, lịch sử xử lý (chỉ ghi thêm) và kết quả chính thức. Chỉ THÊM bảng.

CREATE TABLE IF NOT EXISTS ocop_applications (
  id                SERIAL PRIMARY KEY,
  code              TEXT NOT NULL UNIQUE,                 -- mã hồ sơ, ví dụ OCOP-20261113-AB12
  profile           TEXT NOT NULL,                        -- mã profile cấu hình (config/ocop-profiles.json)
  product_code      TEXT,                                 -- sản phẩm truy xuất liên quan (tùy chọn)
  product_name      TEXT NOT NULL,
  product_group     TEXT NOT NULL,                        -- nhóm sản phẩm theo profile
  description       TEXT NOT NULL DEFAULT '',
  owner_username    TEXT NOT NULL,                        -- người nộp
  coop_id           INTEGER REFERENCES cooperatives(id),
  state             TEXT NOT NULL DEFAULT 'draft'
                      CHECK (state IN ('draft','in_review','needs_revision','awaiting_result','rejected','recognized','not_recognized')),
  self_score        JSONB,                                -- { A, B, C } tự chấm của người nộp (DỰ KIẾN)
  documents         JSONB NOT NULL DEFAULT '[]'::jsonb,   -- danh sách khóa giấy tờ đã có
  flowable_instance TEXT,                                 -- id tiến trình trong Flowable
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ocop_app_coop ON ocop_applications(coop_id);
CREATE INDEX IF NOT EXISTS idx_ocop_app_owner ON ocop_applications(owner_username);

-- Lịch sử mọi thao tác trên hồ sơ (chỉ ghi thêm, không sửa/xóa).
CREATE TABLE IF NOT EXISTS ocop_application_history (
  id             SERIAL PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES ocop_applications(id),
  action         TEXT NOT NULL,
  from_state     TEXT,
  to_state       TEXT NOT NULL,
  actor          TEXT NOT NULL,
  note           TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Kết quả OCOP chính thức do cơ quan có thẩm quyền ra (chỉ ghi thêm). Khác với "xác nhận của nền tảng".
CREATE TABLE IF NOT EXISTS ocop_results (
  id              SERIAL PRIMARY KEY,
  application_id  INTEGER NOT NULL REFERENCES ocop_applications(id),
  score           NUMERIC(5,2) NOT NULL,
  stars           INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  authority       TEXT NOT NULL,                          -- cơ quan ra quyết định
  decision_no     TEXT NOT NULL,                          -- số quyết định
  decided_at      DATE NOT NULL,
  valid_until     DATE,                                   -- hết hiệu lực (theo validityMonths của profile); NULL nếu không công nhận
  recognized      BOOLEAN NOT NULL,
  recorded_by     TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ocop_results_app ON ocop_results(application_id);
