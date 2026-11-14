-- SPDX-License-Identifier: Apache-2.0
-- Copyright 2026 The Làng Nghề Số contributors
-- Sổ truy vết hồ dữ liệu phân tích: mỗi lần xuất một bộ dữ liệu sang Parquet (trong MinIO, tiền tố lake/) ghi một dòng, gồm bộ dữ liệu,
-- số dòng, các cột, khóa đối tượng, băm SHA-256 và NGUỒN đầu vào (lineage: bảng nào, tệp lưu trữ nào kèm băm). Chỉ ghi thêm. Chỉ THÊM bảng.

CREATE TABLE IF NOT EXISTS lake_runs (
  id           SERIAL PRIMARY KEY,
  dataset      TEXT NOT NULL,
  rows         INTEGER NOT NULL,
  object_key   TEXT NOT NULL,
  sha256       TEXT NOT NULL,
  size         BIGINT NOT NULL,
  columns      JSONB NOT NULL,
  lineage      JSONB NOT NULL,
  triggered_by TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lake_runs_dataset ON lake_runs(dataset, id DESC);
