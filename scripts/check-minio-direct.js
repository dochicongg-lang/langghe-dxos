// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
// Kiểm tra THẬT truy cập đi THẲNG vào MinIO (không qua cổng gác APISIX), giống người dùng đăng nhập console MinIO bằng SSO:
// lấy thông tin tạm qua STS bằng JWT của từng vai trò rồi gọi MinIO trực tiếp (mc chạy trong container MinIO).
// Cổng gác chỉ chặn đường dẫn bucket nội bộ ở route S3; còn đi thẳng thì chỉ policy MinIO bảo vệ. Kiểm tra:
//  - không vai trò nào đọc được bucket tệp hồ sơ hoặc bucket bản neo (kể cả 'readonly', trước đây dùng policy dựng sẵn đọc mọi bucket);
//  - ĐỐI CHỨNG DƯƠNG: vẫn đọc được số liệu cảm biến (policy không bị siết quá tay).
// Chạy: node scripts/check-minio-direct.js   (sau bash scripts/upgrade.sh hoặc bash scripts/setup-apisix-routes.sh)
const fs = require("fs");
const http = require("http");
const { execFileSync } = require("child_process");
const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split(/\r?\n/).map((l) => l.match(/^([A-Za-z_]\w*)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const PORT = Number(env.APISIX_GATEWAY_PORT ?? 9080);
const KC = `http://localhost:8080/realms/${env.KEYCLOAK_REALM ?? "dxos"}/protocol/openid-connect/token`;
const DOCS = env.DOCS_BUCKET ?? "dxos-docs";
const ANCHOR = env.ANCHOR_BUCKET ?? "dxos-audit";
const IOT = env.IOT_BUCKET ?? "dxos-iot";
let fail = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fail++;
};
const token = async (user) => {
  const r = await fetch(KC, { method: "POST", body: new URLSearchParams({ grant_type: "password", client_id: env.KEYCLOAK_CLIENT_ID, client_secret: env.KEYCLOAK_CLIENT_SECRET, username: user, password: user }) });
  const j = await r.json();
  if (!j.access_token) throw new Error(`không lấy được token của ${user}`);
  return j.access_token;
};
// STS qua cổng gác (route s3.localhost cho phép STS), cần đặt tiêu đề Host nên dùng http.request
const sts = (jwt) =>
  new Promise((resolve, reject) => {
    const path = `/?Action=AssumeRoleWithWebIdentity&Version=2011-06-15&DurationSeconds=900&WebIdentityToken=${encodeURIComponent(jwt)}`;
    const rq = http.request({ host: "localhost", port: PORT, path, method: "POST", headers: { host: `s3.localhost:${PORT}` } }, (res) => {
      let b = "";
      res.on("data", (d) => (b += d));
      res.on("end", () => {
        const g = (t) => new RegExp(`<${t}>([^<]*)</${t}>`).exec(b)?.[1];
        if (!g("AccessKeyId")) return reject(new Error(`STS thất bại (${res.statusCode}): ${b.slice(0, 200)}`));
        resolve({ ak: g("AccessKeyId"), sk: g("SecretAccessKey"), st: g("SessionToken") });
      });
    });
    rq.on("error", reject);
    rq.end();
  });
const mcAs = (c, ...args) => {
  try {
    return { ok: true, out: execFileSync("docker", ["exec", "-e", `MC_HOST_x=http://${c.ak}:${c.sk}:${c.st}@localhost:9000`, "dxos-minio", "mc", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (e) {
    return { ok: false, out: String(e.stderr ?? e.message) };
  }
};
const root = (...args) => execFileSync("docker", ["exec", "-e", `MC_HOST_x=http://${env.MINIO_ROOT_USER}:${env.MINIO_ROOT_PASSWORD}@localhost:9000`, "dxos-minio", "mc", ...args], { encoding: "utf8" });

(async () => {
  // đối tượng có thật để thử đọc
  // mc ls --recursive trả khóa TƯƠNG ĐỐI so với tiền tố nên phải ghép lại tiền tố
  const firstKey = (bucket, prefix) => {
    const rel = root("ls", "--recursive", `x/${bucket}/${prefix}`).split(/\r?\n/).filter(Boolean).map((l) => l.trim().split(/\s+/).at(-1))[0];
    return rel ? `${prefix}${rel}` : undefined;
  };
  const denied = (r) => !r.ok && /access denied|accessdenied|insufficient permissions|not allowed/i.test(r.out);
  const docKey = firstKey(DOCS, "applications/");
  const anchorKey = firstKey(ANCHOR, "anchors/");
  const iotKey = firstKey(IOT, "iot/");
  ok(Boolean(docKey) && Boolean(anchorKey) && Boolean(iotKey), `có đối tượng thật để thử: tệp hồ sơ (${docKey}), bản neo (${anchorKey}), số liệu cảm biến (${iotKey ? "có" : "không"})`);

  for (const [user, role] of [["viewer", "readonly (policy ghi đè)"], ["hoa", "producer"], ["ocop", "ocop-officer"], ["tester", "admin"]]) {
    const c = await sts(await token(user));
    const docsRead = mcAs(c, "cat", `x/${DOCS}/${docKey ?? "applications/x"}`);
    const docsList = mcAs(c, "ls", `x/${DOCS}/applications/`);
    const anchorRead = mcAs(c, "cat", `x/${ANCHOR}/${anchorKey ?? "anchors/x"}`);
    const anchorList = mcAs(c, "ls", `x/${ANCHOR}/anchors/`);
    ok(denied(docsRead) && denied(docsList), `${user} (${role}): bị TỪ CHỐI (không đủ quyền) khi đọc/liệt kê bucket tệp hồ sơ đi thẳng vào MinIO`);
    ok(denied(anchorRead) && denied(anchorList), `${user} (${role}): bị TỪ CHỐI (không đủ quyền) khi đọc/liệt kê bucket bản neo đi thẳng vào MinIO`);
    const iotRead = mcAs(c, "cat", `x/${IOT}/${iotKey}`);
    ok(iotRead.ok && iotRead.out.length > 0, `${user} (${role}): vẫn ĐỌC được số liệu cảm biến (đối chứng dương, policy không bị siết quá tay)`);
  }

  // console MinIO không được publish ra máy chủ theo mặc định
  const consolePort = env.MINIO_CONSOLE_PORT ?? "9001";
  let reachable = true;
  try {
    await fetch(`http://localhost:${consolePort}/`, { signal: AbortSignal.timeout(4000) });
  } catch {
    reachable = false;
  }
  ok(!reachable, `console MinIO (cổng ${consolePort}) KHÔNG truy cập được từ máy chủ theo mặc định`);
  ok(!/9001/.test(execFileSync("docker", ["port", "dxos-minio"], { encoding: "utf8" })), "docker không publish cổng 9001 của MinIO");

  console.log(fail ? `\n${fail} KIỂM TRA THẤT BẠI` : "\nTẤT CẢ ĐẠT");
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("Lỗi:", e.message);
  process.exit(2);
});
