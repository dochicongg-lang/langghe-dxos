// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
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
 *   POST /applications/:code/attachments?doc=&name=   tải tệp (thân thô) | DELETE .../attachments/:id gỡ | GET .../attachments/:id/file xem/tải
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
const crypto = require("node:crypto");
const ocop = require("./ocop");
const attachments = require("./attachments");
const lifecycle = require("./lifecycle");
const kiln = require("./kiln");
const sectors = require("./sectors");
const overview = require("./overview");
const audit = require("./audit");
const scan = require("./scan");
const reminders = require("./reminders");
const lake = require("./lake");
const assistant = require("./assistant");
const agent = require("./agent");
const { createFlowableClient } = require("./flowable");

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

// Cấu hình OCOP theo địa phương (nguồn: config/ocop-profiles.json) và Flowable (điều khiển quy trình hồ sơ).
const OCOP = ocop.loadProfiles(process.env.OCOP_PROFILES_FILE ?? "/app/config/ocop-profiles.json");
const flowable = process.env.FLOWABLE_URL
  ? createFlowableClient(
      process.env.FLOWABLE_PROXY_KEY
        ? { baseUrl: process.env.FLOWABLE_URL, apiKey: process.env.FLOWABLE_PROXY_KEY }
        : { baseUrl: process.env.FLOWABLE_URL, user: process.env.FLOWABLE_USER ?? "rest-admin", password: process.env.FLOWABLE_PASSWORD ?? "" },
    )
  : null;

// Hồ sơ nung cho phân tích thông minh đường cong lò (nguồn: config/kiln-profiles.json).
// Ngành nghề (gốm, lụa...) và chuỗi công đoạn riêng của từng ngành (nguồn: config/sectors.json).
const SECTORS = sectors.load(process.env.SECTORS_FILE ?? "/app/config/sectors.json");
const KILN = kiln.loadProfiles(process.env.KILN_PROFILES_FILE ?? "/app/config/kiln-profiles.json");

// Tài khoản MinIO ghi/đọc TỆP ĐÍNH KÈM hồ sơ (chỉ bucket tệp, tiền tố applications/). Không cấu hình thì tắt tính năng tệp.
const docsS3 =
  process.env.S3_ENDPOINT && process.env.DOCS_S3_ACCESS_KEY && process.env.DOCS_S3_SECRET_KEY
    ? createS3Client({
        endpoint: process.env.S3_ENDPOINT,
        accessKey: process.env.DOCS_S3_ACCESS_KEY,
        secretKey: process.env.DOCS_S3_SECRET_KEY,
        bucket: process.env.DOCS_BUCKET ?? "dxos-docs",
      })
    : null;

// Quét mã độc tệp tải lên bằng ClamAV (clamd). Không đặt CLAMAV_HOST thì tắt bước quét. Mặc định BẮT BUỘC: clamd không sẵn sàng thì từ chối
// tải lên (CLAMAV_REQUIRED=false để cho qua khi không quét được, chỉ nên dùng khi thử nghiệm).
const scanner = process.env.CLAMAV_HOST ? scan.createScanner({ host: process.env.CLAMAV_HOST, port: Number(process.env.CLAMAV_PORT ?? 3310) }) : null;
const SCAN_REQUIRED = String(process.env.CLAMAV_REQUIRED ?? "true").toLowerCase() !== "false";

// Tài khoản MinIO ghi/đọc BẢN NEO của nhật ký kiểm toán (bucket riêng có Object Lock). Không cấu hình thì tắt tính năng neo.
const anchorS3 =
  process.env.S3_ENDPOINT && process.env.ANCHOR_S3_ACCESS_KEY && process.env.ANCHOR_S3_SECRET_KEY
    ? createS3Client({
        endpoint: process.env.S3_ENDPOINT,
        accessKey: process.env.ANCHOR_S3_ACCESS_KEY,
        secretKey: process.env.ANCHOR_S3_SECRET_KEY,
        bucket: process.env.ANCHOR_BUCKET ?? "dxos-audit",
      })
    : null;

// Công đoạn của ngành mặc định (giữ cho giao diện cũ); mỗi sản phẩm dùng công đoạn của NGÀNH mình (SECTORS).
const STAGES = sectors.stagesFor(SECTORS, null).map((s) => s.key);
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
        ["nguyen-lieu", "Tơ tằm nhập từ Bảo Lộc (Lâm Đồng), kiểm tra độ đều và độ bóng của sợi", "Kho tơ Vạn Phúc"],
        ["so-che", "Đánh ống, se sợi và mắc sợi chuẩn bị lên khung", "Xưởng chuẩn bị sợi"],
        ["tao-hinh", "Dệt trên khung cửi, hoa văn đối xứng", "Xưởng dệt Vạn Phúc"],
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
  // Làng lụa có HTX riêng (htx-lua) và một chủ thể sản xuất riêng (tài khoản lua); sản phẩm thuộc ngành lụa chuyển sang HTX đó
  const lua = await pool.query(
    "INSERT INTO cooperatives (code, name) VALUES ('htx-lua', $1) ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id",
    ["Hợp tác xã lụa Vạn Phúc (demo)"],
  );
  const luaId = lua.rows[0].id;
  await pool.query(
    "INSERT INTO producers (username, display_name, type, coop_id, village_id) VALUES ('lua', $1, 'nghe-nhan', $2, (SELECT id FROM villages WHERE name = $3)) ON CONFLICT (username) DO NOTHING",
    ["Chị Lụa (nghệ nhân dệt lụa Vạn Phúc)", luaId, "Làng lụa Vạn Phúc, Hà Đông"],
  );
  const fixes = [
    ["nguyen-lieu", "Kén tằm nuôi tại Bảo Lộc, thu hoạch tháng này", "Tơ tằm nhập từ Bảo Lộc (Lâm Đồng), kiểm tra độ đều và độ bóng của sợi", "Kho tơ Vạn Phúc"],
    ["so-che", "Ươm tơ, se sợi thủ công", "Đánh ống, se sợi và mắc sợi chuẩn bị lên khung", "Xưởng chuẩn bị sợi"],
    ["tao-hinh", "Dệt khung gỗ, khổ 50 x 180 cm", "Dệt trên khung cửi, hoa văn đối xứng", "Xưởng dệt Vạn Phúc"],
  ];
  for (const [stage, oldNote, note, location] of fixes) {
    await pool.query("UPDATE trace_events e SET note = $3, location = $4 FROM products p WHERE e.product_id = p.id AND p.code = 'LUA-VP-0007' AND e.stage = $1 AND e.note = $2", [stage, oldNote, note, location]);
  }
  const movable = await pool.query("SELECT id, category FROM products WHERE coop_id IS NULL OR coop_id = $1", [coopId]);
  for (const r of movable.rows) {
    if (sectors.sectorOf(SECTORS, r.category).key === "lua") await pool.query("UPDATE products SET coop_id = $1 WHERE id = $2", [luaId, r.id]);
  }
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
  return rows.map((r) => ({ ...r, sector: sectors.sectorOf(SECTORS, r.category).key }));
}

async function findProductRow(code) {
  const { rows } = await pool.query(
    `SELECT p.id, p.code, p.name, p.category, p.village, p.artisan, p.created_by, p.created_at, p.owner_username AS owner, c.code AS coop
     FROM products p LEFT JOIN cooperatives c ON c.id = p.coop_id WHERE lower(p.code) = lower($1)`,
    [code],
  );
  return rows[0] ?? null;
}

/**
 * Thông tin OCOP công khai của một sản phẩm, TÁCH BẠCH hai loại (G2.6):
 *  - platform: "xác nhận của nền tảng": hồ sơ đã được HTX sơ duyệt đạt trên hệ thống (KHÔNG phải giấy chứng nhận OCOP);
 *  - official: kết quả OCOP CHÍNH THỨC do cơ quan có thẩm quyền ra (hạng sao, cơ quan, số quyết định, hiệu lực).
 * Chỉ trả các trường được phép công bố, không có tên người dùng hay mã hồ sơ nội bộ.
 */
async function publicOcop(productCode) {
  const off = await pool.query(
    `SELECT r.stars, r.authority, r.decision_no, r.decided_at::text AS decided_at, r.valid_until::text AS valid_until, (r.valid_until >= CURRENT_DATE) AS active
     FROM ocop_results r JOIN ocop_applications a ON a.id = r.application_id
     WHERE lower(a.product_code) = lower($1) AND r.recognized ORDER BY r.decided_at DESC, r.id DESC LIMIT 1`,
    [productCode],
  );
  const plat = await pool.query(
    `SELECT h.created_at FROM ocop_application_history h JOIN ocop_applications a ON a.id = h.application_id
     WHERE lower(a.product_code) = lower($1) AND h.action = 'approve' ORDER BY h.id DESC LIMIT 1`,
    [productCode],
  );
  if (!off.rows.length && !plat.rows.length) return null;
  const o = off.rows[0];
  return {
    platform: plat.rows.length ? { confirmed_at: plat.rows[0].created_at, note: "Hồ sơ OCOP đã được hợp tác xã sơ duyệt đạt trên nền tảng. Đây chưa phải giấy chứng nhận OCOP." } : null,
    official: o ? { stars: o.stars, authority: o.authority, decision_no: o.decision_no, decided_at: o.decided_at, valid_until: o.valid_until, active: o.active } : null,
  };
}

/** Đỉnh nhiệt của MỌI mẻ có bằng chứng IoT trên một thiết bị (để so sánh mẻ nung với các mẻ trước của cùng lò). */
async function kilnPeaks(deviceId) {
  const { rows } = await pool.query("SELECT id, (iot->>'max')::float AS peak FROM trace_events WHERE iot IS NOT NULL AND iot->>'deviceId' = $1", [deviceId]);
  return rows;
}

/** Các bằng chứng IoT (id, iot) của một thiết bị, để dựng đường chuẩn từ những mẻ đạt khác. */
async function kilnPeerRuns(deviceId) {
  const { rows } = await pool.query("SELECT id, iot FROM trace_events WHERE iot IS NOT NULL AND iot->>'deviceId' = $1 ORDER BY id DESC LIMIT 200", [deviceId]);
  return rows;
}

/** Tổng hợp phân tích các mẻ nung mà người dùng được xem (theo phạm vi product.read), mới nhất trước. */
async function kilnInsights(user) {
  const scope = access.scopeFor(ACCESS, user.roles, "product.read");
  if (!scope) throw new HttpError(403, "Vai trò của bạn không có quyền xem sản phẩm");
  if (scope === "coop" && !user.coop) return { profile: null, summary: { total: 0, ok: 0, warn: 0, alert: 0, insufficient: 0 }, runs: [] };
  const { rows } = await pool.query(
    `SELECT e.id, e.iot, e.created_at, p.code, p.name, p.category
     FROM trace_events e JOIN products p ON p.id = e.product_id LEFT JOIN cooperatives c ON c.id = p.coop_id
     WHERE e.iot IS NOT NULL ${scope === "all" ? "" : "AND c.code = $1"} ORDER BY e.created_at DESC, e.id DESC LIMIT 200`,
    scope === "all" ? [] : [user.coop],
  );
  const peerCache = new Map();
  const summary = { total: 0, ok: 0, warn: 0, alert: 0, insufficient: 0 };
  const runs = [];
  for (const r of rows) {
    if (!peerCache.has(r.iot.deviceId)) peerCache.set(r.iot.deviceId, await kilnPeaks(r.iot.deviceId));
    const profile = kiln.pickProfile(KILN, r.category);
    const insight = kiln.analyze(r.iot, profile, { baselinePeaks: peerCache.get(r.iot.deviceId).filter((x) => x.id !== r.id).map((x) => x.peak) });
    summary.total += 1;
    summary[insight.verdict] += 1;
    runs.push({ product_code: r.code, product_name: r.name, at: r.created_at, device_id: r.iot.deviceId, from: r.iot.from, to: r.iot.to, peak: r.iot.max, unit: r.iot.unit, insight });
  }
  const d = kiln.pickProfile(KILN, null);
  return { profile: { id: d.id, name: d.name, verified: d.verified === true, note: d.note ?? "" }, summary, runs };
}

/** Tổng quan điều hành trong phạm vi quyền overview.read: hồ sơ, mẻ nung/nhuộm 90 ngày, kết quả sắp hết hiệu lực; bảng so sánh HTX chỉ ở phạm vi "all". */
async function overviewFor(user) {
  const scope = access.scopeFor(ACCESS, user.roles, "overview.read");
  if (!scope) throw new HttpError(403, "Vai trò của bạn không xem được trang tổng quan");
  const profile = ocop.getProfile(OCOP);
  if (scope === "coop" && !user.coop) return overview.buildOverview({ scope, profile });
  const arg = scope === "all" ? [] : [user.coop];
  const byCoop = scope === "all" ? "" : "WHERE c.code = $1";
  const apps = (
    await pool.query(
      `SELECT a.code, a.product_name, c.code AS coop, a.state,
         (SELECT max(h.created_at) FROM ocop_application_history h WHERE h.application_id = a.id AND h.to_state = a.state AND h.action <> 'archive') AS state_since
       FROM ocop_applications a LEFT JOIN cooperatives c ON c.id = a.coop_id ${byCoop}`,
      arg,
    )
  ).rows;
  const renewals = (
    await pool.query(
      `SELECT a.code, a.product_name, c.code AS coop, r.valid_until::text AS valid_until
       FROM ocop_applications a LEFT JOIN cooperatives c ON c.id = a.coop_id
       JOIN LATERAL (SELECT valid_until FROM ocop_results WHERE application_id = a.id AND recognized ORDER BY id DESC LIMIT 1) r ON TRUE
       WHERE a.state = 'recognized' ${scope === "all" ? "" : "AND c.code = $1"}`,
      arg,
    )
  ).rows.filter((r) => r.valid_until);
  const evs = (
    await pool.query(
      `SELECT e.id, e.iot, p.category, c.code AS coop FROM trace_events e JOIN products p ON p.id = e.product_id LEFT JOIN cooperatives c ON c.id = p.coop_id
       WHERE e.iot IS NOT NULL ${scope === "all" ? "" : "AND c.code = $1"} ORDER BY e.id DESC LIMIT 500`,
      arg,
    )
  ).rows;
  const peers = new Map();
  const runs = [];
  for (const e of evs) {
    if (!peers.has(e.iot.deviceId)) peers.set(e.iot.deviceId, await kilnPeaks(e.iot.deviceId));
    const insight = kiln.analyze(e.iot, kiln.pickProfile(KILN, e.category), { baselinePeaks: peers.get(e.iot.deviceId).filter((x) => x.id !== e.id).map((x) => x.peak) });
    runs.push({ coop: e.coop, sector: sectors.sectorOf(SECTORS, e.category).key, verdict: insight.verdict, at: e.iot.to });
  }
  return overview.buildOverview({ now: new Date(), scope, profile, apps, runs, renewals });
}

/** Chi tiết sản phẩm. Bản công khai không kèm thông tin nội bộ (người tạo, chủ sở hữu, HTX). Bản nội bộ phải qua kiểm tra quyền xem. */
async function getProduct(code, { publicView = false, user = null } = {}) {
  const p = await findProductRow(code);
  if (!p) throw new HttpError(404, "Không tìm thấy sản phẩm");
  if (!publicView && !access.authorize(ACCESS, user, "product.read", p)) throw new HttpError(404, "Không tìm thấy sản phẩm"); // không lộ sự tồn tại
  const ev = await pool.query(
    "SELECT id, stage, note, location, actor, iot, created_at FROM trace_events WHERE product_id = $1 ORDER BY created_at, id",
    [p.id],
  );
  const kilnProfile = kiln.pickProfile(KILN, p.category);
  const peerCache = new Map();
  const insightOf = async (e) => {
    if (!e.iot) return null;
    if (!peerCache.has(e.iot.deviceId)) peerCache.set(e.iot.deviceId, await kilnPeaks(e.iot.deviceId));
    return kiln.analyze(e.iot, kilnProfile, { baselinePeaks: peerCache.get(e.iot.deviceId).filter((r) => r.id !== e.id).map((r) => r.peak) });
  };
  const peerRuns = new Map();
  // Đường chuẩn (chỉ bản nội bộ): trung vị và dải giữa của các mẻ ĐẠT khác trên cùng thiết bị, kèm một câu nhận xét; ít hơn 3 mẻ đạt thì không dựng.
  const referenceOf = async (e) => {
    if (!e.iot || publicView) return null;
    if (!peerRuns.has(e.iot.deviceId)) peerRuns.set(e.iot.deviceId, await kilnPeerRuns(e.iot.deviceId));
    const okCurves = peerRuns.get(e.iot.deviceId).filter((r) => r.id !== e.id && kiln.analyze(r.iot, kilnProfile).verdict === "ok").map((r) => r.iot.curve);
    const ref = kiln.referenceCurve(okCurves);
    return { n: ref.n, enough: ref.enough, points: ref.points, note: kiln.compareToReference(e.iot.curve, ref, kilnProfile.terms ?? {}) };
  };
  const events = [];
  for (const e of ev.rows) {
    const insight = await insightOf(e);
    const reference = await referenceOf(e);
    const { id: _id, ...rest } = e;
    events.push(publicView ? { stage: e.stage, note: e.note, location: e.location, iot: e.iot, ...(insight && kiln.publicAllows(KILN, insight.verdict) ? { insight } : {}), created_at: e.created_at } : { ...rest, ...(insight ? { insight } : {}), ...(reference ? { reference } : {}) });
  }
  const sector = sectors.sectorOf(SECTORS, p.category);
  const product = { code: p.code, name: p.name, category: p.category, sector: sector.key, sector_label: sector.label, sensor_stage: sector.sensorStage ?? null, stages: sector.stages, village: p.village, artisan: p.artisan, created_at: p.created_at };
  if (publicView) product.ocop = await publicOcop(p.code);
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
  const allowedStages = sectors.stagesFor(SECTORS, product.category).map((s) => s.key);
  if (!allowedStages.includes(stage)) throw new HttpError(400, `Công đoạn không hợp lệ cho ngành này. Hợp lệ: ${allowedStages.join(", ")}`);
  const note = str(body.note, 1000, "note");
  const location = str(body.location, 200, "location");
  let iot = null;
  if (body.iot !== undefined && body.iot !== null) {
    const sensorStage = sectors.sectorOf(SECTORS, product.category).sensorStage;
    if (!sensorStage || stage !== sensorStage) throw new HttpError(400, sensorStage ? `Chỉ gắn dữ liệu cảm biến vào công đoạn ${sensorStage} của ngành này` : "Ngành này chưa có công đoạn gắn cảm biến");
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
  const ins = await pool.query("INSERT INTO trace_events (product_id, stage, note, location, actor, iot) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id", [
    product.id, stage, note, location, user.name, iot,
  ]);
  // tác tử xem mẻ nung vừa ghi; lỗi ở đây không được làm hỏng việc ghi công đoạn
  if (iot) await agentScan(ins.rows[0].id).catch((e) => console.error("[trace-api] tác tử không tạo được đề xuất:", e.message));
  return getProduct(code, { user });
}

// ---------- Hồ sơ OCOP (G2): hỗ trợ và theo dõi, kết quả chính thức do cơ quan có thẩm quyền nhập ----------
function profileView(profileId) {
  const p = ocop.getProfile(OCOP, profileId);
  const { id, name, effectiveFrom, verified, sourceNote, legalBasis, authority, scoring, validityMonths, renewalWindowDays, communeReviewWorkingDays, rounds, groups, subjectTypes, checklist } = p;
  return { id, name, effectiveFrom, verified, sourceNote, legalBasis, authority, scoring, validityMonths, renewalWindowDays, communeReviewWorkingDays, rounds, groups, subjectTypes, checklist };
}

const APP_COLS = `a.id, a.code, a.profile, a.product_code, a.product_name, a.product_group, a.description, a.owner_username AS owner,
  c.code AS coop, a.state, a.self_score, a.documents, a.flowable_instance, a.created_at, a.updated_at`;

async function findApplicationRow(code, db = pool, lock = false) {
  const { rows } = await db.query(
    `SELECT ${APP_COLS} FROM ocop_applications a LEFT JOIN cooperatives c ON c.id = a.coop_id WHERE lower(a.code) = lower($1)${lock ? " FOR UPDATE OF a" : ""}`,
    [code],
  );
  return rows[0] ?? null;
}

const appResource = (a) => ({ owner: a.owner, coop: a.coop });

async function listApplications(user) {
  const scope = access.scopeFor(ACCESS, user.roles, "application.read");
  if (!scope) throw new HttpError(403, "Vai trò của bạn không có quyền xem hồ sơ OCOP");
  if (scope === "coop" && !user.coop) return [];
  const where = scope === "all" ? "" : scope === "coop" ? "WHERE c.code = $1" : "WHERE a.owner_username = $1";
  const { rows } = await pool.query(
    `SELECT ${APP_COLS}, (SELECT stars FROM ocop_results r WHERE r.application_id = a.id ORDER BY r.id DESC LIMIT 1) AS stars
     FROM ocop_applications a LEFT JOIN cooperatives c ON c.id = a.coop_id ${where} ORDER BY a.updated_at DESC`,
    scope === "all" ? [] : [scope === "coop" ? user.coop : user.name],
  );
  return rows.map((r) => ({ ...r, flowable_instance: undefined }));
}

async function getApplication(code, user) {
  const a = await findApplicationRow(code);
  // 404 thay vì 403 khi không được xem, để không lộ sự tồn tại
  if (!a || !access.authorize(ACCESS, user, "application.read", appResource(a))) throw new HttpError(404, "Không tìm thấy hồ sơ");
  const profile = ocop.getProfile(OCOP, a.profile);
  const hist = await pool.query("SELECT action, from_state, to_state, actor, note, created_at FROM ocop_application_history WHERE application_id = $1 ORDER BY id", [a.id]);
  const resRows = await pool.query(
    "SELECT score, stars, authority, decision_no, decided_at::text AS decided_at, valid_until::text AS valid_until, recognized, recorded_by, created_at FROM ocop_results WHERE application_id = $1 ORDER BY id DESC",
    [a.id],
  );
  const attRows = await pool.query(
    "SELECT id, doc_key, filename, content_type, size, sha256, uploaded_by, created_at FROM application_attachments WHERE application_id = $1 AND removed_at IS NULL ORDER BY id",
    [a.id],
  );
  let expected = null;
  if (a.self_score) {
    try {
      const t = ocop.scoreTotals(profile, a.self_score);
      expected = { ...t, stars: ocop.starsFor(profile, t.total) };
    } catch {
      expected = null;
    }
  }
  const actions = ocop
    .actionsFrom(a.state)
    .filter((act) => access.authorize(ACCESS, user, ocop.TRANSITIONS[act].permission, appResource(a)));
  let openTask = null;
  if (flowable && a.flowable_instance && !["rejected", "recognized", "not_recognized"].includes(a.state)) {
    try {
      openTask = await flowable.openTask(a.flowable_instance);
    } catch (e) {
      console.error("[trace-api] không đọc được nhiệm vụ Flowable:", e.message);
    }
  }
  const { flowable_instance: _omit, ...app } = a;
  return {
    ...app,
    checklist: ocop.checklistFor(profile, a.product_group),
    missing_documents: ocop.missingRequired(profile, a.product_group, a.documents),
    expected,
    result: resRows.rows[0] ?? null,
    results: resRows.rows,
    attachments: attRows.rows.map(attachmentView),
    attachment_rules: { maxBytes: profile.attachments.maxBytes, maxPerApplication: profile.attachments.maxPerApplication, types: profile.attachments.types, enabled: Boolean(docsS3) },
    history: hist.rows,
    actions,
    can_update: access.authorize(ACCESS, user, "application.update", appResource(a)) && ["draft", "needs_revision"].includes(a.state),
    open_task: openTask,
    disclaimer: "Hạng sao ở bước tự chấm chỉ là DỰ KIẾN. Kết quả OCOP chính thức do cơ quan có thẩm quyền quyết định.",
  };
}

function parseAppFields(body, profile, { partial = false } = {}) {
  const out = {};
  if (!partial || body.product_name !== undefined) out.product_name = str(body.product_name, 200, "product_name", true);
  if (!partial || body.product_group !== undefined) {
    out.product_group = str(body.product_group, 60, "product_group", true);
    if (!profile.groups.some((g) => g.key === out.product_group)) throw new HttpError(400, `Nhóm sản phẩm không hợp lệ. Hợp lệ: ${profile.groups.map((g) => g.key).join(", ")}`);
  }
  if (body.description !== undefined) out.description = str(body.description, 2000, "description");
  if (body.product_code !== undefined) {
    out.product_code = str(body.product_code, 40, "product_code") || null;
    if (out.product_code && !CODE_RE.test(out.product_code)) throw new HttpError(400, "Mã sản phẩm truy xuất không hợp lệ");
  }
  if (body.self_score !== undefined && body.self_score !== null) {
    try {
      out.self_score = ocop.scoreTotals(profile, body.self_score).parts;
    } catch (e) {
      throw new HttpError(400, e.message);
    }
  }
  if (body.documents !== undefined) {
    if (!Array.isArray(body.documents)) throw new HttpError(400, "documents phải là danh sách khóa giấy tờ");
    const valid = new Set(profile.checklist.map((c) => c.key));
    const bad = body.documents.filter((k) => !valid.has(k));
    if (bad.length) throw new HttpError(400, `Giấy tờ không có trong danh mục: ${bad.join(", ")}`);
    out.documents = [...new Set(body.documents)];
  }
  return out;
}

async function createApplication(body, user) {
  requirePermission(user, "application.create", { coop: user.coop });
  const profile = ocop.getProfile(OCOP);
  const f = parseAppFields(body, profile);
  const scope = access.scopeFor(ACCESS, user.roles, "application.create");
  const coopCode = scope === "all" ? str(body.coop, 60, "coop") || user.coop : user.coop;
  let coopId = null;
  if (coopCode) {
    const c = await pool.query("SELECT id FROM cooperatives WHERE code = $1", [coopCode]);
    if (!c.rows.length) throw new HttpError(400, `Không có HTX mã "${coopCode}"`);
    coopId = c.rows[0].id;
  }
  const code = `OCOP-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO ocop_applications (code, profile, product_code, product_name, product_group, description, owner_username, coop_id, self_score, documents)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [code, profile.id, f.product_code ?? null, f.product_name, f.product_group, f.description ?? "", user.name, coopId, f.self_score ?? null, JSON.stringify(f.documents ?? [])],
    );
    await client.query("INSERT INTO ocop_application_history (application_id, action, from_state, to_state, actor, note) VALUES ($1,'create',NULL,'draft',$2,'')", [rows[0].id, user.name]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return getApplication(code, user);
}

async function updateApplication(code, body, user) {
  const a = await findApplicationRow(code);
  if (!a || !access.authorize(ACCESS, user, "application.read", appResource(a))) throw new HttpError(404, "Không tìm thấy hồ sơ");
  requirePermission(user, "application.update", appResource(a));
  if (!["draft", "needs_revision"].includes(a.state)) throw new HttpError(409, `Hồ sơ đang ở trạng thái "${a.state}", không sửa được`);
  const f = parseAppFields(body, ocop.getProfile(OCOP, a.profile), { partial: true });
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(f)) {
    vals.push(k === "documents" ? JSON.stringify(v) : v);
    sets.push(`${k} = $${vals.length}`);
  }
  if (sets.length) {
    vals.push(a.id);
    await pool.query(`UPDATE ocop_applications SET ${sets.join(", ")}, updated_at = now() WHERE id = $${vals.length}`, vals);
  }
  return getApplication(code, user);
}

function parseResult(body, profile) {
  const score = Number(body.score);
  if (!Number.isFinite(score) || score < 0 || score > profile.scoring.maxTotal) throw new HttpError(400, `Điểm chính thức phải từ 0 đến ${profile.scoring.maxTotal}`);
  const stars = ocop.starsFor(profile, Math.round(score * 100) / 100);
  if (!stars) throw new HttpError(400, "Điểm không rơi vào khoảng hạng sao nào của cấu hình");
  const decisionNo = str(body.decision_no, 100, "decision_no", true);
  const decidedAt = str(body.decided_at, 10, "decided_at", true);
  const d = new Date(`${decidedAt}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(decidedAt) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== decidedAt) throw new HttpError(400, "decided_at phải là ngày hợp lệ dạng YYYY-MM-DD");
  if (d.getTime() > Date.now() + 86400000) throw new HttpError(400, "Ngày quyết định không được ở tương lai");
  const recognized = stars >= profile.scoring.minStarsRecognized;
  const authority = str(body.authority, 300, "authority") || ocop.authorityFor(profile, stars) || profile.authority.star3and4;
  return { score: Math.round(score * 100) / 100, stars, decisionNo, decidedAt, recognized, authority, validUntil: recognized ? ocop.validUntil(profile, decidedAt) : null };
}

async function applicationAction(code, body, user) {
  const peek = await findApplicationRow(code);
  if (!peek || !access.authorize(ACCESS, user, "application.read", appResource(peek))) throw new HttpError(404, "Không tìm thấy hồ sơ");
  if (!flowable) throw new HttpError(503, "Chưa cấu hình Flowable cho trace-api (FLOWABLE_URL)");
  const action = str(body.action, 20, "action", true);
  const note = str(body.note, 1000, "note");
  const profile = ocop.getProfile(OCOP, peek.profile);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const a = await findApplicationRow(code, client, true); // khóa dòng: hai thao tác đồng thời không chồng nhau
    const t = ocop.transition(a.state, action, {});
    if (!t.ok) throw new HttpError(409, t.error);
    requirePermission(user, t.permission, appResource(a));
    let to = t.to;
    let instance = a.flowable_instance;
    let result = null;
    if (action === "submit") {
      if (!a.self_score) throw new HttpError(400, "Cần tự chấm điểm (các phần A, B, C) trước khi nộp");
      const missing = ocop.missingRequired(profile, a.product_group, a.documents);
      if (missing.length) throw new HttpError(400, `Còn thiếu giấy tờ bắt buộc: ${missing.join(", ")}`);
    }
    if (action === "revise" || action === "reject") {
      if (!note) throw new HttpError(400, "Cần ghi lý do (note) khi yêu cầu bổ sung hoặc không đạt");
    }
    if (action === "result") {
      result = parseResult(body, profile);
      to = ocop.transition(a.state, action, { recognized: result.recognized }).to;
    }
    try {
      if (action === "submit") {
        if (a.state === "draft") instance = await flowable.start(a.code, { applicant: a.owner, coop: a.coop ?? "", profile: a.profile });
        else await flowable.complete(instance, "reviseByApplicant");
      } else {
        const vars = t.decision ? { decision: t.decision, reviewer: user.name } : { recognized: result.recognized, recordedBy: user.name };
        await flowable.complete(instance, t.task, vars);
      }
    } catch (e) {
      console.error("[trace-api] lỗi Flowable:", e.message);
      throw new HttpError(502, "Không điều khiển được quy trình trong Flowable, hồ sơ giữ nguyên trạng thái");
    }
    await client.query("UPDATE ocop_applications SET state = $1, flowable_instance = $2, updated_at = now() WHERE id = $3", [to, instance, a.id]);
    await client.query("INSERT INTO ocop_application_history (application_id, action, from_state, to_state, actor, note) VALUES ($1,$2,$3,$4,$5,$6)", [a.id, action, a.state, to, user.name, note]);
    if (result) {
      await client.query(
        "INSERT INTO ocop_results (application_id, score, stars, authority, decision_no, decided_at, valid_until, recognized, recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [a.id, result.score, result.stars, result.authority, result.decisionNo, result.decidedAt, result.validUntil, result.recognized, user.name],
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  return getApplication(code, user);
}

// ---------- Tệp đính kèm hồ sơ OCOP (G2.4) ----------
// Trình duyệt gửi nội dung thô; trace-api kiểm quyền, kiểm loại/cỡ/băm rồi ghi vào bucket tệp bằng tài khoản riêng (trace-docs).
// Bucket tệp bị cổng gác chặn với mọi người dùng cuối: tệp chỉ lấy ra được qua API này sau khi kiểm quyền xem hồ sơ.
async function readBuffer(req, limit) {
  const chunks = [];
  let size = 0;
  // Quá cỡ thì vẫn đọc hết thân yêu cầu (bỏ dữ liệu, không giữ trong bộ nhớ) rồi mới trả 413: ngắt giữa chừng làm trình duyệt
  // thấy kết nối bị cắt thay vì thông báo lỗi. Độ lớn tối đa của thân do cổng gác giới hạn.
  for await (const chunk of req) {
    size += chunk.length;
    if (size <= limit) chunks.push(chunk);
  }
  if (size > limit) throw new HttpError(413, `Tệp quá lớn (tối đa ${Math.floor(limit / 1024 / 1024)} MB)`);
  return Buffer.concat(chunks);
}

const attachmentView = (r) => ({ id: r.id, doc_key: r.doc_key, filename: r.filename, content_type: r.content_type, size: r.size, sha256: r.sha256, uploaded_by: r.uploaded_by, created_at: r.created_at });

async function loadWritableApplication(code, user) {
  const a = await findApplicationRow(code);
  if (!a || !access.authorize(ACCESS, user, "application.read", appResource(a))) throw new HttpError(404, "Không tìm thấy hồ sơ");
  requirePermission(user, "application.update", appResource(a));
  if (!["draft", "needs_revision"].includes(a.state)) throw new HttpError(409, `Hồ sơ đang ở trạng thái "${a.state}", không đổi được tệp đính kèm`);
  if (!docsS3) throw new HttpError(503, "Chưa cấu hình tài khoản ghi tệp cho trace-api (DOCS_S3_ACCESS_KEY, DOCS_S3_SECRET_KEY)");
  return a;
}

async function uploadAttachment(code, query, req, user) {
  const a = await loadWritableApplication(code, user);
  const profile = ocop.getProfile(OCOP, a.profile);
  const rules = profile.attachments;
  const docKey = str(query.get("doc"), 60, "doc", true);
  if (!ocop.checklistFor(profile, a.product_group).some((c) => c.key === docKey)) throw new HttpError(400, "Giấy tờ không có trong danh mục của hồ sơ này");
  const { rows: cnt } = await pool.query("SELECT count(*)::int AS n FROM application_attachments WHERE application_id = $1 AND removed_at IS NULL", [a.id]);
  if (cnt[0].n >= rules.maxPerApplication) throw new HttpError(409, `Mỗi hồ sơ tối đa ${rules.maxPerApplication} tệp`);
  const buf = await readBuffer(req, rules.maxBytes);
  let info;
  try {
    info = attachments.inspect(buf, req.headers["content-type"], query.get("name") ?? "", rules);
  } catch (e) {
    if (e instanceof attachments.AttachmentError) throw new HttpError(e.status, e.message);
    throw e;
  }
  const dup = await pool.query("SELECT 1 FROM application_attachments WHERE application_id = $1 AND doc_key = $2 AND sha256 = $3 AND removed_at IS NULL", [a.id, docKey, info.sha256]);
  if (dup.rowCount) throw new HttpError(409, "Tệp này đã được đính kèm cho giấy tờ này");
  // quét mã độc TRƯỚC khi ghi bất cứ thứ gì vào kho tệp
  let scanEngine = null;
  if (scanner) {
    try {
      const r = await scanner.scan(buf);
      if (!r.clean) throw new HttpError(422, `Tệp bị chặn vì nghi chứa mã độc (${r.signature})`);
      scanEngine = "clamav";
    } catch (e) {
      if (e instanceof HttpError) throw e;
      console.error("[trace-api] không quét được tệp bằng ClamAV:", e.message);
      if (SCAN_REQUIRED) throw new HttpError(503, "Dịch vụ quét mã độc chưa sẵn sàng, vui lòng thử lại sau ít phút");
    }
  }
  const key = attachments.objectKey(a.code, docKey, info.sha256, info.name);
  try {
    await docsS3.putObject(key, buf, info.type);
  } catch (e) {
    console.error("[trace-api] lỗi ghi tệp lên MinIO:", e.message);
    throw new HttpError(502, "Không lưu được tệp vào kho lưu trữ");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO application_attachments (application_id, doc_key, filename, content_type, size, sha256, object_key, uploaded_by, scan_engine, scanned_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, CASE WHEN $9::text IS NULL THEN NULL ELSE now() END) RETURNING id, doc_key, filename, content_type, size, sha256, uploaded_by, created_at`,
      [a.id, docKey, info.name, info.type, info.size, info.sha256, key, user.name, scanEngine],
    );
    // có tệp minh chứng thì giấy tờ được coi là đã có
    await client.query(
      "UPDATE ocop_applications SET documents = CASE WHEN documents @> to_jsonb($1::text) THEN documents ELSE documents || to_jsonb($1::text) END, updated_at = now() WHERE id = $2",
      [docKey, a.id],
    );
    await client.query("INSERT INTO ocop_application_history (application_id, action, from_state, to_state, actor, note) VALUES ($1,'attach',$2,$2,$3,$4)", [a.id, a.state, user.name, `${docKey}: ${info.name}`]);
    await client.query("COMMIT");
    return attachmentView(rows[0]);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function removeAttachment(code, id, user) {
  const a = await loadWritableApplication(code, user);
  const { rows } = await pool.query(
    "UPDATE application_attachments SET removed_at = now(), removed_by = $3 WHERE id = $1 AND application_id = $2 AND removed_at IS NULL RETURNING doc_key, filename",
    [Number(id) || 0, a.id, user.name],
  );
  if (!rows.length) throw new HttpError(404, "Không tìm thấy tệp");
  await pool.query("INSERT INTO ocop_application_history (application_id, action, from_state, to_state, actor, note) VALUES ($1,'detach',$2,$2,$3,$4)", [a.id, a.state, user.name, `${rows[0].doc_key}: ${rows[0].filename}`]);
  return { removed: true };
}

async function downloadAttachment(code, id, user, res) {
  const a = await findApplicationRow(code);
  if (!a || !access.authorize(ACCESS, user, "application.read", appResource(a))) throw new HttpError(404, "Không tìm thấy hồ sơ");
  if (!docsS3) throw new HttpError(503, "Chưa cấu hình kho lưu trữ tệp");
  const { rows } = await pool.query("SELECT filename, content_type, size, sha256, object_key FROM application_attachments WHERE id = $1 AND application_id = $2 AND removed_at IS NULL", [Number(id) || 0, a.id]);
  if (!rows.length) throw new HttpError(404, "Không tìm thấy tệp");
  const r = rows[0];
  let buf;
  try {
    buf = await docsS3.getObjectBuffer(r.object_key);
  } catch (e) {
    console.error("[trace-api] lỗi đọc tệp từ MinIO:", e.message);
    throw new HttpError(502, "Không đọc được tệp từ kho lưu trữ");
  }
  // kiểm tra toàn vẹn: nội dung phải khớp băm lúc tải lên
  if (crypto.createHash("sha256").update(buf).digest("hex") !== r.sha256) {
    console.error(`[trace-api] CẢNH BÁO: tệp ${r.object_key} không khớp băm đã lưu`);
    throw new HttpError(500, "Tệp không toàn vẹn (không khớp băm lúc tải lên)");
  }
  const disposition = r.content_type.startsWith("image/") ? "inline" : "attachment";
  res.writeHead(200, {
    "content-type": r.content_type,
    "content-length": buf.length,
    "content-disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(r.filename)}`,
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "cache-control": "private, no-store",
    "x-sha256": r.sha256,
  });
  res.end(buf);
}

// ---------- Vòng đời dữ liệu: lưu trữ nóng -> lạnh ----------
const ARCHIVE_KEEP_DAYS = lifecycle.validateKeepDays(process.env.ARCHIVE_KEEP_DAYS ?? 90);
const ARCHIVE_INTERVAL_HOURS = Number(process.env.ARCHIVE_INTERVAL_HOURS ?? 24);

async function runArchive(triggeredBy, keepDays, application) {
  if (!docsS3) throw new HttpError(503, "Chưa cấu hình kho lưu trữ (DOCS_S3_ACCESS_KEY, DOCS_S3_SECRET_KEY)");
  try {
    return await lifecycle.archiveApplicationHistory(pool, docsS3, { keepDays, application: application || null, triggeredBy });
  } catch (e) {
    if (e instanceof HttpError) throw e;
    console.error("[trace-api] lỗi lưu trữ:", e.message);
    throw new HttpError(502, "Lưu trữ thất bại, dữ liệu ở tầng nóng được giữ nguyên");
  }
}

async function archiveOverview(user) {
  requirePermission(user, "archive.manage");
  return {
    policy: { keep_days: ARCHIVE_KEEP_DAYS, interval_hours: ARCHIVE_INTERVAL_HOURS, enabled: Boolean(docsS3), source: "ocop_application_history", terminal_states: lifecycle.TERMINAL_STATES },
    runs: await lifecycle.listRuns(pool),
  };
}

function startArchiveScheduler() {
  if (!docsS3 || !(ARCHIVE_INTERVAL_HOURS > 0)) return;
  const tick = () =>
    runArchive("scheduler", ARCHIVE_KEEP_DAYS)
      .then((r) => r && !r.skipped && console.log(`[trace-api] lưu trữ tự động: ${r.rows} bản ghi, ${r.applications} hồ sơ, đối tượng ${r.object_key}`))
      .catch((e) => console.error("[trace-api] lưu trữ tự động lỗi:", e.message));
  setTimeout(tick, 60_000).unref();
  setInterval(tick, ARCHIVE_INTERVAL_HOURS * 3600_000).unref();
}

// ---------- Trợ lý hỏi đáp (tra cứu có nguồn) và tác tử đề xuất có người duyệt ----------
// Kho tri thức dựng từ chính cấu hình (quy định OCOP, hồ sơ nung, vai trò) và config/assistant-faq.json; không sinh văn bản tự do.
const ASSISTANT = assistant.buildIndex(
  assistant.buildKnowledge({
    profile: ocop.getProfile(OCOP),
    kilnCfg: KILN,
    accessCfg: ACCESS,
    faq: assistant.loadFaq(process.env.ASSISTANT_FAQ_FILE ?? "/app/config/assistant-faq.json"),
  }),
);

/** Quét các công đoạn nung có bằng chứng IoT, tạo đề xuất (chờ duyệt) cho mẻ cần xem lại hoặc cảnh báo. onlyEventId: chỉ xét một sự kiện. Trả { scanned, created }. */
async function agentScan(onlyEventId = null) {
  const { rows } = await pool.query(
    `SELECT e.id, e.iot, p.code, p.name, p.category, c.code AS coop
     FROM trace_events e JOIN products p ON p.id = e.product_id LEFT JOIN cooperatives c ON c.id = p.coop_id
     WHERE e.iot IS NOT NULL ORDER BY e.id`,
  );
  const peaksByDevice = new Map();
  for (const r of rows) peaksByDevice.set(r.iot.deviceId, [...(peaksByDevice.get(r.iot.deviceId) ?? []), { id: r.id, peak: r.iot.max }]);
  let created = 0;
  let scanned = 0;
  for (const r of rows) {
    if (onlyEventId !== null && r.id !== onlyEventId) continue;
    scanned++;
    const insight = kiln.analyze(r.iot, kiln.pickProfile(KILN, r.category), { baselinePeaks: peaksByDevice.get(r.iot.deviceId).filter((x) => x.id !== r.id).map((x) => x.peak) });
    const p = agent.proposeFromKiln({ product: { code: r.code, name: r.name, coop: r.coop }, eventId: r.id, insight });
    if (!p) continue;
    const ins = await pool.query(
      `INSERT INTO agent_proposals (dedupe_key, kind, severity, title, rationale, subject, coop, action) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (dedupe_key) DO NOTHING`,
      [p.dedupe_key, p.kind, p.severity, p.title, p.rationale, p.subject, p.coop, JSON.stringify(p.action)],
    );
    created += ins.rowCount;
  }
  return { scanned, created };
}

/** Đề xuất mà người dùng được xem: người có quyền duyệt hồ sơ (quản trị: tất cả; cán bộ HTX: của HTX mình). */
async function visibleProposals(user) {
  // chỉ cần CÓ quyền duyệt (mọi phạm vi); phạm vi HTX được lọc theo từng đề xuất bên dưới (requirePermission không kèm tài nguyên sẽ từ chối phạm vi coop)
  if (!access.canApi(ACCESS, user.roles) || !access.scopeFor(ACCESS, user.roles, "application.review")) throw new HttpError(403, "Vai trò của bạn không có quyền duyệt đề xuất");
  const { rows } = await pool.query(
    "SELECT id, kind, severity, title, rationale, subject, coop, status, created_at, decided_by, decided_at, decision_note FROM agent_proposals ORDER BY (status = 'pending') DESC, id DESC LIMIT 100",
  );
  return rows.filter((r) => access.authorize(ACCESS, user, "application.review", { coop: r.coop }));
}

/** Người duyệt chọn duyệt hoặc từ chối một đề xuất. Duyệt thì hành động (gửi thông báo) được thực hiện trong cùng giao dịch. */
async function decideProposal(user, id, decision, note) {
  if (!["approve", "reject"].includes(decision)) throw new HttpError(400, "decision phải là approve hoặc reject");
  const text = str(note, 500, "note");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT * FROM agent_proposals WHERE id = $1 FOR UPDATE", [Number(id) || 0]);
    const p = rows[0];
    if (!p || !access.authorize(ACCESS, user, "application.review", { coop: p.coop })) {
      await client.query("ROLLBACK");
      throw new HttpError(404, "Không tìm thấy đề xuất"); // không lộ sự tồn tại
    }
    requirePermission(user, "application.review", { coop: p.coop });
    if (p.status !== "pending") {
      await client.query("ROLLBACK");
      throw new HttpError(409, `Đề xuất đã được ${p.status === "approved" ? "duyệt" : "từ chối"} trước đó`);
    }
    await client.query("UPDATE agent_proposals SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4 WHERE id = $1", [p.id, decision === "approve" ? "approved" : "rejected", user.name, text]);
    if (decision === "approve") {
      const n = agent.notificationFor(p);
      await client.query(
        "INSERT INTO notifications (dedupe_key, kind, level, title, body, link, for_user, for_role, for_coop) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (dedupe_key) DO NOTHING",
        [n.dedupe_key, n.kind, n.level, n.title, n.body, n.link, n.for_user, n.for_role, n.for_coop],
      );
    }
    await client.query("COMMIT");
    return { id: p.id, status: decision === "approve" ? "approved" : "rejected" };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// ---------- Hồ dữ liệu phân tích (Parquet + DuckDB) và truy vết nguồn gốc dữ liệu ----------
const LAKE_INTERVAL_HOURS = Number(process.env.LAKE_INTERVAL_HOURS ?? 24);

const lakeDeps = () => ({
  pool,
  s3: docsS3,
  kiln: { analyze: kiln.analyze, pickProfile: kiln.pickProfile, config: KILN },
  readArchive: (id) => lifecycle.readRun(pool, docsS3, id),
});

async function runLakeExport(triggeredBy) {
  if (!docsS3) throw new HttpError(503, "Chưa cấu hình kho lưu trữ (DOCS_S3_ACCESS_KEY, DOCS_S3_SECRET_KEY)");
  try {
    return await lake.exportAll(lakeDeps(), triggeredBy);
  } catch (e) {
    console.error("[trace-api] lỗi xuất hồ dữ liệu:", e.message);
    throw new HttpError(502, "Xuất hồ dữ liệu thất bại, dữ liệu nguồn không bị ảnh hưởng");
  }
}

function startLakeScheduler() {
  if (!docsS3 || !(LAKE_INTERVAL_HOURS > 0)) return;
  const tick = () =>
    runLakeExport("scheduler")
      .then((r) => r.exported && console.log(`[trace-api] xuất hồ dữ liệu: ${r.exported.map((d) => `${d.dataset}=${d.rows}`).join(", ")}`))
      .catch((e) => console.error("[trace-api] xuất hồ dữ liệu tự động lỗi:", e.message));
  setTimeout(tick, 120_000).unref();
  setInterval(tick, LAKE_INTERVAL_HOURS * 3600_000).unref();
}

// ---------- Thông báo, nhắc hạn, leo thang ----------
const NOTIFY_INTERVAL_MINUTES = Number(process.env.NOTIFY_INTERVAL_MINUTES ?? 60);

/** Quét hồ sơ, tạo thông báo còn thiếu (mỗi sự việc đúng một lần nhờ dedupe_key). Trả { scanned, created }. */
async function scanReminders() {
  const { rows } = await pool.query(
    `SELECT a.code, a.product_name, a.owner_username AS owner, c.code AS coop, a.state, a.profile,
       (SELECT max(h.created_at) FROM ocop_application_history h WHERE h.application_id = a.id AND h.to_state = a.state AND h.action <> 'archive') AS state_since,
       (SELECT r.valid_until FROM ocop_results r WHERE r.application_id = a.id AND r.recognized ORDER BY r.id DESC LIMIT 1) AS valid_until
     FROM ocop_applications a LEFT JOIN cooperatives c ON c.id = a.coop_id
     WHERE a.state IN ('in_review','needs_revision','awaiting_result','recognized')`,
  );
  const now = new Date();
  let created = 0;
  for (const a of rows) {
    for (const n of reminders.computeReminders(now, [a], ocop.getProfile(OCOP, a.profile))) {
      created += await insertNotification(n);
    }
  }
  return { scanned: rows.length, created };
}

/** Thêm một thông báo; trả 1 nếu mới, 0 nếu đã có (cùng dedupe_key). */
async function insertNotification(n) {
  const r = await pool.query(
    `INSERT INTO notifications (dedupe_key, kind, level, title, body, link, for_user, for_role, for_coop)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (dedupe_key) DO NOTHING`,
    [n.dedupe_key, n.kind, n.level, n.title, n.body, n.link ?? null, n.for_user ?? null, n.for_role ?? null, n.for_coop ?? null],
  );
  return r.rowCount;
}

/** Thông báo người dùng được thấy: gửi cho chính họ, hoặc cho vai trò của họ (nếu gắn HTX thì chỉ HTX đó, trừ vai trò có phạm vi toàn hệ thống). */
async function visibleNotifications(user, limit = 300) {
  const roles = [...access.expand(ACCESS, user.roles)];
  const seeAll = access.scopeFor(ACCESS, user.roles, "application.read") === "all";
  const { rows } = await pool.query(
    `SELECT n.id, n.kind, n.level, n.title, n.body, n.link, n.for_user, n.for_coop, n.created_at, (r.username IS NOT NULL) AS read
     FROM notifications n LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.username = $1
     WHERE n.for_user = $1 OR n.for_role = ANY($2::text[])
     ORDER BY n.created_at DESC, n.id DESC LIMIT $3`,
    [user.name, roles, limit],
  );
  return rows.filter((n) => n.for_user === user.name || !n.for_coop || seeAll || n.for_coop === user.coop).map(({ for_user: _u, for_coop: _c, ...n }) => n);
}

async function listNotifications(user) {
  const all = await visibleNotifications(user);
  return { unread: all.filter((n) => !n.read).length, notifications: all.slice(0, 50) };
}

async function markNotificationsRead(user, id) {
  const visible = await visibleNotifications(user);
  const ids = id === null ? visible.filter((n) => !n.read).map((n) => n.id) : visible.filter((n) => String(n.id) === String(id)).map((n) => n.id);
  if (id !== null && !ids.length) throw new HttpError(404, "Không tìm thấy thông báo");
  if (ids.length) await pool.query("INSERT INTO notification_reads (notification_id, username) SELECT unnest($1::bigint[]), $2 ON CONFLICT DO NOTHING", [ids, user.name]);
  return { marked: ids.length };
}

function startNotifyScheduler() {
  if (!(NOTIFY_INTERVAL_MINUTES > 0)) return;
  const tick = () =>
    scanReminders()
      .then((r) => r.created && console.log(`[trace-api] nhắc hạn: ${r.created} thông báo mới (quét ${r.scanned} hồ sơ)`))
      .catch((e) => console.error("[trace-api] quét nhắc hạn lỗi:", e.message));
  setTimeout(tick, 45_000).unref();
  setInterval(tick, NOTIFY_INTERVAL_MINUTES * 60_000).unref();
}

// ---------- Neo băm nhật ký kiểm toán ----------
const ANCHOR_INTERVAL_MINUTES = Number(process.env.ANCHOR_INTERVAL_MINUTES ?? 60);

async function runAnchor() {
  if (!anchorS3) throw new HttpError(503, "Chưa cấu hình kho neo nhật ký (ANCHOR_S3_ACCESS_KEY, ANCHOR_S3_SECRET_KEY)");
  try {
    return await audit.writeAnchor(pool, anchorS3);
  } catch (e) {
    console.error("[trace-api] lỗi neo nhật ký:", e.message);
    throw new HttpError(502, "Không ghi được bản neo vào kho khóa chống sửa");
  }
}

function startAnchorScheduler() {
  if (!anchorS3 || !(ANCHOR_INTERVAL_MINUTES > 0)) return;
  const tick = () =>
    runAnchor()
      .then((r) => r && !r.skipped && console.log(`[trace-api] neo nhật ký: dòng #${r.id}`))
      .catch((e) => console.error("[trace-api] neo nhật ký lỗi:", e.message));
  setTimeout(tick, 90_000).unref();
  setInterval(tick, ANCHOR_INTERVAL_MINUTES * 60_000).unref();
}

async function verifyAudit() {
  const chain = await audit.verifyChain(pool);
  if (!anchorS3) return { ...chain, anchors: { enabled: false } };
  let anchors;
  try {
    anchors = { enabled: true, ...(await audit.verifyAnchors(pool, anchorS3)) };
  } catch (e) {
    console.error("[trace-api] không đọc được bản neo:", e.message);
    anchors = { enabled: true, ok: false, checked: 0, latest: null, broken: { id: 0, reason: "Không đọc được kho bản neo, chưa thể đối chiếu" } };
  }
  return { ...chain, ok: chain.ok && anchors.ok, broken: chain.broken ?? (anchors.ok ? null : anchors.broken), anchors };
}

// ---------- Nhật ký kiểm toán ----------
/** Nhận lô nhật ký từ http-logger của APISIX (mạng nội bộ). Chỉ chấp nhận khi có đúng khóa AUDIT_INGEST_KEY. */
async function ingestAudit(req) {
  const key = process.env.AUDIT_INGEST_KEY ?? "";
  const given = Buffer.from(req.headers.authorization ?? "");
  const want = Buffer.from(`Bearer ${key}`);
  if (!key || given.length !== want.length || !crypto.timingSafeEqual(given, want)) throw new HttpError(401, "Không hợp lệ");
  const body = await readJson(req);
  const list = (Array.isArray(body) ? body : [body]).slice(0, 200);
  const entries = list.map(audit.normalize).filter(Boolean).filter(audit.shouldKeep);
  return { received: list.length, accepted: await audit.appendEntries(pool, entries) };
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
    return send(res, 200, { username: user.name, roles: user.roles, coop: user.coop, permissions: access.permissionsOf(ACCESS, user.roles), pages: access.pagesOf(ACCESS, user.roles) });
  }

  if (parts[0] === "assistant" && parts[1] === "ask" && parts.length === 2 && m === "POST") {
    const user = getUser(req);
    if (!access.canApi(ACCESS, user.roles)) throw new HttpError(403, "Vai trò của bạn không dùng được API này");
    const body = await readJson(req);
    return send(res, 200, assistant.ask(ASSISTANT, body?.question));
  }

  if (parts[0] === "agent") {
    const user = getUser(req);
    if (!access.canApi(ACCESS, user.roles)) throw new HttpError(403, "Vai trò của bạn không dùng được API này");
    if (parts.length === 2 && parts[1] === "proposals" && m === "GET") return send(res, 200, { proposals: await visibleProposals(user) });
    if (parts.length === 4 && parts[1] === "proposals" && parts[3] === "decide" && m === "POST") {
      const b = await readJson(req);
      return send(res, 200, await decideProposal(user, parts[2], b?.decision, b?.note));
    }
    if (parts.length === 2 && parts[1] === "scan" && m === "POST") {
      requirePermission(user, "audit.read"); // chỉ quản trị quét tay
      return send(res, 200, await agentScan());
    }
  }

  if (parts[0] === "lake") {
    const user = getUser(req);
    if (!access.canApi(ACCESS, user.roles)) throw new HttpError(403, "Vai trò của bạn không dùng được API này");
    requirePermission(user, "archive.manage"); // hồ dữ liệu: chỉ quản trị
    if (parts.length === 1 && m === "GET") return send(res, 200, await lake.overview(pool));
    if (parts.length === 2 && parts[1] === "export" && m === "POST") return send(res, 200, await runLakeExport(user.name));
    if (parts.length === 3 && parts[1] === "analytics" && m === "GET") {
      if (!docsS3) throw new HttpError(503, "Chưa cấu hình kho lưu trữ");
      let r;
      try {
        r = await lake.runAnalytics(pool, docsS3, parts[2]);
      } catch (e) {
        console.error("[trace-api] lỗi truy vấn hồ dữ liệu:", e.message);
        throw new HttpError(502, "Không truy vấn được hồ dữ liệu");
      }
      if (!r) throw new HttpError(404, "Không có truy vấn phân tích này");
      return send(res, 200, r);
    }
  }

  if (parts[0] === "notifications") {
    const user = getUser(req);
    if (!access.canApi(ACCESS, user.roles)) throw new HttpError(403, "Vai trò của bạn không dùng được API này");
    if (parts.length === 1 && m === "GET") return send(res, 200, await listNotifications(user));
    if (parts.length === 2 && parts[1] === "scan" && m === "POST") {
      requirePermission(user, "audit.read"); // chỉ quản trị quét tay
      return send(res, 200, await scanReminders());
    }
    if (parts.length === 2 && parts[1] === "read-all" && m === "POST") return send(res, 200, await markNotificationsRead(user, null));
    if (parts.length === 3 && parts[2] === "read" && m === "POST") return send(res, 200, await markNotificationsRead(user, parts[1]));
  }

  if (parts[0] === "insights" && parts[1] === "kilns" && parts.length === 2 && m === "GET") {
    const user = getUser(req);
    if (!access.canApi(ACCESS, user.roles)) throw new HttpError(403, "Vai trò của bạn không dùng được API này");
    return send(res, 200, await kilnInsights(user));
  }

  if (parts[0] === "sectors" && parts.length === 1 && m === "GET") {
    const user = getUser(req);
    if (!access.canApi(ACCESS, user.roles)) throw new HttpError(403, "Vai trò của bạn không dùng được API này");
    return send(res, 200, sectors.publicView(SECTORS));
  }

  if (parts[0] === "products") {
    const user = getUser(req);
    if (!access.canApi(ACCESS, user.roles)) throw new HttpError(403, "Vai trò của bạn không dùng được API này"); // token thiết bị (iot-writer) không đọc được dữ liệu nghiệp vụ
    if (parts.length === 1 && m === "GET") return send(res, 200, { stages: STAGES, sectors: sectors.publicView(SECTORS).sectors, products: await listProducts(user) });
    if (parts.length === 1 && m === "POST") return send(res, 201, await createProduct(await readJson(req), user));
    if (parts.length === 2 && m === "GET") return send(res, 200, await getProduct(parts[1], { user }));
    if (parts.length === 3 && parts[2] === "events" && m === "POST") return send(res, 201, await addEvent(parts[1], await readJson(req), user));
  }
  if (parts[0] === "internal" && parts[1] === "audit" && parts.length === 2 && m === "POST") return send(res, 202, await ingestAudit(req));

  if (parts[0] === "audit") {
    const user = getUser(req);
    if (!access.canApi(ACCESS, user.roles)) throw new HttpError(403, "Vai trò của bạn không dùng được API này");
    requirePermission(user, "audit.read");
    if (parts.length === 1 && m === "GET") {
      const q = url.searchParams;
      const before = Number.parseInt(q.get("before") ?? "", 10);
      return send(res, 200, {
        rows: await audit.query(pool, { actor: q.get("actor"), method: q.get("method"), statusClass: q.get("status_class"), q: q.get("q"), before: Number.isInteger(before) ? before : undefined, limit: q.get("limit") }),
      });
    }
    if (parts.length === 2 && parts[1] === "verify" && m === "GET") return send(res, 200, await verifyAudit());
    if (parts.length === 2 && parts[1] === "anchor" && m === "POST") return send(res, 200, (await runAnchor()) ?? { skipped: "empty" });
  }

  if (parts[0] === "overview" && parts.length === 1 && m === "GET") {
    const user = getUser(req);
    if (!access.canApi(ACCESS, user.roles)) throw new HttpError(403, "Vai trò của bạn không dùng được API này");
    return send(res, 200, await overviewFor(user));
  }

  if (parts[0] === "archive") {
    const user = getUser(req);
    if (!access.canApi(ACCESS, user.roles)) throw new HttpError(403, "Vai trò của bạn không dùng được API này");
    if (parts.length === 1 && m === "GET") return send(res, 200, await archiveOverview(user));
    if (parts.length === 2 && parts[1] === "run" && m === "POST") {
      requirePermission(user, "archive.manage");
      const body = await readJson(req);
      let keepDays = ARCHIVE_KEEP_DAYS;
      if (body.keep_days !== undefined) {
        try {
          keepDays = lifecycle.validateKeepDays(body.keep_days);
        } catch (e) {
          throw new HttpError(400, e.message);
        }
      }
      const application = body.application ? str(body.application, 60, "application") : null;
      return send(res, 200, { result: await runArchive(user.name, keepDays, application), ...(await archiveOverview(user)) });
    }
    if (parts.length === 3 && parts[2] === "rows" && m === "GET") {
      requirePermission(user, "archive.manage");
      if (!docsS3) throw new HttpError(503, "Chưa cấu hình kho lưu trữ");
      let rows;
      try {
        rows = await lifecycle.readRun(pool, docsS3, parts[1]);
      } catch (e) {
        console.error("[trace-api] lỗi đọc bản lưu trữ:", e.message);
        throw new HttpError(502, "Không đọc được bản lưu trữ (hoặc không khớp băm)");
      }
      if (!rows) throw new HttpError(404, "Không có lần lưu trữ này");
      return send(res, 200, { rows: rows.slice(0, 200), total: rows.length });
    }
  }
  if (parts[0] === "applications") {
    const user = getUser(req);
    if (!access.canApi(ACCESS, user.roles)) throw new HttpError(403, "Vai trò của bạn không dùng được API này");
    if (parts.length === 2 && parts[1] === "profile" && m === "GET") return send(res, 200, profileView());
    if (parts.length === 1 && m === "GET") return send(res, 200, { applications: await listApplications(user) });
    if (parts.length === 1 && m === "POST") return send(res, 201, await createApplication(await readJson(req), user));
    if (parts.length === 2 && m === "GET") return send(res, 200, await getApplication(parts[1], user));
    if (parts.length === 2 && m === "PUT") return send(res, 200, await updateApplication(parts[1], await readJson(req), user));
    if (parts.length === 3 && parts[2] === "actions" && m === "POST") return send(res, 200, await applicationAction(parts[1], await readJson(req), user));
    if (parts.length === 3 && parts[2] === "attachments" && m === "POST") return send(res, 201, await uploadAttachment(parts[1], url.searchParams, req, user));
    if (parts.length === 4 && parts[2] === "attachments" && m === "DELETE") return send(res, 200, await removeAttachment(parts[1], parts[3], user));
    if (parts.length === 5 && parts[2] === "attachments" && parts[4] === "file" && m === "GET") return downloadAttachment(parts[1], parts[3], user, res);
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
  startArchiveScheduler();
  startAnchorScheduler();
  startNotifyScheduler();
  startLakeScheduler();
  server.listen(PORT, () => console.log(`[trace-api] lắng nghe cổng ${PORT}, database "${DB_NAME}"`));
}

main().catch((e) => {
  console.error("[trace-api] không khởi động được:", e);
  process.exit(1);
});
