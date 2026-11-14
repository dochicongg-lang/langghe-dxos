#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
// Kiểm chứng THẬT (qua cổng gác, Keycloak, trace-api, MinIO): đường cong chuẩn của mẻ nung/nhuộm.
//  - bản nội bộ có `reference` (trung vị + dải giữa của các mẻ ĐẠT khác trên cùng thiết bị) và một câu nhận xét;
//  - mẻ bất thường (quá nhiệt, nhuộm để sôi) bị nói là lệch khỏi dải; mẻ đạt thì nằm trong dải;
//  - bản công khai (QR) KHÔNG có `reference`;
//  - mẻ không phải là một trong các mẻ dùng để dựng đường chuẩn của chính nó.
// Cần dữ liệu mẫu: node scripts/seed-demo.js
"use strict";
const fs = require("node:fs");
const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split(/\r?\n/).map((l) => l.match(/^([A-Za-z_]\w*)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const GW = `http://localhost:${env.APISIX_GATEWAY_PORT ?? 9080}`;
const KC = `http://localhost:8080/realms/${env.KEYCLOAK_REALM ?? "dxos"}/protocol/openid-connect/token`;
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "✓" : "✗"} ${m}`); if (!c) fails++; };
const token = async (u) => (await (await fetch(KC, { method: "POST", body: new URLSearchParams({ grant_type: "password", client_id: env.KEYCLOAK_CLIENT_ID, client_secret: env.KEYCLOAK_CLIENT_SECRET, username: u, password: u }) })).json()).access_token;
const get = async (path, tok) => { const r = await fetch(`${GW}${path}`, { headers: tok ? { authorization: `Bearer ${tok}` } : {} }); return { status: r.status, json: await r.json().catch(() => ({})) }; };
const iotEvent = (d) => (d.events ?? []).find((e) => e.iot);

(async () => {
  const tester = await token("tester");
  const cases = [
    ["GOM-BT-0001", "mẻ nung đạt", "ok"],
    ["GOM-BT-0002", "mẻ nung quá nhiệt", "warn"],
    ["LUA-VP-0008", "mẻ nhuộm đạt", "ok"],
    ["LUA-VP-0010", "mẻ nhuộm để sôi", "warn"],
  ];
  for (const [code, label, level] of cases) {
    const r = await get(`/api/trace/products/${code}`, tester);
    const e = r.status === 200 ? iotEvent(r.json) : null;
    ok(Boolean(e?.reference), `${code} (${label}): bản nội bộ có đường chuẩn`);
    if (!e?.reference) continue;
    ok(e.reference.enough && e.reference.n >= 3, `${code}: dựng từ ${e.reference.n} mẻ đạt khác (cần >= 3)`);
    ok(e.reference.points.length === 60 && e.reference.points.every((p) => p[2] <= p[1] && p[1] <= p[3]), `${code}: 60 điểm, phân vị 25 <= trung vị <= phân vị 75`);
    ok(e.reference.note?.level === level, `${code}: nhận xét mức "${level}" (${e.reference.note?.text})`);
    const pub = await get(`/api/public/trace/${code}`);
    ok(pub.status === 200 && !(pub.json.events ?? []).some((x) => x.reference), `${code}: trang công khai KHÔNG có đường chuẩn`);
  }
  // đối chứng: mẻ chuẩn không tự dựng đường chuẩn từ chính nó
  const r1 = await get("/api/trace/products/GOM-BT-0001", tester);
  const e1 = iotEvent(r1.json);
  ok(e1 && e1.reference.n === 3, `GOM-BT-0001: n = ${e1?.reference?.n} (3 mẻ đạt KHÁC; không tính chính nó, không tính mẻ quá nhiệt hay gia nhiệt nhanh)`);
  console.log(fails ? `\n${fails} kiểm tra KHÔNG đạt` : "\nTất cả đạt.");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("LỖI:", e.message); process.exit(1); });
