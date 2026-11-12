"use strict";
/**
 * trace-api — API truy xuất nguồn gốc sản phẩm làng nghề (Tầng 3 của DX-OS).
 *
 * - Chỉ giao tiếp qua REST/JSON, không có giao diện.
 * - KHÔNG mở cổng ra máy chủ: chỉ truy cập qua API Gateway (APISIX). Gateway đã xác thực chữ ký JWT
 *   của Keycloak; dịch vụ này chỉ đọc nội dung token (tên người dùng, role) để phân quyền và ghi nhật ký.
 * - Dữ liệu lưu ở PostgreSQL (database riêng "traceability", tự tạo khi khởi động).
 *
 * Tuyến (APISIX bỏ tiền tố /api/trace hoặc /api/public/trace):
 *   GET  /products                  danh sách sản phẩm            (đăng nhập)
 *   POST /products                  tạo sản phẩm                  (role readwrite)
 *   GET  /products/:code            chi tiết + dòng thời gian     (đăng nhập)
 *   POST /products/:code/events     thêm công đoạn                (role readwrite; công đoạn nung có thể kèm "iot")
 *   GET  /public/:code              tra cứu công khai cho người mua (không cần đăng nhập, ẩn thông tin nội bộ)
 *   GET  /healthz                   kiểm tra sống
 */

const http = require("node:http");
const { Pool, Client } = require("pg");

const PORT = Number(process.env.PORT ?? 3000);
const pgBase = {
  host: process.env.PG_HOST ?? "postgres",
  port: Number(process.env.PG_PORT ?? 5432),
  user: process.env.PG_USER ?? "postgres",
  password: process.env.PG_PASSWORD ?? "postgres",
};
const DB_NAME = process.env.TRACE_DB ?? "traceability";
const SEED = (process.env.TRACE_SEED ?? "true") !== "false";

// Thứ tự các công đoạn của chuỗi sản xuất gốm/thủ công.
const STAGES = ["nguyen-lieu", "so-che", "tao-hinh", "nung-hoan-thien", "kiem-dinh", "dong-goi", "phan-phoi"];
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9-]{2,39}$/;

let pool;

// ---------- Khởi tạo cơ sở dữ liệu ----------
async function ensureDatabase() {
  const admin = new Client({ ...pgBase, database: "postgres" });
  await admin.connect();
  try {
    const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [DB_NAME]);
    if (!rowCount) await admin.query(`CREATE DATABASE "${DB_NAME.replace(/"/g, "")}"`);
  } finally {
    await admin.end();
  }
}

async function migrate() {
  await pool.query(`
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
  `);
}

async function seed() {
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM products");
  if (rows[0].n > 0) return;
  const demo = [
    {
      code: "GOM-BT-0001",
      name: "Bình gốm men rạn Bát Tràng",
      category: "Gốm sứ",
      village: "Làng gốm Bát Tràng, Hà Nội",
      artisan: "Nghệ nhân Nguyễn Văn Hà",
      events: [
        ["nguyen-lieu", "Đất sét trắng khai thác tại Yên Bái, đã kiểm tra độ dẻo", "Kho đất sét Bát Tràng"],
        ["so-che", "Lọc, ủ đất 30 ngày", "Xưởng sơ chế"],
        ["tao-hinh", "Vuốt tay trên bàn xoay, cao 38 cm", "Xưởng tạo hình"],
        ["nung-hoan-thien", "Nung 1.150 °C trong 14 giờ, phủ men rạn", "Lò nung số 1"],
        ["kiem-dinh", "Đạt chuẩn: không nứt, men đều", "Tổ kiểm định"],
      ],
    },
    {
      code: "LUA-VP-0007",
      name: "Khăn lụa tơ tằm nhuộm tự nhiên",
      category: "Dệt may",
      village: "Làng lụa Vạn Phúc, Hà Đông",
      artisan: "Hợp tác xã lụa Vạn Phúc",
      events: [
        ["nguyen-lieu", "Kén tằm nuôi tại Bảo Lộc, thu hoạch tháng này", "Trại tằm Bảo Lộc"],
        ["so-che", "Ươm tơ, se sợi thủ công", "Xưởng ươm tơ"],
        ["tao-hinh", "Dệt khung gỗ, khổ 50 x 180 cm", "Xưởng dệt"],
      ],
    },
  ];
  for (const p of demo) {
    const { rows: r } = await pool.query(
      "INSERT INTO products (code, name, category, village, artisan, created_by) VALUES ($1,$2,$3,$4,$5,'seed') RETURNING id",
      [p.code, p.name, p.category, p.village, p.artisan],
    );
    let minutesAgo = p.events.length * 1440;
    for (const [stage, note, location] of p.events) {
      await pool.query(
        "INSERT INTO trace_events (product_id, stage, note, location, actor, created_at) VALUES ($1,$2,$3,$4,'seed', now() - make_interval(mins => $5))",
        [r[0].id, stage, note, location, minutesAgo],
      );
      minutesAgo -= 1440;
    }
  }
  console.log("[trace-api] đã nạp dữ liệu mẫu (2 sản phẩm)");
}

// ---------- Tiện ích HTTP ----------
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(data) });
  res.end(data);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 100_000) throw new HttpError(413, "Nội dung quá lớn");
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "JSON không hợp lệ");
  }
}

/** Đọc thông tin người dùng từ JWT (chữ ký đã được APISIX kiểm tra). */
function getUser(req) {
  const h = req.headers.authorization ?? "";
  const m = /^Bearer\s+([\w-]+)\.([\w-]+)\.[\w-]+$/.exec(h);
  if (!m) throw new HttpError(401, "Thiếu hoặc sai token");
  try {
    const p = JSON.parse(Buffer.from(m[2], "base64url").toString("utf8"));
    if (p.exp && p.exp * 1000 < Date.now()) throw new Error("hết hạn");
    return { name: p.preferred_username ?? p.sub ?? "unknown", roles: Array.isArray(p.policy) ? p.policy : [] };
  } catch {
    throw new HttpError(401, "Token không hợp lệ");
  }
}

function requireWriter(user) {
  if (!user.roles.includes("readwrite")) throw new HttpError(403, "Cần quyền readwrite để thực hiện thao tác này");
}

const str = (v, max, field, required = false) => {
  const s = typeof v === "string" ? v.trim() : "";
  if (required && !s) throw new HttpError(400, `Thiếu trường "${field}"`);
  if (s.length > max) throw new HttpError(400, `Trường "${field}" tối đa ${max} ký tự`);
  return s;
};

// ---------- Xử lý nghiệp vụ ----------
async function listProducts() {
  const { rows } = await pool.query(`
    SELECT p.code, p.name, p.category, p.village, p.artisan, p.created_at,
           count(e.id)::int AS event_count,
           (SELECT stage FROM trace_events WHERE product_id = p.id ORDER BY created_at DESC, id DESC LIMIT 1) AS last_stage
    FROM products p LEFT JOIN trace_events e ON e.product_id = p.id
    GROUP BY p.id ORDER BY p.created_at DESC`);
  return rows;
}

async function getProduct(code, { publicView = false } = {}) {
  const { rows } = await pool.query(
    "SELECT id, code, name, category, village, artisan, created_by, created_at FROM products WHERE lower(code) = lower($1)",
    [code],
  );
  if (!rows.length) throw new HttpError(404, "Không tìm thấy sản phẩm");
  const p = rows[0];
  const ev = await pool.query(
    "SELECT stage, note, location, actor, iot, created_at FROM trace_events WHERE product_id = $1 ORDER BY created_at, id",
    [p.id],
  );
  const events = ev.rows.map((e) => (publicView ? { stage: e.stage, note: e.note, location: e.location, iot: e.iot, created_at: e.created_at } : e));
  const product = { code: p.code, name: p.name, category: p.category, village: p.village, artisan: p.artisan, created_at: p.created_at };
  if (!publicView) product.created_by = p.created_by;
  return { ...product, events };
}

async function createProduct(body, user) {
  const name = str(body.name, 200, "name", true);
  const category = str(body.category, 100, "category");
  const village = str(body.village, 200, "village");
  const artisan = str(body.artisan, 200, "artisan");
  let code = str(body.code, 40, "code");
  if (code && !CODE_RE.test(code)) throw new HttpError(400, "Mã chỉ gồm chữ, số, dấu gạch ngang (3-40 ký tự)");
  if (!code) code = `LN-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  try {
    await pool.query("INSERT INTO products (code, name, category, village, artisan, created_by) VALUES ($1,$2,$3,$4,$5,$6)", [
      code, name, category, village, artisan, user.name,
    ]);
  } catch (e) {
    if (e.code === "23505") throw new HttpError(409, `Mã "${code}" đã tồn tại`);
    throw e;
  }
  return getProduct(code);
}

/**
 * Bằng chứng IoT gắn vào công đoạn nung: số liệu cảm biến lò trong khoảng thời gian nung.
 * Giao diện đọc dữ liệu thô từ MinIO (kèm JWT), tóm tắt rồi gửi lên; dịch vụ này chỉ kiểm tra hình dạng và giới hạn.
 */
function parseIot(v) {
  if (v === undefined || v === null) return null;
  if (typeof v !== "object" || Array.isArray(v)) throw new HttpError(400, "iot phải là một đối tượng");
  const num = (x, f, limit = 100000) => {
    if (typeof x !== "number" || !Number.isFinite(x) || Math.abs(x) > limit) throw new HttpError(400, `iot.${f} không hợp lệ`);
    return x;
  };
  const time = (x, f) => {
    const t = typeof x === "string" ? Date.parse(x) : NaN;
    if (Number.isNaN(t)) throw new HttpError(400, `iot.${f} không phải thời gian hợp lệ`);
    return t;
  };
  const from = time(v.from, "from");
  const to = time(v.to, "to");
  if (to <= from) throw new HttpError(400, "iot.to phải sau iot.from");
  if (to - from > 72 * 3600 * 1000) throw new HttpError(400, "Khoảng thời gian nung tối đa 72 giờ");
  if (to > Date.now() + 5 * 60 * 1000) throw new HttpError(400, "iot.to không được ở tương lai");
  const count = num(v.count, "count");
  if (!Number.isInteger(count) || count < 1) throw new HttpError(400, "iot.count phải là số nguyên dương");
  if (!Array.isArray(v.curve) || v.curve.length < 1 || v.curve.length > 60) throw new HttpError(400, "iot.curve cần 1-60 điểm");
  const curve = v.curve.map((p) => {
    if (!Array.isArray(p) || p.length !== 2) throw new HttpError(400, "iot.curve sai định dạng [thời gian, giá trị]");
    return [num(p[0], "curve.t", 1e14), num(p[1], "curve.v")];
  });
  return {
    deviceId: str(v.deviceId, 60, "iot.deviceId", true),
    deviceName: str(v.deviceName, 100, "iot.deviceName"),
    metric: str(v.metric, 30, "iot.metric", true),
    unit: str(v.unit, 10, "iot.unit"),
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    count,
    min: num(v.min, "min"),
    avg: num(v.avg, "avg"),
    max: num(v.max, "max"),
    curve,
  };
}

async function addEvent(code, body, user) {
  const stage = str(body.stage, 40, "stage", true);
  if (!STAGES.includes(stage)) throw new HttpError(400, `Công đoạn không hợp lệ. Hợp lệ: ${STAGES.join(", ")}`);
  const note = str(body.note, 1000, "note");
  const location = str(body.location, 200, "location");
  const iot = parseIot(body.iot);
  if (iot && stage !== "nung-hoan-thien") throw new HttpError(400, "Chỉ gắn dữ liệu IoT vào công đoạn nung-hoan-thien");
  const { rows } = await pool.query("SELECT id FROM products WHERE lower(code) = lower($1)", [code]);
  if (!rows.length) throw new HttpError(404, "Không tìm thấy sản phẩm");
  await pool.query("INSERT INTO trace_events (product_id, stage, note, location, actor, iot) VALUES ($1,$2,$3,$4,$5,$6)", [
    rows[0].id, stage, note, location, user.name, iot,
  ]);
  return getProduct(code);
}

// ---------- Định tuyến ----------
async function route(req, res) {
  const url = new URL(req.url, "http://x");
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const m = req.method;

  if (m === "GET" && parts[0] === "healthz") return send(res, 200, { status: "ok" });

  if (parts[0] === "public" && parts.length === 2 && m === "GET") return send(res, 200, await getProduct(parts[1], { publicView: true }));

  if (parts[0] === "products") {
    const user = getUser(req);
    if (parts.length === 1 && m === "GET") return send(res, 200, { stages: STAGES, products: await listProducts() });
    if (parts.length === 1 && m === "POST") {
      requireWriter(user);
      return send(res, 201, await createProduct(await readJson(req), user));
    }
    if (parts.length === 2 && m === "GET") return send(res, 200, await getProduct(parts[1]));
    if (parts.length === 3 && parts[2] === "events" && m === "POST") {
      requireWriter(user);
      return send(res, 201, await addEvent(parts[1], await readJson(req), user));
    }
  }
  throw new HttpError(404, "Không có tuyến này");
}

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.status, { error: err.message });
    console.error("[trace-api] lỗi:", err);
    send(res, 500, { error: "Lỗi máy chủ" });
  }
});

async function main() {
  // Chờ PostgreSQL sẵn sàng (compose đã có healthcheck, đây là lớp bảo hiểm).
  for (let i = 1; ; i++) {
    try {
      await ensureDatabase();
      break;
    } catch (e) {
      if (i >= 20) throw e;
      console.error(`[trace-api] chờ PostgreSQL (${i}/20): ${e.message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  pool = new Pool({ ...pgBase, database: DB_NAME, max: 5 });
  await migrate();
  if (SEED) await seed();
  server.listen(PORT, () => console.log(`[trace-api] lắng nghe cổng ${PORT}, database "${DB_NAME}"`));
}

main().catch((e) => {
  console.error("[trace-api] không khởi động được:", e);
  process.exit(1);
});
