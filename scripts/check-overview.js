#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
// Kiểm chứng THẬT (cổng gác, Keycloak, trace-api, PostgreSQL) cho GET /api/trace/overview:
//  - quản trị và cán bộ OCOP thấy toàn bộ và có bảng so sánh HTX;
//  - cán bộ HTX chỉ thấy HTX của mình, không có bảng so sánh (đối chứng: số hồ sơ khác với toàn bộ);
//  - nghệ nhân và người chỉ-xem bị từ chối (403); không có token thì 401;
//  - kết quả không chứa tên người nộp.
// Cần dữ liệu mẫu (node scripts/seed-demo.js). tuan/htxlua cần chưa cài OTP (bash scripts/reset-otp.sh nếu bị từ chối).
"use strict";
const fs = require("node:fs");
const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split(/\r?\n/).map((l) => l.match(/^([A-Za-z_]\w*)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const GW = `http://localhost:${env.APISIX_GATEWAY_PORT ?? 9080}`;
const KC = `http://localhost:8080/realms/${env.KEYCLOAK_REALM ?? "dxos"}/protocol/openid-connect/token`;
let fails = 0;
let skipped = 0;
const ok = (c, m) => { console.log(`${c ? "✓" : "✗"} ${m}`); if (!c) fails++; };
const token = async (u) => (await (await fetch(KC, { method: "POST", body: new URLSearchParams({ grant_type: "password", client_id: env.KEYCLOAK_CLIENT_ID, client_secret: env.KEYCLOAK_CLIENT_SECRET, username: u, password: u }) })).json()).access_token;
const get = async (tok) => { const r = await fetch(`${GW}/api/trace/overview`, { headers: tok ? { authorization: `Bearer ${tok}` } : {} }); return { status: r.status, json: await r.json().catch(() => ({})) }; };

(async () => {
  const none = await get(null);
  ok(none.status === 401, `không token: ${none.status} (kỳ vọng 401)`);
  const admin = await get(await token("tester"));
  ok(admin.status === 200 && admin.json.scope === "all", `quản trị: ${admin.status}, phạm vi ${admin.json.scope}`);
  ok(Array.isArray(admin.json.coops) && admin.json.coops.length >= 2, `quản trị: có bảng so sánh ${admin.json.coops?.length} HTX`);
  const ocop = await get(await token("ocop"));
  ok(ocop.status === 200 && ocop.json.totalApps === admin.json.totalApps, `cán bộ OCOP thấy toàn bộ: ${ocop.json.totalApps} hồ sơ (= quản trị ${admin.json.totalApps})`);
  for (const u of ["hoa", "viewer"]) {
    const t = await token(u);
    const r = await get(t);
    ok(r.status === 403, `${u} bị từ chối: ${r.status} (kỳ vọng 403)`);
  }
  for (const [u, coop] of [["tuan", "htx-demo"], ["htxlua", "htx-lua"]]) {
    const t = await token(u);
    if (!t) { console.log(`- ${u}: không lấy được token (đã cài OTP?), bỏ qua`); skipped++; continue; }
    const r = await get(t);
    ok(r.status === 200 && r.json.scope === "coop", `${u}: phạm vi ${r.json.scope}`);
    ok(r.json.coops === null, `${u}: KHÔNG có bảng so sánh HTX`);
    const mine = admin.json.coops.find((c) => c.coop === coop);
    ok(mine && r.json.totalApps === mine.apps, `${u}: ${r.json.totalApps} hồ sơ = số của ${coop} (${mine?.apps}); toàn bộ là ${admin.json.totalApps}`);
    ok(r.json.totalApps < admin.json.totalApps, `${u}: đối chứng, thấy ít hơn toàn bộ`);
    const text = JSON.stringify(r.json);
    ok(!text.includes('"owner"') && !/:s*"(hoa|lua)"/.test(text), `${u}: kết quả không chứa tên người nộp`);
  }
  console.log(fails ? `\n${fails} kiểm tra KHÔNG đạt` : `\nTất cả đạt${skipped ? ` (bỏ qua ${skipped} vai trò vì OTP)` : ""}.`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("LỖI:", e.message); process.exit(1); });
