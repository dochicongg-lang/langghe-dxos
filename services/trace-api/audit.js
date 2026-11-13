"use strict";
/**
 * Nhật ký kiểm toán hành vi API.
 *
 * Nguồn: plugin http-logger của APISIX gửi từng lô yêu cầu về /internal/audit (mạng nội bộ, có khóa). Chỉ ghi cái cần để kiểm toán,
 * KHÔNG lưu token. Danh tính do Lua ở cổng gác gắn vào tiêu đề X-Audit-User/X-Audit-Roles (luôn ghi đè giá trị client gửi) và chỉ
 * được TIN ở hai route có Lua đó (trace-api, workflow-api). Lua chạy trước bước xác thực chữ ký, nên với yêu cầu bị từ chối (status >= 400)
 * danh tính chỉ là tự khai: ghi kèm verified = false. Yêu cầu thành công thì token đã qua xác thực nên verified = true.
 *
 * Bất biến: mỗi dòng mang băm nối với dòng trước (chuỗi băm). verifyChain phát hiện sửa/xóa/chèn dòng dù trigger của CSDL bị vượt qua.
 */
const crypto = require("node:crypto");

const GENESIS = "0".repeat(64);
const LOCK_KEY = 727002; // khóa tư vấn: tuần tự hóa việc nối chuỗi
const ACTOR_ROUTES = ["trace-api", "workflow-api"]; // chỉ tin danh tính ở các route có Lua gắn tiêu đề

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const clip = (v, n) => String(v ?? "").slice(0, n);

/** Chuẩn hóa một dòng nhật ký thô từ http-logger; trả null nếu không hợp lệ. */
function normalize(raw) {
  if (!raw || typeof raw !== "object") return null;
  const method = clip(raw.method, 10).toUpperCase();
  const status = Number.parseInt(raw.status, 10);
  if (!/^[A-Z]{3,10}$/.test(method) || !Number.isInteger(status) || status < 100 || status > 599) return null;
  let ts = new Date(raw.time);
  if (Number.isNaN(ts.getTime())) ts = new Date();
  const route = clip(raw.route, 40);
  let actor = null;
  let roles = [];
  if (ACTOR_ROUTES.includes(route)) {
    const a = String(raw.audit_user ?? "").trim();
    if (/^[\w.@-]{1,64}$/.test(a)) actor = a;
    roles = String(raw.audit_roles ?? "").split(",").map((r) => r.trim()).filter((r) => /^[\w-]{1,40}$/.test(r)).slice(0, 10);
  }
  return {
    ts: new Date(ts.getTime()), // độ chính xác mili giây (khớp với băm khi đọc lại từ CSDL)
    actor,
    roles,
    verified: Boolean(actor) && status < 400,
    ip: clip(raw.client_ip, 64),
    method,
    path: clip(raw.uri, 300),
    status,
    route,
    latencyMs: Math.max(0, Math.min(3_600_000, Math.round(Number(raw.request_time) * 1000) || 0)),
  };
}

/** Giữ lại gì: trace-api mọi yêu cầu; workflow chỉ ghi/đổi hoặc bị từ chối; các route khác chỉ khi bị từ chối. Bỏ OPTIONS (CORS). */
function shouldKeep(e) {
  if (!e || e.method === "OPTIONS") return false;
  if (e.route === "trace-api") return true;
  if (e.route === "workflow-api") return !["GET", "HEAD"].includes(e.method) || e.status >= 400;
  return e.status >= 400;
}

/** Băm của một dòng, nối với băm dòng trước. Mọi trường phải tái lập được từ cột trong CSDL. */
function entryHash(prev, e) {
  return sha256(JSON.stringify([prev, new Date(e.ts).toISOString(), e.actor ?? "", e.roles.join(","), Boolean(e.verified), e.ip, e.method, e.path, e.status, e.route, e.latencyMs]));
}

/** Nối các dòng đã chuẩn hóa vào cuối chuỗi (một giao dịch, tuần tự hóa bằng khóa tư vấn). Trả về số dòng đã ghi. */
async function appendEntries(pool, entries) {
  if (!entries.length) return 0;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [LOCK_KEY]);
    const last = await client.query("SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1");
    let prev = last.rows[0]?.hash ?? GENESIS;
    for (const e of entries) {
      const hash = entryHash(prev, e);
      await client.query(
        "INSERT INTO audit_log (ts, actor, roles, verified, ip, method, path, status, route, latency_ms, prev_hash, hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
        [e.ts, e.actor, e.roles.join(","), e.verified, e.ip, e.method, e.path, e.status, e.route, e.latencyMs, prev, hash],
      );
      prev = hash;
    }
    await client.query("COMMIT");
    return entries.length;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Dựng lại chuỗi băm từ các dòng (đã sắp theo id tăng dần). Trả { ok, rows, broken: null | { id, reason } }. */
function checkRows(rows) {
  let prev = GENESIS;
  for (const r of rows) {
    if (r.prev_hash !== prev) return { ok: false, rows: rows.length, broken: { id: Number(r.id), reason: "Liên kết với dòng trước bị đứt (có dòng bị xóa hoặc chèn)" } };
    const expect = entryHash(prev, { ts: r.ts, actor: r.actor, roles: r.roles ? String(r.roles).split(",") : [], verified: r.verified, ip: r.ip, method: r.method, path: r.path, status: r.status, route: r.route, latencyMs: r.latency_ms });
    if (expect !== r.hash) return { ok: false, rows: rows.length, broken: { id: Number(r.id), reason: "Nội dung dòng không khớp băm (đã bị sửa)" } };
    prev = r.hash;
  }
  return { ok: true, rows: rows.length, broken: null };
}

async function verifyChain(pool) {
  const { rows } = await pool.query("SELECT id, ts, actor, roles, verified, ip, method, path, status, route, latency_ms, prev_hash, hash FROM audit_log ORDER BY id");
  return checkRows(rows);
}

/** Truy vấn nhật ký (mới nhất trước) với bộ lọc đơn giản. */
async function query(pool, f = {}) {
  const where = [];
  const params = [];
  const add = (sql, v) => {
    params.push(v);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (f.actor) add("actor = ?", String(f.actor).slice(0, 64));
  if (f.method) add("method = ?", String(f.method).toUpperCase().slice(0, 10));
  if (/^[2-5]$/.test(String(f.statusClass ?? ""))) {
    params.push(Number(f.statusClass) * 100);
    where.push(`status >= $${params.length} AND status < $${params.length} + 100`);
  }
  if (f.q) add("path ILIKE ?", `%${String(f.q).replace(/[%_\\]/g, (c) => `\\${c}`).slice(0, 100)}%`);
  if (Number.isInteger(f.before) && f.before > 0) add("id < ?", f.before);
  const limit = Math.min(Math.max(Number.parseInt(f.limit, 10) || 100, 1), 500);
  const { rows } = await pool.query(
    `SELECT id, ts, actor, roles, verified, ip, method, path, status, route, latency_ms FROM audit_log ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT ${limit}`,
    params,
  );
  return rows;
}

module.exports = { GENESIS, normalize, shouldKeep, entryHash, appendEntries, checkRows, verifyChain, query };
