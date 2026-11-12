-- Nền: các bảng đã có từ trước khi có cơ chế migration. Dùng IF NOT EXISTS nên chạy an toàn trên CSDL cũ.
CREATE TABLE IF NOT EXISTS products (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT '',
  village     TEXT NOT NULL DEFAULT '',
  artisan     TEXT NOT NULL DEFAULT '',
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trace_events (
  id          SERIAL PRIMARY KEY,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  stage       TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  location    TEXT NOT NULL DEFAULT '',
  actor       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_product ON trace_events(product_id, created_at);
ALTER TABLE trace_events ADD COLUMN IF NOT EXISTS iot JSONB;
