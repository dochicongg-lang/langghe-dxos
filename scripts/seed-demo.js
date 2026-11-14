// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
// Nạp dữ liệu MẪU cho buổi trình diễn, chạy lặp lại an toàn (cái nào đã có thì bỏ qua):
//   - GOM-BT-0001: đã có mẻ nung chuẩn (đường cong thật + kết luận "đạt chuẩn"), hồ sơ OCOP đã đi hết quy trình (4 sao) kèm ảnh sản phẩm
//     => trang công khai /verify/GOM-BT-0001 là "đích" của câu chuyện quét QR.
//   - GOM-BT-0002: mẻ nung QUÁ NHIỆT (cảnh báo); GOM-BT-0003: gia nhiệt QUÁ NHANH (cần xem lại) => trang Intelligence có đủ ba mức.
// KHÔNG tạo sẵn hồ sơ OCOP để người dùng tự thử trên giao diện (chị Hoa lập, anh Tuấn duyệt, cán bộ đầu mối ghi kết quả).
// Số liệu OCOP (số quyết định, điểm) là MINH HỌA. Dữ liệu cảm biến ghi vào bucket có Object Lock (Governance, giữ lâu) nên khi cần dọn phải xóa bằng quyền bypass của quản trị MinIO (`mc rm --recursive --versions --force --bypass`).
// Chạy: node scripts/seed-demo.js   (sau bash scripts/upgrade.sh)
const fs = require("fs");
const zlib = require("zlib");
const { execFileSync } = require("child_process");
const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split(/\r?\n/).map((l) => l.match(/^([A-Za-z_]\w*)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const GW = `http://localhost:${env.APISIX_GATEWAY_PORT ?? 9080}`;
const KC = `http://localhost:8080/realms/${env.KEYCLOAK_REALM ?? "dxos"}/protocol/openid-connect/token`;

const token = async (user) => {
  const r = await fetch(KC, { method: "POST", body: new URLSearchParams({ grant_type: "password", client_id: env.KEYCLOAK_CLIENT_ID, client_secret: env.KEYCLOAK_CLIENT_SECRET, username: user, password: user }) });
  const j = await r.json();
  if (!j.access_token) throw new Error(`không lấy được token của ${user} (đã chạy bash scripts/upgrade.sh chưa?)`);
  return j.access_token;
};
const api = async (tok, method, path, body, headers = {}) => {
  const r = await fetch(`${GW}${path}`, { method, headers: { authorization: `Bearer ${tok}`, "content-type": "application/json", ...headers }, body: body === undefined ? undefined : typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body) });
  const buf = Buffer.from(await r.arrayBuffer());
  let json = null;
  try {
    json = JSON.parse(buf.toString("utf8"));
  } catch {
    /* không có thân JSON */
  }
  return { status: r.status, json };
};
const must = (r, what) => {
  if (r.status >= 300) throw new Error(`${what} thất bại (HTTP ${r.status}): ${r.json?.error ?? ""}`);
  return r.json;
};
const log = (m) => console.log(m);

/** Đặt mốc thời gian của công đoạn nung có cảm biến ngay sau công đoạn nung cũ (dữ liệu mẫu), để dòng thời gian đúng thứ tự trên trang công khai. */
function orderKilnEvent(code) {
  const sql = `UPDATE trace_events SET created_at = (SELECT created_at FROM trace_events o WHERE o.product_id = trace_events.product_id AND o.stage = 'nung-hoan-thien' AND o.iot IS NULL ORDER BY o.id LIMIT 1) + interval '12 hours' WHERE iot IS NOT NULL AND product_id = (SELECT id FROM products WHERE code = '${code}') AND EXISTS (SELECT 1 FROM trace_events o WHERE o.product_id = trace_events.product_id AND o.stage = 'nung-hoan-thien' AND o.iot IS NULL)`;
  try {
    execFileSync("docker", ["exec", "dxos-postgres", "psql", "-U", env.POSTGRES_USER ?? "postgres", "-d", env.TRACE_DB ?? "traceability", "-tAc", sql], { stdio: "pipe" });
  } catch (e) {
    log(`  (không chỉnh được thứ tự thời gian của ${code}: ${String(e.message).slice(0, 80)})`);
  }
}

/** Ảnh PNG đơn sắc (đất nung) tạo trực tiếp bằng zlib, không cần thư viện ảnh. */
function png(w, h, [r, g, b]) {
  const crcT = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const x of buf) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const t = Buffer.from(type);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, c]);
  };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const shade = 1 - (y / h) * 0.25; // chuyển sắc nhẹ cho đỡ phẳng
      raw.set([Math.round(r * shade), Math.round(g * shade), Math.round(b * shade)], y * (w * 3 + 1) + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const SAMPLES = [
  { code: "GOM-BT-0001", scenario: "firing", daysAgo: 40, note: "Nung 1.150 °C, giữ 2 giờ, làm nguội tự nhiên (số liệu cảm biến lò)" },
  { code: "GOM-BT-0002", scenario: "overheat", daysAgo: 41, name: "Bình gốm men lam Bát Tràng (mẻ quá nhiệt)", stages: [["nguyen-lieu", "Đất sét trắng Yên Bái", "Kho đất sét Bát Tràng"], ["tao-hinh", "Vuốt tay trên bàn xoay", "Xưởng tạo hình"]], note: "Mẻ nung có sự cố quá nhiệt" },
  { code: "GOM-BT-0003", scenario: "fast-ramp", daysAgo: 42, name: "Đĩa gốm men ngọc Bát Tràng (gia nhiệt nhanh)", stages: [["nguyen-lieu", "Đất sét trắng Yên Bái", "Kho đất sét Bát Tràng"], ["tao-hinh", "Ép khuôn thủ công", "Xưởng tạo hình"]], note: "Mẻ nung tăng nhiệt quá nhanh" },
];

(async () => {
  const [tester, hoa, tuan, ocop] = await Promise.all(["tester", "hoa", "tuan", "ocop"].map(token));

  // ---- Sản phẩm và mẻ nung có bằng chứng IoT ----
  for (const s of SAMPLES) {
    let detail = await api(tester, "GET", `/api/trace/products/${s.code}`);
    if (detail.status === 404) {
      must(await api(tester, "POST", "/api/trace/products", { code: s.code, name: s.name, category: "Gốm sứ", village: "Làng gốm Bát Tràng, Hà Nội", artisan: "Nghệ nhân Nguyễn Văn Hà", coop: "htx-demo" }), `tạo ${s.code}`);
      for (const [stage, note, location] of s.stages ?? []) must(await api(tester, "POST", `/api/trace/products/${s.code}/events`, { stage, note, location }), `công đoạn ${stage} của ${s.code}`);
      detail = await api(tester, "GET", `/api/trace/products/${s.code}`);
      log(`+ tạo sản phẩm ${s.code}`);
    }
    if (detail.json.events.some((e) => e.iot)) {
      log(`= ${s.code}: đã có bằng chứng nung, bỏ qua`);
      continue;
    }
    // chạy simulator ghi mẻ nung lùi về quá khứ (qua Keycloak, STS, cổng gác, Object Lock) rồi gắn vào công đoạn nung
    const out = execFileSync("node", ["backend/simulate-iot.js", "--post", "--scenario", s.scenario, "--days-ago", String(s.daysAgo)], { stdio: ["ignore", "pipe", "pipe"] }).toString().trim().split("\n").pop();
    const win = JSON.parse(out);
    const r = must(await api(tester, "POST", `/api/trace/products/${s.code}/events`, { stage: "nung-hoan-thien", note: s.note, location: "Lò nung số 1", iot: { deviceId: win.deviceId, from: win.from, to: win.to } }), `gắn mẻ nung ${s.scenario}`);
    if (s.code === "GOM-BT-0001") orderKilnEvent(s.code); // sản phẩm mẫu đã có công đoạn nung bằng chữ: xếp mẻ có cảm biến ngay sau đó
    log(`+ ${s.code}: mẻ nung "${s.scenario}" -> ${r.events.find((e) => e.iot)?.insight?.verdict}`);
  }

  // ---- Hồ sơ OCOP đã đi hết quy trình cho GOM-BT-0001 ----
  const apps = must(await api(ocop, "GET", "/api/trace/applications"), "đọc hồ sơ").applications;
  if (apps.some((a) => a.product_code === "GOM-BT-0001" || (a.product_name === "Bình gốm men rạn Bát Tràng" && a.state === "recognized"))) {
    log("= hồ sơ OCOP mẫu của GOM-BT-0001 đã có, bỏ qua");
  } else {
    const DOCS = ["phieu-dang-ky", "bao-cao-tu-danh-gia", "giay-phep-kinh-doanh", "anh-san-pham", "san-pham-mau"];
    const app = must(await api(hoa, "POST", "/api/trace/applications", { product_name: "Bình gốm men rạn Bát Tràng", product_group: "thu-cong-my-nghe", product_code: "GOM-BT-0001", description: "Bình gốm men rạn vuốt tay, nung 1.150 °C.", self_score: { A: 30, B: 20, C: 25 }, documents: DOCS }), "lập hồ sơ");
    const code = app.code;
    const img = await fetch(`${GW}/api/trace/applications/${code}/attachments?doc=anh-san-pham&name=${encodeURIComponent("anh-binh-gom.png")}`, { method: "POST", headers: { authorization: `Bearer ${hoa}`, "content-type": "image/png" }, body: png(480, 360, [192, 74, 31]) });
    if (img.status !== 201) throw new Error(`tải ảnh mẫu thất bại (HTTP ${img.status})`);
    must(await api(hoa, "POST", `/api/trace/applications/${code}/actions`, { action: "submit" }), "nộp hồ sơ");
    must(await api(tuan, "POST", `/api/trace/applications/${code}/actions`, { action: "approve", note: "Hồ sơ đầy đủ, đạt sơ duyệt." }), "sơ duyệt");
    must(await api(ocop, "POST", `/api/trace/applications/${code}/actions`, { action: "result", score: 75, decision_no: "Số 4325/QĐ-UBND", decided_at: "2026-08-16" }), "ghi kết quả");
    log(`+ hồ sơ OCOP ${code}: nộp, sơ duyệt đạt, kết quả 4 sao (minh họa)`);
  }

  log("\nXONG. Xem thử:");
  log("  Trang công khai (quét QR): http://localhost:3000/verify/GOM-BT-0001");
  log("  Trang Intelligence (quản trị tester): http://localhost:3000/intelligence");
})().catch((e) => {
  console.error("LỖI:", e.message);
  process.exit(1);
});
