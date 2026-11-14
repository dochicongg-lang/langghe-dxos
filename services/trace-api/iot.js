// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use strict";
/**
 * Bằng chứng IoT cho công đoạn nung — máy chủ TỰ đọc số liệu cảm biến từ MinIO rồi tính tóm tắt,
 * không tin số liệu do người dùng gửi lên.
 *
 * - Chỉ nhận { deviceId, from, to } từ client; phần còn lại (min/avg/max, đường cong) do máy chủ tính.
 * - Đọc MinIO bằng tài khoản CHỈ ĐỌC (quyền GetObject + ListBucket trên tiền tố iot/), qua mạng nội bộ Docker.
 * - Không phụ thuộc thư viện ngoài: tự ký AWS SigV4 bằng node:crypto.
 */

const crypto = require("node:crypto");

const METRIC = "temperature";
const MAX_WINDOW_MS = 72 * 3600 * 1000; // tối đa 72 giờ cho một lần nung
const SLACK_MS = 5 * 60 * 1000; // mỗi tệp được tải lên sau thời điểm đo vài chục giây
const MAX_OBJECTS = 2000; // chặn truy vấn quá nặng
const MAX_CURVE_POINTS = 60;
const DAY = 24 * 3600 * 1000;

class IotError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- Kiểm tra yêu cầu ----------
/** Chuẩn hóa và kiểm tra { deviceId, from, to } do client gửi. */
function parseWindow(v, now = Date.now()) {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new IotError(400, "iot phải là một đối tượng { deviceId, from, to }");
  const deviceId = typeof v.deviceId === "string" ? v.deviceId.trim() : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/.test(deviceId)) throw new IotError(400, "iot.deviceId không hợp lệ (chữ, số, gạch ngang/gạch dưới, tối đa 60 ký tự)");
  const time = (x, f) => {
    const t = typeof x === "string" ? Date.parse(x) : NaN;
    if (Number.isNaN(t)) throw new IotError(400, `iot.${f} không phải thời gian hợp lệ`);
    return t;
  };
  const from = time(v.from, "from");
  const to = time(v.to, "to");
  if (to <= from) throw new IotError(400, "iot.to phải sau iot.from");
  if (to - from > MAX_WINDOW_MS) throw new IotError(400, "Khoảng thời gian nung tối đa 72 giờ");
  if (to > now + SLACK_MS) throw new IotError(400, "iot.to không được ở tương lai");
  return { deviceId, from, to };
}

// ---------- Xử lý số liệu (hàm thuần, có test) ----------
/** Thời gian tải lên nằm trong tên tệp: iot/2026-11-12/2026-11-12T15-20-28-909Z.ndjson */
function keyTime(key) {
  const m = /(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.ndjson$/.exec(key);
  return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : NaN;
}

/** Thư mục riêng của một gateway trong MinIO: khớp policy iot-writer (${jwt:preferred_username} của service account). */
const folderOf = (gateway) => `service-account-${gateway}`;

/** Các tiền tố ngày (UTC) của MỘT gateway mà khoảng [from, to] có thể chạm tới. */
function dayPrefixes(from, to, gateway) {
  const out = [];
  for (let t = Math.floor(from / DAY) * DAY; t <= to + SLACK_MS; t += DAY) out.push(`iot/${folderOf(gateway)}/${new Date(t).toISOString().slice(0, 10)}/`);
  return out;
}

/** Giữ các tệp có thể chứa mẫu đo trong khoảng. */
function selectKeys(keys, from, to) {
  return keys
    .filter((k) => {
      const t = keyTime(k);
      return t >= from && t <= to + SLACK_MS;
    })
    .sort();
}

/** Đọc các dòng NDJSON, giữ mẫu của đúng thiết bị/chỉ số trong khoảng. Bỏ qua dòng lỗi. */
function collectPoints(bodies, deviceId, from, to) {
  const pts = [];
  for (const body of bodies) {
    for (const line of body.split("\n")) {
      if (!line.trim()) continue;
      let r;
      try {
        r = JSON.parse(line);
      } catch {
        continue;
      }
      const t = Date.parse(r?.timestamp);
      if (r?.deviceId === deviceId && r?.metric === METRIC && Number.isFinite(r.value) && t >= from && t <= to) {
        pts.push({ t, v: r.value, name: typeof r.deviceName === "string" ? r.deviceName : "", unit: typeof r.unit === "string" ? r.unit : "" });
      }
    }
  }
  return pts.sort((a, b) => a.t - b.t);
}

const round1 = (x) => Math.round(x * 10) / 10;

/** Tóm tắt: min/avg/max, số mẫu, đường cong ≤ 60 điểm (trung bình theo nhóm liên tiếp). */
function summarize(pts, deviceId, from, to) {
  if (!pts.length) return null;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const p of pts) {
    min = Math.min(min, p.v);
    max = Math.max(max, p.v);
    sum += p.v;
  }
  const buckets = Math.min(MAX_CURVE_POINTS, pts.length);
  const curve = [];
  for (let i = 0; i < buckets; i++) {
    const slice = pts.slice(Math.floor((i * pts.length) / buckets), Math.floor(((i + 1) * pts.length) / buckets));
    curve.push([slice[Math.floor(slice.length / 2)].t, round1(slice.reduce((a, p) => a + p.v, 0) / slice.length)]);
  }
  return {
    deviceId,
    deviceName: pts[0].name,
    metric: METRIC,
    unit: pts[0].unit,
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    count: pts.length,
    min: round1(min),
    avg: round1(sum / pts.length),
    max: round1(max),
    curve,
  };
}

const COVERAGE_MIN = 0.8; // dưới mức này thì gắn cờ "low-coverage"
const GAP_TOLERANCE = 3; // khoảng cách giữa hai mẫu lớn hơn 3 lần khoảng cách điển hình (trung vị) được xem là mất dữ liệu

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Đánh giá chất lượng số liệu trước khi dùng làm bằng chứng:
 *  - loại mẫu ngoài khoảng [min, max] của thiết bị (đếm vào `rejected`);
 *  - độ phủ: tỷ lệ thời gian nung có dữ liệu liên tục (khoảng trống > 3 lần khoảng cách điển hình bị trừ);
 *  - khoảng trống lớn nhất (kể cả đầu và cuối cửa sổ), số lần đổi nhanh quá maxRatePerSec;
 *  - cờ: out-of-range, rapid-change, low-coverage, few-samples.
 * Không loại mẫu vì đổi nhanh hay thiếu dữ liệu, chỉ gắn cờ để người xem tự đánh giá.
 */
function assess(pts, from, to, limits = {}) {
  const { min = -Infinity, max = Infinity, maxRatePerSec = Infinity } = limits;
  const accepted = pts.filter((p) => p.v >= min && p.v <= max);
  const rejected = pts.length - accepted.length;
  const duration = to - from;

  const times = accepted.map((p) => p.t);
  const gaps = [];
  if (times.length) {
    gaps.push(times[0] - from);
    for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
    gaps.push(to - times[times.length - 1]);
  } else {
    gaps.push(duration);
  }
  const typical = times.length >= 2 ? median(gaps.slice(1, -1)) : null;
  const tolerated = typical === null ? 0 : typical * GAP_TOLERANCE;
  const lost = gaps.reduce((a, g) => a + Math.max(0, g - tolerated), 0);
  const coverage = typical === null ? 0 : Math.min(1, Math.max(0, 1 - lost / duration));

  let jumps = 0;
  for (let i = 1; i < accepted.length; i++) {
    const dt = (accepted[i].t - accepted[i - 1].t) / 1000;
    if (dt > 0 && Math.abs(accepted[i].v - accepted[i - 1].v) / dt > maxRatePerSec) jumps++;
  }

  const flags = [];
  if (accepted.length < 2) flags.push("few-samples");
  if (rejected > 0) flags.push("out-of-range");
  if (jumps > 0) flags.push("rapid-change");
  if (accepted.length >= 2 && coverage < COVERAGE_MIN) flags.push("low-coverage");
  return {
    accepted,
    quality: {
      coverage: Math.round(coverage * 100) / 100,
      maxGapSec: Math.round(Math.max(...gaps) / 1000),
      rejected,
      jumps,
      flags,
    },
  };
}

// ---------- Truy cập MinIO bằng SigV4 (GET và PUT) ----------
const sha256 = (d) => crypto.createHash("sha256").update(d).digest("hex");
const hmac = (k, d) => crypto.createHmac("sha256", k).update(d).digest();
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function createS3Client({ endpoint, accessKey, secretKey, bucket, region = "us-east-1", fetchImpl = fetch }) {
  const url = new URL(endpoint);

  /** Gửi một yêu cầu đã ký SigV4; trả về Response (người gọi kiểm tra ok). body là Buffer hoặc không có. */
  async function send(method, path, query = {}, body = null, extraHeaders = {}) {
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const date = amzDate.slice(0, 8);
    const canonicalPath = path.split("/").map(enc).join("/");
    const canonicalQuery = Object.keys(query)
      .sort()
      .map((k) => `${enc(k)}=${enc(query[k])}`)
      .join("&");
    const payloadHash = sha256(body ?? "");
    const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
    const canonicalRequest = [
      method,
      canonicalPath,
      canonicalQuery,
      `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`,
      signedHeaders,
      payloadHash,
    ].join("\n");
    const scope = `${date}/${region}/s3/aws4_request`;
    const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
    let key = hmac(`AWS4${secretKey}`, date);
    for (const part of [region, "s3", "aws4_request"]) key = hmac(key, part);
    const signature = crypto.createHmac("sha256", key).update(toSign).digest("hex");
    return fetchImpl(`${url.origin}${canonicalPath}${canonicalQuery ? `?${canonicalQuery}` : ""}`, {
      method,
      headers: {
        ...extraHeaders,
        "x-amz-date": amzDate,
        "x-amz-content-sha256": payloadHash,
        authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
      body: body ?? undefined,
      signal: AbortSignal.timeout(15000),
    });
  }

  async function get(path, query = {}) {
    const res = await send("GET", path, query);
    if (!res.ok) throw new Error(`MinIO trả về ${res.status} cho ${path}`);
    return res.text();
  }

  const unxml = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

  return {
    /**
     * Liệt kê MỌI phiên bản (kể cả dấu xóa) dưới một tiền tố: [{ key, versionId, lastModified, isDeleteMarker }].
     * Bucket IoT bật Object Lock nên có versioning: ghi đè cùng tên tạo phiên bản mới, xóa thường chỉ tạo dấu xóa.
     */
    async listVersions(prefix) {
      const out = [];
      let keyMarker;
      let versionMarker;
      const tag = (s, t) => new RegExp(`<${t}>([^<]*)</${t}>`).exec(s)?.[1];
      do {
        const query = { versions: "", prefix };
        if (keyMarker) {
          query["key-marker"] = keyMarker;
          if (versionMarker) query["version-id-marker"] = versionMarker;
        }
        const xml = await get(`/${bucket}`, query);
        for (const m of xml.matchAll(/<(Version|DeleteMarker)>([\s\S]*?)<\/\1>/g)) {
          out.push({
            key: unxml(tag(m[2], "Key") ?? ""),
            versionId: tag(m[2], "VersionId") ?? "null",
            lastModified: Date.parse(tag(m[2], "LastModified") ?? "") || 0,
            isDeleteMarker: m[1] === "DeleteMarker",
          });
        }
        const more = /<IsTruncated>true<\/IsTruncated>/.test(xml);
        keyMarker = more ? unxml(tag(xml, "NextKeyMarker") ?? "") || undefined : undefined;
        versionMarker = more ? tag(xml, "NextVersionIdMarker") : undefined;
      } while (keyMarker && out.length < MAX_OBJECTS * 4);
      return out;
    },
    /** Đọc nội dung một phiên bản cụ thể (không truyền versionId hoặc "null" -> bản hiện hành). */
    getObject: (key, versionId) => get(`/${bucket}/${key}`, versionId && versionId !== "null" ? { versionId } : {}),
    /** Ghi một đối tượng (body là Buffer). Dùng cho tệp đính kèm hồ sơ; tài khoản ghi chỉ có quyền trên bucket tệp. */
    async putObject(key, body, contentType = "application/octet-stream") {
      const res = await send("PUT", `/${bucket}/${key}`, {}, body, { "content-type": contentType });
      if (!res.ok) throw new Error(`MinIO trả về ${res.status} khi ghi ${key}`);
    },
    /** Đọc đối tượng thành Buffer (nhị phân, không đổi sang chuỗi). */
    async getObjectBuffer(key) {
      const res = await send("GET", `/${bucket}/${key}`);
      if (!res.ok) throw new Error(`MinIO trả về ${res.status} cho ${key}`);
      return Buffer.from(await res.arrayBuffer());
    },
    /** Liệt kê khóa đối tượng dưới một tiền tố (ListObjectsV2, tự lật trang). Cần quyền s3:ListBucket cho tiền tố đó. */
    async listKeys(prefix, max = 10000) {
      const out = [];
      let token;
      const tag = (s, t) => new RegExp(`<${t}>([^<]*)</${t}>`).exec(s)?.[1];
      do {
        const query = { "list-type": "2", prefix };
        if (token) query["continuation-token"] = token;
        const xml = await get(`/${bucket}`, query);
        for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) out.push(unxml(tag(m[1], "Key") ?? ""));
        token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? tag(xml, "NextContinuationToken") : undefined;
      } while (token && out.length < max);
      return out;
    },
  };
}

/**
 * Đọc MinIO và dựng bằng chứng cho cửa sổ đã được parseWindow kiểm tra.
 * `gateway` là gateway SỞ HỮU thiết bị (tra từ danh bạ): chỉ đọc thư mục của gateway đó.
 *
 * Chống ghi đè / che giấu (bucket có versioning + Object Lock): với mỗi tệp luôn đọc phiên bản GHI ĐẦU TIÊN (cũ nhất),
 * không phải bản hiện hành; tệp có nhiều phiên bản hoặc có dấu xóa được đếm và gắn cờ trên bằng chứng.
 */
async function buildEvidence(win, s3, gateway, limits = {}) {
  const lists = await Promise.all(dayPrefixes(win.from, win.to, gateway).map((p) => s3.listVersions(p)));
  const byKey = new Map();
  for (const v of lists.flat()) {
    let e = byKey.get(v.key);
    if (!e) byKey.set(v.key, (e = { puts: [], deleted: false }));
    if (v.isDeleteMarker) e.deleted = true;
    else e.puts.push(v);
  }
  const inWindow = selectKeys([...byKey.keys()], win.from, win.to);
  const keys = inWindow.filter((k) => byKey.get(k).puts.length);
  if (keys.length > MAX_OBJECTS) throw new IotError(400, "Khoảng thời gian có quá nhiều dữ liệu, hãy rút ngắn lại");
  const overwritten = inWindow.filter((k) => byKey.get(k).puts.length > 1).length;
  const deleted = inWindow.filter((k) => byKey.get(k).deleted).length;
  const bodies = [];
  for (let i = 0; i < keys.length; i += 20) {
    bodies.push(
      ...(await Promise.all(
        keys.slice(i, i + 20).map((k) => {
          const puts = byKey.get(k).puts.sort((a, b) => a.lastModified - b.lastModified);
          return s3.getObject(k, puts[0].versionId); // phiên bản ghi đầu tiên
        }),
      )),
    );
  }
  const pts = collectPoints(bodies, win.deviceId, win.from, win.to);
  const { accepted, quality } = assess(pts, win.from, win.to, limits);
  quality.overwritten = overwritten;
  quality.deleted = deleted;
  if (overwritten) quality.flags.push("object-overwritten");
  if (deleted) quality.flags.push("object-deleted");
  const evidence = summarize(accepted, win.deviceId, win.from, win.to);
  if (!evidence) {
    if (pts.length) throw new IotError(422, `Toàn bộ ${pts.length} mẫu nằm ngoài khoảng giá trị hợp lý của thiết bị, không dùng được làm bằng chứng`);
    throw new IotError(422, "Không có số liệu cảm biến của thiết bị này trong khoảng thời gian đã nhập");
  }
  return { ...evidence, quality, gateway, verifiedAt: new Date().toISOString() };
}

module.exports = { IotError, parseWindow, keyTime, folderOf, dayPrefixes, selectKeys, collectPoints, assess, summarize, createS3Client, buildEvidence };
