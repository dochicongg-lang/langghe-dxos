// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
// Kiểm tra THẬT tính năng [I] phân tích đường cong nung: simulator ghi các mẻ nung lùi về quá khứ lên MinIO (qua Keycloak, STS, cổng gác,
// Object Lock), trace-api tự đọc, đối chiếu và phân tích; kiểm tra kết luận từng mẻ, tổng hợp theo vai trò, trang công khai.
// Chạy: node scripts/check-kiln-insight.js   (sau bash scripts/upgrade.sh). Tự dọn sản phẩm thử và tệp cảm biến thử (cần Governance).
const fs = require("fs");
const { execFileSync } = require("child_process");
const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split(/\r?\n/).map((l) => l.match(/^([A-Za-z_]\w*)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const GW = `http://localhost:${env.APISIX_GATEWAY_PORT ?? 9080}`;
const KC = `http://localhost:8080/realms/${env.KEYCLOAK_REALM ?? "dxos"}/protocol/openid-connect/token`;
const TS = Date.now();
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
const api = async (tok, method, path, body) => {
  const r = await fetch(`${GW}${path}`, { method, headers: { ...(tok ? { authorization: `Bearer ${tok}` } : {}), "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const sh = (cmd) => execFileSync("docker", ["exec", "dxos-minio", "sh", "-c", `mc alias set r http://localhost:9000 '${env.MINIO_ROOT_USER}' '${env.MINIO_ROOT_PASSWORD}' >/dev/null && ${cmd}`], { stdio: "pipe", env: { ...process.env, MSYS_NO_PATHCONV: "1" } });

// mỗi kịch bản một ngày riêng (xa dữ liệu thật), kết luận mong đợi, và mã phát hiện phải có
const SCENARIOS = [
  { name: "firing", daysAgo: 21, verdicts: ["ok", "warn"], must: ["peak-ok", "hold-ok", "ramp-ok", "cool-ok"], mustNot: ["over-critical", "peak-low", "peak-high", "ramp-fast", "cool-fast", "hold-short"] },
  { name: "overheat", daysAgo: 22, verdicts: ["alert"], must: ["over-critical"] },
  { name: "fast-ramp", daysAgo: 23, verdicts: ["warn"], must: ["ramp-fast"], mustNot: ["over-critical"] },
  { name: "low-peak", daysAgo: 24, verdicts: ["warn"], must: ["peak-low"], mustNot: ["over-critical"] },
];

(async () => {
  const [tester, hoa, ocop, viewer] = await Promise.all(["tester", "hoa", "ocop", "viewer"].map(token));
  const days = [];
  const created = [];
  try {
    for (const sc of SCENARIOS) {
      const out = execFileSync("node", ["backend/simulate-iot.js", "--post", "--scenario", sc.name, "--days-ago", String(sc.daysAgo)], { stdio: ["ignore", "pipe", "pipe"] }).toString().trim().split("\n").pop();
      const win = JSON.parse(out);
      days.push(win.from.slice(0, 10) === win.to.slice(0, 10) ? win.from.slice(0, 10) : win.to.slice(0, 10));
      ok(win.samples > 500 && win.deviceId === "kiln-01", `simulator ghi mẻ "${sc.name}" lùi về quá khứ (${win.samples} mẫu, ghi qua Keycloak + STS + cổng gác)`);

      const code = `KILN-${sc.name.toUpperCase()}-${TS}`;
      created.push(code);
      let r = await api(tester, "POST", "/api/trace/products", { name: `Mẻ nung ${sc.name} (thử)`, code, category: "Gốm sứ", village: "Bát Tràng" });
      ok(r.status === 201, `tạo sản phẩm thử cho kịch bản ${sc.name}`);
      r = await api(tester, "POST", `/api/trace/products/${code}/events`, { stage: "nung-hoan-thien", note: "thử phân tích", location: "Lò 1", iot: { deviceId: win.deviceId, from: win.from, to: win.to } });
      const ev = r.json?.events?.find((e) => e.iot);
      const ins = ev?.insight;
      ok(r.status === 201 && ins, `máy chủ đối chiếu số liệu và kèm phân tích cho công đoạn nung (${sc.name})`);
      const codes = (ins?.findings ?? []).map((f) => f.code);
      ok(sc.verdicts.includes(ins?.verdict), `kết luận "${sc.name}" = ${ins?.verdict} (mong đợi ${sc.verdicts.join("/")})`);
      ok(sc.must.every((c) => codes.includes(c)), `"${sc.name}" có các phát hiện: ${sc.must.join(", ")}`);
      ok((sc.mustNot ?? []).every((c) => !codes.includes(c)), `"${sc.name}" không có các phát hiện sai: ${(sc.mustNot ?? []).join(", ") || "(không)"}`);
      if (sc.name === "firing") {
        ok(ins.metrics.peak > 1140 && ins.metrics.peak < 1160 && ins.metrics.holdMin > 140 && ins.metrics.maxRampPerHour < 250, `số đo mẻ chuẩn hợp lý (đỉnh ${ins.metrics.peak} °C, giữ ${ins.metrics.holdMin} phút, gia nhiệt ${ins.metrics.maxRampPerHour} °C/giờ)`);
        ok(ins.profile.verified === false, "hồ sơ nung đánh dấu là số liệu minh họa (chưa xác nhận)");
      }
    }

    // Tổng hợp theo vai trò
    let r = await api(ocop, "GET", "/api/trace/insights/kilns");
    const mine = (r.json?.runs ?? []).filter((x) => created.includes(x.product_code));
    ok(r.status === 200 && mine.length === 4, "cán bộ đầu mối OCOP (xem tất cả) thấy đủ 4 mẻ trong tổng hợp");
    ok(r.json.summary.total >= 4 && r.json.summary.alert >= 1 && r.json.summary.warn >= 2, "tổng hợp đếm đúng cảnh báo/lệch chuẩn");
    ok(mine.every((x) => x.insight && !("curve" in x)), "danh sách tổng hợp có kết luận, không kéo theo đường cong thô");
    r = await api(viewer, "GET", "/api/trace/insights/kilns");
    ok(r.status === 200 && r.json.runs.filter((x) => created.includes(x.product_code)).length === 4, "viewer (chỉ xem) thấy tổng hợp");
    r = await api(hoa, "GET", "/api/trace/insights/kilns");
    ok(r.status === 200 && r.json.runs.filter((x) => created.includes(x.product_code)).length === 0, "producer chỉ thấy mẻ nung của HTX mình (sản phẩm thử không thuộc HTX nên không lộ)");
    ok((await api(null, "GET", "/api/trace/insights/kilns")).status === 401, "không token -> 401");

    // Trang công khai: có kết luận, không lộ thông tin nội bộ
    const overheat = created[1];
    const pubRes = await fetch(`${GW}/api/public/trace/${overheat}`);
    const pubText = await pubRes.text();
    const pub = JSON.parse(pubText);
    const pev = pub.events.find((e) => e.iot);
    ok(pev?.insight?.verdict === "alert" && pev.insight.findings.some((f) => f.code === "over-critical"), "trang công khai có kèm kết luận phân tích của mẻ nung");
    ok(!/"actor"|"created_by"|"owner"|"coop"|"product_id"/.test(pubText), "trang công khai không lộ người thao tác, HTX hay mã nội bộ");
  } finally {
    // dọn: sản phẩm thử và số liệu cảm biến thử (bucket khóa Governance nên cần bypass; COMPLIANCE thì không dọn được)
    // --keep: giữ lại để xem trên giao diện (sản phẩm KILN-<KỊCH BẢN>-<mã>; tệp cảm biến ở các ngày in ra bên dưới)
    if (process.argv.includes("--keep")) {
      console.log(`(--keep) giữ dữ liệu thử: sản phẩm KILN-*-${TS}, ngày cảm biến ${days.join(", ")}`);
    } else
    try {
      execFileSync("docker", ["exec", "dxos-postgres", "psql", "-U", env.POSTGRES_USER ?? "postgres", "-d", env.TRACE_DB ?? "traceability", "-tc", `DELETE FROM trace_events WHERE product_id IN (SELECT id FROM products WHERE code LIKE 'KILN-%-${TS}'); DELETE FROM products WHERE code LIKE 'KILN-%-${TS}';`], { stdio: "pipe" });
      for (const d of days) sh(`mc rm --recursive --versions --force --bypass r/${env.IOT_BUCKET ?? "dxos-iot"}/iot/service-account-${env.KEYCLOAK_IOT_CLIENT_ID ?? "dxos-iot"}/${d}/`);
    } catch (e) {
      console.log(`(cảnh báo: dọn dữ liệu thử chưa hết: ${String(e.message).slice(0, 120)})`);
    }
  }
  console.log(fail ? `\n${fail} KIỂM TRA THẤT BẠI` : "\nTẤT CẢ ĐẠT");
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("LỖI:", e.message);
  process.exit(1);
});
