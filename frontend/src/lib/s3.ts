// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
import { config } from "./config";
import { getKeycloak } from "./keycloak";

// Truy cập MinIO (S3) từ trình duyệt theo quy tắc Tầng 1:
//   JWT Keycloak -> STS AssumeRoleWithWebIdentity (MinIO OIDC) -> ký SigV4 -> S3 qua APISIX.

interface Credentials {
  accessKey: string;
  secretKey: string;
  sessionToken: string;
  expiresAt: number;
}

const REGION = "us-east-1";
const enc = new TextEncoder();
let cached: Credentials | null = null;

function xmlTag(doc: Document, tag: string): string {
  return doc.getElementsByTagName(tag)[0]?.textContent ?? "";
}

async function getCredentials(): Promise<Credentials> {
  if (cached && cached.expiresAt - Date.now() > 60_000) return cached;
  const kc = getKeycloak();
  await kc.updateToken(30);
  const res = await fetch(`${config.s3Endpoint}/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      Action: "AssumeRoleWithWebIdentity",
      Version: "2011-06-15",
      WebIdentityToken: kc.token ?? "",
      DurationSeconds: "3600",
    }),
  });
  const doc = new DOMParser().parseFromString(await res.text(), "application/xml");
  if (!res.ok) throw new Error(`STS ${res.status}: ${xmlTag(doc, "Message") || "lỗi không rõ"}`);
  cached = {
    accessKey: xmlTag(doc, "AccessKeyId"),
    secretKey: xmlTag(doc, "SecretAccessKey"),
    sessionToken: xmlTag(doc, "SessionToken"),
    expiresAt: Date.parse(xmlTag(doc, "Expiration")),
  };
  return cached;
}

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
const sha256Hex = async (s: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));

async function hmac(key: BufferSource, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(data));
}

// RFC 3986: encodeURIComponent chừa lại ! ' ( ) * nên phải mã hóa thêm.
const rfc3986 = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** GET có chữ ký SigV4. `path` bắt đầu bằng "/", `query` là tham số truy vấn (chưa mã hóa). */
export async function s3Get(path: string, query: Record<string, string> = {}): Promise<string> {
  const c = await getCredentials();
  const url = new URL(config.s3Endpoint);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = await sha256Hex("");

  const canonicalUri = path.split("/").map(rfc3986).join("/");
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${rfc3986(k)}=${rfc3986(query[k])}`)
    .join("&");
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date;x-amz-security-token";
  const canonicalHeaders =
    `host:${url.host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n` +
    `x-amz-security-token:${c.sessionToken}\n`;
  const canonicalRequest = ["GET", canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join("\n");

  const scope = `${dateStamp}/${REGION}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256Hex(canonicalRequest)].join("\n");
  const kDate = await hmac(enc.encode(`AWS4${c.secretKey}`), dateStamp);
  const kRegion = await hmac(kDate, REGION);
  const kService = await hmac(kRegion, "s3");
  const kSigning = await hmac(kService, "aws4_request");
  const signature = hex(await hmac(kSigning, stringToSign));

  const res = await fetch(`${config.s3Endpoint}${canonicalUri}${canonicalQuery ? `?${canonicalQuery}` : ""}`, {
    headers: {
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
      "x-amz-security-token": c.sessionToken,
      Authorization: `AWS4-HMAC-SHA256 Credential=${c.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  });
  const text = await res.text();
  if (!res.ok) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    throw new Error(`S3 ${res.status}: ${xmlTag(doc, "Message") || "lỗi không rõ"}`);
  }
  return text;
}

/** Liệt kê khóa (đường dẫn) của các đối tượng trong bucket theo tiền tố. */
export async function s3ListKeys(bucket: string, prefix: string): Promise<string[]> {
  const xml = await s3Get(`/${bucket}`, { "list-type": "2", prefix, "max-keys": "1000" });
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return Array.from(doc.getElementsByTagName("Key"), (n) => n.textContent ?? "");
}
