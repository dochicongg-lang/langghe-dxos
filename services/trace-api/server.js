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
 *   GET  /me                        thông tin và quyền hiệu lực của người dùng (theo config/access.json)
 *   GET  /products                  danh sách sản phẩm            (theo phạm vi product.read: all/coop)
 *   POST /products                  tạo sản phẩm                  (role editor)
 *   GET  /products/:code            chi tiết + dòng thời gian     (role editor hoặc readonly)
 *   POST /products/:code/events     thêm công đoạn                (role editor; công đoạn nung có thể kèm iot:{deviceId,from,to},
 *                                                                  máy chủ tự đọc MinIO và tính tóm tắt)
 *   GET  /public/:code              tra cứu công khai cho người mua (không cần đăng nhập, ẩn thông tin nội bộ)
 *   GET  /healthz                   kiểm tra sống
 */

const http = require("node:http");
const { Pool, Client } = require("pg");
const path = require("node:path");
const access = require("./access");
const { runMigrations } = require("./migrations");
const { loadDevices } = require("./devices");
const { IotError, parseWindow, createS3Client, buildEvidence } = require("./iot");

const PORT = Number(process.env.PORT ?? 3000);
const pgBase = {
  host: process.env.PG_HOST ?? "postgres",
  port: Number(process.env.PG_PORT ?? 5432),
  user: process.env.PG_USER ?? "postgres",
  password: process.env.PG_PASSWORD ?? "postgres",
};
const DB_NAME = process.env.TRACE_DB ?? "traceability";
const SEED = (process.env.TRACE_SEED ?? "true") !== "false";

// Ma trận quyền (nguồn duy nhất: config/access.json, mount vào container).
const ACCESS = access.load(process.env.ACCESS_FILE ?? "/app/config/access.json");

// Danh bạ thiết bị -> gateway sở hữu (xem devices.js). Chỉ đọc số liệu từ thư mục của gateway sở hữu thiết bị.
const devices = loadDevices(process.env.IOT_DEVICES_FILE ?? "/app/config/iot-devices.json");

// Tài khoản MinIO CHỈ ĐỌC (tiền tố iot/) để máy chủ tự đối chiếu số liệu cảm biến. Không cấu hình thì tắt tính năng IoT.
const s3 =
  process.env.S3_ENDPOINT && process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY
    ? createS3Client({
        endpoint: process.env.S3_ENDPOINT,
        accessKey: process.env.S3_ACCESS_KEY,
        secretKey: process.env.S3_SECRET_KEY,
        bucket: process.env.S3_BUCKET ?? "dxos-data",
      })
    : null;

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
  await runMigrations(pool, path.join(__dirname, "migrations"));
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

/** Dữ liệu miền mẫu cho demo (một HTX). Chạy lặp lại an toàn. Chỉ khi TRACE_SEED bật. */
async function seedDomain() {
  const { rows } = await pool.query(
    "INSERT INTO cooperatives (code, name) VALUES ('htx-demo', $1) ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id",
    ["Hợp tác xã làng nghề mẫu (demo)"],
  );
  const coopId = rows[0].id;
  for (const v of ["Làng gốm Bát Tràng, Hà Nội", "Làng lụa Vạn Phúc, Hà Đông"]) {
    await pool.query("INSERT INTO villages (name) VALUES ($1) ON CONFLICT (name) DO NOTHING", [v]);
  }
  await pool.query(
    "INSERT INTO producers (username, display_name, type, coop_id, village_id) VALUES ('hoa', $1, 'nghe-nhan', $2, (SELECT id FROM villages WHERE name = $3)) ON CONFLICT (username) DO NOTHING",
    ["Chị Hoa (nghệ nhân gốm Bát Tràng)", coopId, "Làng gốm Bát Tràng, Hà Nội"],
  );
  await pool.query("UPDATE products SET coop_id = $1 WHERE coop_id IS NULL AND created_by = 'seed'", [coopId]);
  await pool.query("UPDATE products p SET village_id = v.id FROM villages v WHERE p.village_id IS NULL AND p.village = v.name");
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
    const coop = Array.isArray(p.coop) ? p.coop[0] : p.coop;
    return { name: p.preferred_username ?? p.sub ?? "unknown", roles: Array.isArray(p.policy) ? p.policy : [], coop: typeof coop === "string" ? coop : "" };
  } catch {
    throw new HttpError(401, "Token không hợp lệ");
  }
}

/**
 * Kiểm tra quyền theo ma trận (config/access.json). resource: { owner, coop } của tài nguyên (nếu có).
 * Vai trò không dùng được API (ví dụ iot-writer) bị từ chối ngay.
 */
function requirePermission(user, action, resource = {}) {
  if (!access.canApi(ACCESS, user.roles)) throw new HttpError(403, "Vai trò của bạn không dùng được API này");
  if (access.authorize(ACCESS, user, action, resource)) return;
  const scope = access.scopeFor(ACCESS, user.roles, action);
  if (!scope) throw new HttpError(403, "Vai trò của bạn không có quyền thực hiện thao tác này");
  if ((scope === "coop" || scope === "self") && !user.coop) throw new HttpError(403, "Tài khoản chưa thuộc HTX nào (thiếu thuộc tính coop), liên hệ quản trị");
  throw new HttpError(403, scope === "own" ? "Chỉ được thao tác trên sản phẩm do chính bạn tạo" : "Chỉ được thao tác trên sản phẩm thuộc HTX của bạn");
}

const str = (v, max, field, required = false) => {
  const s = typeof v === "string" ? v.trim() : "";
  if (required && !s) throw new HttpError(400, `Thiếu trường "${field}"`);
  if (s.length > max) throw new HttpError(400, `Trường "${field}" tối đa ${max} ký tự`);
  return s;
};

// ---------- Xử lý nghiệp vụ ----------
async function listProducts(user) {
  const scope = access.scopeFor(ACCESS, user.roles, "product.read");
  if (!scope) throw new HttpError(403, "Vai trò của bạn không có quyền xem sản phẩm");
  if (scope === "coop" && !user.coop) return []; // chưa thuộc HTX nào thì không thấy sản phẩm nào
  const where = scope === "all" ? "" : "WHERE c.code = $1";
  const { rows } = await pool.query(
    `SELECT p.code, p.name, p.category, p.village, p.artisan, p.created_at, p.owner_username AS owner, c.code AS coop,
           count(e.id)::int AS event_count,
           (SELECT stage FROM trace_events WHERE product_id = p.id ORDER BY created_at DESC, id DESC LIMIT 1) AS last_stage
    FROM products p LEFT JOIN trace_events e ON e.product_id = p.id LEFT JOIN cooperatives c ON c.id = p.coop_id
    ${where}
    GROUP BY p.id, c.code ORDER BY p.created_at DESC`,
    scope === "all" ? [] : [user.coop],
  );
  return rows;
}

async function findProductRow(code) {
  const { rows } = await pool.query(
    `SELECT p.id, p.code, p.name, p.category, p.village, p.artisan, p.created_by, p.created_at, p.owner_username AS owner, c.code AS coop
     FROM products p LEFT JOIN cooperatives c ON c.id = p.coop_id WHERE lower(p.code) = lower($1)`,
    [code],
  );
  return rows[0] ?? null;
}

/** Chi tiết sản phẩm. Bản công khai không kèm thông tin nội bộ (người tạo, chủ sở hữu, HTX). Bản nội bộ phải qua kiểm tra quyền xem. */
async function getProduct(code, { publicView = false, user = null } = {}) {
  const p = await findProductRow(code);
  if (!p) throw new HttpError(404, "Không tìm thấy sản phẩm");
  if (!publicView && !access.authorize(ACCESS, user, "product.read", p)) throw new HttpError(404, "Không tìm thấy sản phẩm"); // không lộ sự tồn tại
  const ev = await pool.query(
    "SELECT stage, note, location, actor, iot, created_at FROM trace_events WHERE product_id = $1 ORDER BY created_at, id",
    [p.id],
  );
  const events = ev.rows.map((e) => (publicView ? { stage: e.stage, note: e.note, location: e.location, iot: e.iot, created_at: e.created_at } : e));
  const product = { code: p.code, name: p.name, category: p.category, village: p.village, artisan: p.artisan, created_at: p.created_at };
  if (!publicView) {
    product.created_by = p.created_by;
    product.owner = p.owner;
    product.coop = p.coop;
    product.can_update = access.authorize(ACCESS, user, "product.update", p); // giao diện dùng để ẩn/hiện form; máy chủ vẫn kiểm tra lại khi ghi
  }
  return { ...product, events };
}

async function createProduct(body, user) {
  requirePermission(user, "product.create", { coop: user.coop });
  const name = str(body.name, 200, "name", true);
  const category = str(body.category, 100, "category");
  const village = str(body.village, 200, "village");
  const artisan = str(body.artisan, 200, "artisan");
  let code = str(body.code, 40, "code");
  if (code && !CODE_RE.test(code)) throw new HttpError(400, "Mã chỉ gồm chữ, số, dấu gạch ngang (3-40 ký tự)");
  if (!code) code = `LN-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  // HTX của sản phẩm: quản trị (phạm vi all) có thể chỉ định bằng body.coop; còn lại luôn là HTX của người tạo
  const scope = access.scopeFor(ACCESS, user.roles, "product.create");
  const coopCode = scope === "all" ? str(body.coop, 60, "coop") || user.coop : user.coop;
  let coopId = null;
  if (coopCode) {
    const c = await pool.query("SELECT id FROM cooperatives WHERE code = $1", [coopCode]);
    if (!c.rows.length) throw new HttpError(400, `Không có HTX mã "${coopCode}"`);
    coopId = c.rows[0].id;
  }
  try {
    await pool.query(
      "INSERT INTO products (code, name, category, village, artisan, created_by, owner_username, coop_id) VALUES ($1,$2,$3,$4,$5,$6,$6,$7)",
      [code, name, category, village, artisan, user.name, coopId],
    );
  } catch (e) {
    if (e.code === "23505") throw new HttpError(409, `Mã "${code}" đã tồn tại`);
    throw e;
  }
  return getProduct(code, { user });
}

async function addEvent(code, body, user) {
  const product = await findProductRow(code);
  if (!product) throw new HttpError(404, "Không tìm thấy sản phẩm");
  // 404 thay vì 403 khi người dùng không được thấy sản phẩm, để không lộ sự tồn tại
  if (!access.authorize(ACCESS, user, "product.read", product)) throw new HttpError(404, "Không tìm thấy sản phẩm");
  requirePermission(user, "product.update", product);
  const stage = str(body.stage, 40, "stage", true);
  if (!STAGES.includes(stage)) throw new HttpError(400, `Công đoạn không hợp lệ. Hợp lệ: ${STAGES.join(", ")}`);
  const note = str(body.note, 1000, "note");
  const location = str(body.location, 200, "location");
  let iot = null;
  if (body.iot !== undefined && body.iot !== null) {
    if (stage !== "nung-hoan-thien") throw new HttpError(400, "Chỉ gắn dữ liệu IoT vào công đoạn nung-hoan-thien");
    if (!s3) throw new HttpError(503, "Chưa cấu hình tài khoản đọc MinIO cho trace-api (S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY)");
    const win = parseWindow(body.iot); // chỉ nhận { deviceId, from, to }; số liệu do máy chủ tự đọc và tính
    const device = devices.get(win.deviceId);
    if (!device) throw new HttpError(400, `Thiết bị "${win.deviceId}" chưa được đăng ký trong danh bạ thiết bị (config/iot-devices.json)`);
    try {
      iot = await buildEvidence(win, s3, device.gateway, device);
    } catch (e) {
      if (e instanceof IotError) throw new HttpError(e.status, e.message);
      console.error("[trace-api] lỗi đọc dữ liệu IoT:", e.message);
      throw new HttpError(502, "Không đọc được dữ liệu cảm biến từ MinIO");
    }
  }
  await pool.query("INSERT INTO trace_events (product_id, stage, note, location, actor, iot) VALUES ($1,$2,$3,$4,$5,$6)", [
    product.id, stage, note, location, user.name, iot,
  ]);
  return getProduct(code, { user });
}

// ---------- Định tuyến ----------
async function route(req, res) {
  const url = new URL(req.url, "http://x");
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const m = req.method;

  if (m === "GET" && parts[0] === "healthz") return send(res, 200, { status: "ok" });

  if (parts[0] === "public" && parts.length === 2 && m === "GET") return send(res, 200, await getProduct(parts[1], { publicView: true }));

  if (parts[0] === "me" && parts.length === 1 && m === "GET") {
    const user = getUser(req);
    if (!access.canApi(ACCESS, user.roles)) throw new HttpError(403, "Vai trò của bạn không dùng được API này");
    return send(res, 200, { username: user.name, roles: user.roles, coop: user.coop, permissions: access.permissionsOf(ACCESS, user.roles) });
  }

  if (parts[0] === "products") {
    const user = getUser(req);
    if (!access.canApi(ACCESS, user.roles)) throw new HttpError(403, "Vai trò của bạn không dùng được API này"); // token thiết bị (iot-writer) không đọc được dữ liệu nghiệp vụ
    if (parts.length === 1 && m === "GET") return send(res, 200, { stages: STAGES, products: await listProducts(user) });
    if (parts.length === 1 && m === "POST") return send(res, 201, await createProduct(await readJson(req), user));
    if (parts.length === 2 && m === "GET") return send(res, 200, await getProduct(parts[1], { user }));
    if (parts.length === 3 && parts[2] === "events" && m === "POST") return send(res, 201, await addEvent(parts[1], await readJson(req), user));
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
  if (SEED) {
    await seed();
    await seedDomain();
  }
  server.listen(PORT, () => console.log(`[trace-api] lắng nghe cổng ${PORT}, database "${DB_NAME}"`));
}

main().catch((e) => {
  console.error("[trace-api] không khởi động được:", e);
  process.exit(1);
});
