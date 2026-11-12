-- Mô hình miền: HTX, làng nghề, chủ thể sản xuất, cơ sở; và quyền sở hữu sản phẩm.
-- Chỉ THÊM bảng/cột (cột mới đều cho phép NULL); không đổi nghĩa bảng hiện có. Hai cột văn bản cũ
-- products.village và products.artisan được giữ làm tên hiển thị.

CREATE TABLE IF NOT EXISTS cooperatives (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS villages (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  -- công nhận làng nghề (Nghị định 52/2018/NĐ-CP): loại, số quyết định, ngày, trạng thái
  recognition  JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS producers (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,            -- preferred_username trong Keycloak
  display_name  TEXT NOT NULL DEFAULT '',
  type          TEXT NOT NULL DEFAULT 'nghe-nhan' CHECK (type IN ('ho', 'doanh-nghiep', 'htx', 'nghe-nhan')),
  coop_id       INTEGER REFERENCES cooperatives(id),
  village_id    INTEGER REFERENCES villages(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS facilities (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  coop_id     INTEGER REFERENCES cooperatives(id),
  village_id  INTEGER REFERENCES villages(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE products ADD COLUMN IF NOT EXISTS owner_username TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS coop_id INTEGER REFERENCES cooperatives(id);
ALTER TABLE products ADD COLUMN IF NOT EXISTS village_id INTEGER REFERENCES villages(id);
ALTER TABLE products ADD COLUMN IF NOT EXISTS facility_id INTEGER REFERENCES facilities(id);

CREATE INDEX IF NOT EXISTS idx_products_coop ON products(coop_id);
CREATE INDEX IF NOT EXISTS idx_products_owner ON products(owner_username);
