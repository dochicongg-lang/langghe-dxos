#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
/**
 * Giả lập thiết bị IoT của một xưởng làng nghề (lò nung, xưởng, kho đất sét).
 *
 * Chế độ mặc định: chỉ in số liệu ra console (dạng NDJSON), không cần Docker.
 * Chế độ --post: gom số liệu và ghi lên MinIO qua APISIX theo đúng quy tắc Tầng 1:
 *   1. Lấy JWT của service account từ Keycloak (client_credentials).
 *   2. Đổi JWT lấy thông tin tạm thời qua STS AssumeRoleWithWebIdentity (MinIO OIDC).
 *   3. Ký SigV4 và PUT tệp NDJSON vào bucket qua API Gateway (host s3.localhost).
 *
 * Dùng:
 *   node backend/simulate-iot.js [--interval 2000] [--count 0] [--batch 10] [--post]
 *   (--count 0 = chạy đến khi nhấn Ctrl+C)
 *
 * Kịch bản mẻ nung (ghi LÙI về quá khứ một chương trình nung hoàn chỉnh của lò kiln-01, mỗi phút một mẫu, rồi thoát):
 *   node backend/simulate-iot.js --post --scenario firing|overheat|fast-ramp|low-peak [--days-ago 20]
 *   firing = mẻ chuẩn (đạt); overheat = quá nhiệt (cảnh báo); fast-ramp = gia nhiệt quá nhanh; low-peak = đỉnh nhiệt thấp.
 *   In ra cửa sổ thời gian {deviceId, from, to} để dùng khi thêm công đoạn nung có bằng chứng IoT. Mỗi kịch bản nên dùng --days-ago khác nhau.
 *
 * Không dùng thư viện ngoài (chỉ Node >= 18).
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");

// ---------- Cấu hình ----------
loadDotEnv(path.join(__dirname, "..", ".env"));

const args = parseArgs(process.argv.slice(2));
const cfg = {
  intervalMs: Number(args.interval ?? 2000),
  count: Number(args.count ?? 0),
  batchSize: Number(args.batch ?? 10),
  post: Boolean(args.post),
  keycloakUrl: process.env.KEYCLOAK_URL ?? `http://localhost:${process.env.KEYCLOAK_PORT ?? 8080}`,
  realm: process.env.KEYCLOAK_REALM ?? "dxos",
  clientId: process.env.KEYCLOAK_IOT_CLIENT_ID ?? "dxos-iot", // client riêng của thiết bị: chỉ có role iot-writer
  clientSecret: process.env.KEYCLOAK_IOT_CLIENT_SECRET ?? "",
  gatewayHost: process.env.GATEWAY_HOST ?? "localhost",
  gatewayPort: Number(process.env.APISIX_GATEWAY_PORT ?? 9080),
  s3Host: process.env.S3_HOST ?? "s3.localhost",
  bucket: process.env.IOT_BUCKET ?? "dxos-iot", // bucket IoT có Object Lock
};

// ---------- Thiết bị giả lập ----------
// Mỗi cảm biến dao động ngẫu nhiên quanh giá trị hiện tại, bị chặn trong [min, max].
const devices = [
  { id: "kiln-01", name: "Lò nung gốm số 1", metric: "temperature", unit: "°C", value: 850, min: 700, max: 1250, step: 18 },
  { id: "workshop-01", name: "Xưởng tạo hình", metric: "temperature", unit: "°C", value: 29, min: 22, max: 38, step: 0.4 },
  { id: "workshop-01", name: "Xưởng tạo hình", metric: "humidity", unit: "%", value: 68, min: 45, max: 90, step: 1.2 },
  { id: "dye-01", name: "Bể nhuộm tơ số 1", metric: "temperature", unit: "°C", value: 60, min: 30, max: 90, step: 1.5 },
  { id: "dye-01", name: "Bể nhuộm tơ số 1", metric: "ph", unit: "pH", value: 5, min: 4, max: 6.5, step: 0.06 },
  { id: "weave-01", name: "Xưởng dệt lụa", metric: "humidity", unit: "%", value: 70, min: 55, max: 85, step: 0.9 },
  { id: "dry-01", name: "Phòng sấy mộc gốm", metric: "humidity", unit: "%", value: 48, min: 30, max: 70, step: 1.1 },
  { id: "clay-store-01", name: "Kho đất sét", metric: "humidity", unit: "%", value: 72, min: 55, max: 85, step: 0.8 },
];

function readSensors(now = new Date()) {
  return devices.map((d) => {
    d.value = clamp(d.value + (Math.random() - 0.5) * 2 * d.step, d.min, d.max);
    return {
      deviceId: d.id,
      deviceName: d.name,
      metric: d.metric,
      value: Math.round(d.value * 10) / 10,
      unit: d.unit,
      timestamp: now.toISOString(),
    };
  });
}

// ---------- Vòng lặp chính ----------
let buffer = [];
let timer;
let ticks = 0;
let stopping = false;
const uploader = cfg.post ? createUploader() : null;

async function tick() {
  const readings = readSensors();
  ticks += 1;
  for (const r of readings) console.log(JSON.stringify(r));
  if (uploader) {
    buffer.push(...readings);
    if (buffer.length >= cfg.batchSize) await flush();
  }
}

async function flush() {
  if (!uploader || buffer.length === 0) return;
  const batch = buffer;
  buffer = [];
  try {
    const key = await uploader.put(batch);
    console.error(`[iot] đã ghi ${batch.length} bản ghi -> s3://${cfg.bucket}/${key}`);
  } catch (err) {
    buffer = batch.concat(buffer); // giữ lại để thử lại ở lần flush sau
    console.error(`[iot] ghi MinIO thất bại: ${err.message}`);
  }
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  await flush();
  process.exit(0);
}

function startLoop() {
  console.error(
    `[iot] bắt đầu: mỗi ${cfg.intervalMs}ms, ${cfg.count || "không giới hạn"} lượt, ` +
      (cfg.post ? `ghi lên MinIO bucket "${cfg.bucket}" qua APISIX` : "chỉ in ra console (dùng --post để ghi lên MinIO)"),
  );

  timer = setInterval(async () => {
    await tick();
    if (cfg.count && ticks >= cfg.count) await shutdown();
  }, cfg.intervalMs);
  tick().then(() => cfg.count && ticks >= cfg.count && shutdown());
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// ---------- Kịch bản mẻ nung (dữ liệu lùi về quá khứ) ----------
const SCENARIOS = {
  firing: { peak: 1150, rampH: 8, holdH: 2, coolH: 5 }, // chuẩn: gia nhiệt ~140 °C/giờ, giữ 2 giờ, làm nguội ~190 °C/giờ
  overheat: { peak: 1320, rampH: 8, holdH: 2, coolH: 5 }, // vượt ngưỡng nguy hiểm
  "fast-ramp": { peak: 1150, rampH: 3, holdH: 2, coolH: 5 }, // gia nhiệt ~375 °C/giờ
  "low-peak": { peak: 980, rampH: 8, holdH: 2, coolH: 5 }, // chưa đủ nhiệt
  // Mẻ nhuộm tơ (bể nhuộm dye-01): nâng nhiệt khoảng 1 °C mỗi phút, giữ ở 85–93 °C khoảng 40 phút, hạ từ từ
  "dye-ok": { device: "dye-01", start: 28, end: 40, noise: 0.6, peak: 88, rampH: 1.1, holdH: 0.65, coolH: 1.5 },
  "dye-boil": { device: "dye-01", start: 28, end: 40, noise: 0.6, peak: 101, rampH: 1.1, holdH: 0.65, coolH: 1.5 }, // để sôi
  "dye-fast": { device: "dye-01", start: 28, end: 40, noise: 0.6, peak: 88, rampH: 0.4, holdH: 0.65, coolH: 1.5 }, // nâng nhiệt quá nhanh
  "dye-low": { device: "dye-01", start: 28, end: 40, noise: 0.6, peak: 72, rampH: 1.1, holdH: 0.65, coolH: 1.5 }, // chưa đủ nhiệt
};

async function runScenario(name) {
  const sc = SCENARIOS[name];
  if (!sc) throw new Error(`không có kịch bản "${name}" (có: ${Object.keys(SCENARIOS).join(", ")})`);
  if (!cfg.post) throw new Error("kịch bản cần --post (ghi lên MinIO qua APISIX)");
  const daysAgo = Number(args["days-ago"] ?? 20);
  const today = new Date();
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - daysAgo, 1, 0, 0));
  const total = (sc.rampH + sc.holdH + sc.coolH) * 60; // số phút = số mẫu
  const kiln = sc.device ? devices.find((d) => d.id === sc.device) : devices[0];
  if (!kiln) throw new Error(`không có thiết bị ${sc.device}`);
  const startV = sc.start ?? 25;
  const endV = sc.end ?? 200;
  const noise = sc.noise ?? 3;
  const byHour = new Map();
  for (let i = 0; i <= total; i++) {
    const min = i;
    const h = min / 60;
    let v;
    if (h <= sc.rampH) v = startV + ((sc.peak - startV) * h) / sc.rampH;
    else if (h <= sc.rampH + sc.holdH) v = sc.peak;
    else v = sc.peak - ((sc.peak - endV) * (h - sc.rampH - sc.holdH)) / sc.coolH;
    const t = new Date(start.getTime() + min * 60000);
    const rec = { deviceId: kiln.id, deviceName: kiln.name, metric: kiln.metric, value: Math.round((v + (Math.random() - 0.5) * noise) * 10) / 10, unit: kiln.unit, timestamp: t.toISOString() };
    const hourStart = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), t.getUTCHours()));
    const k = hourStart.toISOString();
    if (!byHour.has(k)) byHour.set(k, { at: hourStart, records: [] });
    byHour.get(k).records.push(rec);
  }
  const up = createUploader();
  let objects = 0;
  for (const { at, records } of byHour.values()) {
    await up.put(records, at);
    objects += 1;
  }
  const from = new Date(start.getTime() - 60000).toISOString();
  const to = new Date(start.getTime() + (total + 1) * 60000).toISOString();
  console.error(`[iot] kịch bản "${name}": ${total + 1} mẫu trong ${objects} tệp`);
  console.log(JSON.stringify({ scenario: name, deviceId: kiln.id, from, to, samples: total + 1 }));
}


// ---------- Ghi lên MinIO: Keycloak JWT -> STS -> SigV4 ----------
function createUploader() {
  let creds = null; // { accessKey, secretKey, sessionToken, expiresAt }

  async function getCredentials() {
    if (creds && creds.expiresAt - Date.now() > 60_000) return creds;
    const token = await getJwt();
    const body = new URLSearchParams({
      Action: "AssumeRoleWithWebIdentity",
      Version: "2011-06-15",
      WebIdentityToken: token,
      DurationSeconds: "3600",
    }).toString();
    const res = await gatewayRequest("POST", "/", body, { "content-type": "application/x-www-form-urlencoded" });
    if (res.status !== 200) throw new Error(`STS trả về ${res.status}: ${xmlTag(res.body, "Message") ?? res.body.slice(0, 200)}`);
    creds = {
      accessKey: xmlTag(res.body, "AccessKeyId"),
      secretKey: xmlTag(res.body, "SecretAccessKey"),
      sessionToken: xmlTag(res.body, "SessionToken"),
      expiresAt: Date.parse(xmlTag(res.body, "Expiration")),
    };
    return creds;
  }

  async function put(records, at) {
    const c = await getCredentials();
    const now = new Date();
    const stamp = at ?? now; // kịch bản ghi lùi về quá khứ: tên tệp theo thời điểm của dữ liệu
    // Mỗi gateway chỉ ghi được vào thư mục riêng (policy iot-writer: ${jwt:preferred_username} = service-account-<client>)
    const key = `iot/service-account-${cfg.clientId}/${stamp.toISOString().slice(0, 10)}/${stamp.toISOString().replace(/[:.]/g, "-")}.ndjson`;
    const payload = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
    const uri = `/${cfg.bucket}/${key}`;
    const headers = signV4("PUT", uri, payload, c, now);
    const res = await gatewayRequest("PUT", uri, payload, headers);
    if (res.status !== 200) throw new Error(`S3 PUT trả về ${res.status}: ${xmlTag(res.body, "Message") ?? res.body.slice(0, 200)}`);
    return key;
  }

  return { put };
}

async function getJwt() {
  if (!cfg.clientSecret) throw new Error("thiếu KEYCLOAK_IOT_CLIENT_SECRET (đặt trong .env; client thiết bị tạo bởi scripts/setup-keycloak-roles.sh)");
  const res = await fetch(`${cfg.keycloakUrl}/realms/${cfg.realm}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    }),
  });
  if (!res.ok) throw new Error(`Keycloak trả về ${res.status} khi lấy token`);
  return (await res.json()).access_token;
}

// Gọi APISIX ở localhost nhưng giữ Host = s3.localhost:<port> để route S3 khớp và chữ ký SigV4 hợp lệ.
function gatewayRequest(method, uri, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const hostHeader = `${cfg.s3Host}:${cfg.gatewayPort}`;
    const req = http.request(
      {
        host: cfg.gatewayHost,
        port: cfg.gatewayPort,
        method,
        path: uri,
        headers: { ...extraHeaders, host: hostHeader, "content-length": Buffer.byteLength(body) },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

function signV4(method, uri, payload, c, now) {
  const region = "us-east-1";
  const service = "s3";
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(payload);
  const host = `${cfg.s3Host}:${cfg.gatewayPort}`;

  const canonicalHeaders =
    `host:${host}\n` + `x-amz-content-sha256:${payloadHash}\n` + `x-amz-date:${amzDate}\n` + `x-amz-security-token:${c.sessionToken}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date;x-amz-security-token";
  const canonicalUri = uri.split("/").map((s) => encodeURIComponent(s)).join("/");
  const canonicalRequest = [method, canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${c.secretKey}`, dateStamp);
  const kSigning = hmac(hmac(hmac(kDate, region), service), "aws4_request");
  const sig = hmac(kSigning, stringToSign).toString("hex");

  return {
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
    "x-amz-security-token": c.sessionToken,
    "content-type": "application/x-ndjson",
    authorization: `AWS4-HMAC-SHA256 Credential=${c.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${sig}`,
  };
}

// ---------- Tiện ích ----------
function sha256Hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}
function hmac(key, data) {
  return crypto.createHmac("sha256", key).update(data).digest();
}
function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
function xmlTag(xml, tag) {
  const m = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml);
  return m ? m[1] : null;
}
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else (out[key] = next), i++;
  }
  return out;
}
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

// ---------- Điểm vào: kịch bản mẻ nung hoặc vòng lặp giả lập thường ----------
// (đặt cuối tệp để mọi hằng ở trên đã khởi tạo xong)
if (args.scenario) {
  runScenario(String(args.scenario))
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(`[iot] kịch bản thất bại: ${e.message}`);
      process.exit(1);
    });
} else {
  startLoop();
}
