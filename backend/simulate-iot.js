#!/usr/bin/env node
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

console.error(
  `[iot] bắt đầu: mỗi ${cfg.intervalMs}ms, ${cfg.count || "không giới hạn"} lượt, ` +
    (cfg.post ? `ghi lên MinIO bucket "${cfg.bucket}" qua APISIX` : "chỉ in ra console (dùng --post để ghi lên MinIO)"),
);

const timer = setInterval(async () => {
  await tick();
  if (cfg.count && ticks >= cfg.count) await shutdown();
}, cfg.intervalMs);
tick().then(() => cfg.count && ticks >= cfg.count && shutdown());
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

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

  async function put(records) {
    const c = await getCredentials();
    const now = new Date();
    // Mỗi gateway chỉ ghi được vào thư mục riêng (policy iot-writer: ${jwt:preferred_username} = service-account-<client>)
    const key = `iot/service-account-${cfg.clientId}/${now.toISOString().slice(0, 10)}/${now.toISOString().replace(/[:.]/g, "-")}.ndjson`;
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
