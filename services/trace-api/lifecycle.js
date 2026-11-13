"use strict";
/**
 * Vòng đời dữ liệu (nguyên lý "tự động đẩy dữ liệu lịch sử xuống kho lưu trữ mà không gây nghẽn lõi").
 *
 *   Tầng nóng  PostgreSQL: dữ liệu đang xử lý, truy vấn nhanh.
 *   Tầng lạnh  MinIO (bucket tệp, tiền tố archive/): NDJSON nén gzip, có băm SHA-256, đọc lại được để phân tích.
 *
 * Hiện lưu trữ lịch sử xử lý (ocop_application_history) của hồ sơ ĐÃ KẾT THÚC và đã quá hạn giữ ở tầng nóng.
 * Thứ tự an toàn: ghi lên kho lạnh -> ĐỌC LẠI và đối chiếu băm -> mới ghi sổ (archive_runs) và xóa ở tầng nóng trong MỘT giao dịch.
 * Lỗi ở bất kỳ bước nào trước giao dịch thì dữ liệu nóng giữ nguyên. Mỗi hồ sơ được ghi một dòng tóm tắt (action = archive) để
 * giao diện vẫn thấy lịch sử đã chuyển đi đâu; dòng này không bao giờ bị lưu trữ lại.
 */
const crypto = require("node:crypto");
const zlib = require("node:zlib");

const TERMINAL_STATES = ["rejected", "recognized", "not_recognized"];
const MAX_BATCH = 5000;
const LOCK_KEY = 727001; // khóa tư vấn: chỉ một tiến trình lưu trữ chạy tại một thời điểm
const SOURCE = "ocop_application_history";

const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");

/** Đóng gói các dòng thành NDJSON nén gzip. */
function pack(rows) {
  const buf = zlib.gzipSync(Buffer.from(rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8"));
  return { buf, sha256: sha256(buf) };
}

/** Giải nén NDJSON gzip thành mảng dòng. */
function unpack(buf) {
  return zlib.gunzipSync(buf).toString("utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

/** Khóa đối tượng: archive/<bảng>/<năm>/<tháng>/run-<thời điểm>-<8 ký tự băm>.ndjson.gz */
function objectKey(table, now, hash) {
  const iso = now.toISOString();
  return `archive/${table}/${iso.slice(0, 4)}/${iso.slice(5, 7)}/run-${iso.replace(/[-:.]/g, "").slice(0, 15)}-${hash.slice(0, 8)}.ndjson.gz`;
}

function validateKeepDays(v) {
  // null, chuỗi rỗng, true/false đổi sang số thành 0 hoặc 1: phải từ chối, nếu không thiếu tham số sẽ lưu trữ mọi thứ
  const n = v === null || v === "" || typeof v === "boolean" ? NaN : Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 3650) throw new Error("Số ngày giữ ở tầng nóng phải là số nguyên từ 0 đến 3650");
  return n;
}

/**
 * Lưu trữ một mẻ lịch sử hồ sơ đã kết thúc và quá keepDays ngày. Trả về null nếu không có gì để lưu,
 * { skipped: "busy" } nếu có tiến trình khác đang chạy, hoặc thông tin lần chạy.
 * opts: { keepDays, application (mã hồ sơ, tùy chọn), triggeredBy, now }.
 */
async function archiveApplicationHistory(pool, s3, opts) {
  const keepDays = validateKeepDays(opts.keepDays);
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - keepDays * 86400000);
  const client = await pool.connect();
  let locked = false;
  try {
    const lock = await client.query("SELECT pg_try_advisory_lock($1) AS ok", [LOCK_KEY]);
    if (!lock.rows[0].ok) return { skipped: "busy" };
    locked = true;

    const params = [TERMINAL_STATES, cutoff];
    let extra = "";
    if (opts.application) {
      params.push(opts.application);
      extra = ` AND a.code = $${params.length}`;
    }
    const { rows } = await client.query(
      `SELECT h.id, h.application_id, a.code AS application, h.action, h.from_state, h.to_state, h.actor, h.note, h.created_at
       FROM ocop_application_history h JOIN ocop_applications a ON a.id = h.application_id
       WHERE a.state = ANY($1) AND h.action <> 'archive' AND h.created_at < $2${extra}
       ORDER BY h.id LIMIT ${MAX_BATCH}`,
      params,
    );
    if (!rows.length) return null;

    const { buf, sha256: hash } = pack(rows.map(({ application_id: _omit, ...r }) => r));
    const key = objectKey(SOURCE, now, hash);
    await s3.putObject(key, buf, "application/gzip");
    // đọc lại từ kho lạnh và đối chiếu băm TRƯỚC khi xóa bất cứ thứ gì ở tầng nóng
    const back = await s3.getObjectBuffer(key);
    if (sha256(back) !== hash) throw new Error("Bản lưu trữ đọc lại không khớp băm, hủy (dữ liệu nóng giữ nguyên)");

    await client.query("BEGIN");
    try {
      const run = await client.query(
        "INSERT INTO archive_runs (source_table, cutoff, row_count, object_key, sha256, size, triggered_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
        [SOURCE, cutoff, rows.length, key, hash, buf.length, opts.triggeredBy ?? "scheduler"],
      );
      const runId = run.rows[0].id;
      const perApp = new Map();
      for (const r of rows) perApp.set(r.application_id, (perApp.get(r.application_id) ?? 0) + 1);
      for (const [appId, n] of perApp) {
        const st = await client.query("SELECT state FROM ocop_applications WHERE id = $1", [appId]);
        await client.query(
          "INSERT INTO ocop_application_history (application_id, action, from_state, to_state, actor, note) VALUES ($1,'archive',$2,$2,$3,$4)",
          [appId, st.rows[0].state, opts.triggeredBy ?? "scheduler", `Đã lưu trữ ${n} bản ghi lịch sử vào kho lạnh (lần chạy #${runId})`],
        );
      }
      await client.query("DELETE FROM ocop_application_history WHERE id = ANY($1::int[])", [rows.map((r) => r.id)]);
      await client.query("COMMIT");
      return { run_id: runId, rows: rows.length, applications: perApp.size, object_key: key, sha256: hash, size: buf.length };
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    }
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
    client.release();
  }
}

async function listRuns(pool, limit = 20) {
  const { rows } = await pool.query(
    "SELECT id, source_table, cutoff, row_count, object_key, sha256, size, triggered_by, created_at FROM archive_runs ORDER BY id DESC LIMIT $1",
    [limit],
  );
  return rows;
}

/** Đọc lại nội dung một lần lưu trữ từ kho lạnh (để phân tích hoặc kiểm tra); kiểm băm theo sổ. */
async function readRun(pool, s3, id) {
  const { rows } = await pool.query("SELECT object_key, sha256 FROM archive_runs WHERE id = $1", [Number(id) || 0]);
  if (!rows.length) return null;
  const buf = await s3.getObjectBuffer(rows[0].object_key);
  if (sha256(buf) !== rows[0].sha256) throw new Error("Bản lưu trữ không khớp băm trong sổ");
  return unpack(buf);
}

module.exports = { TERMINAL_STATES, MAX_BATCH, pack, unpack, objectKey, validateKeepDays, archiveApplicationHistory, listRuns, readRun };
