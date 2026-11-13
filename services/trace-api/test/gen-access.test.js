// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use strict";
// Kiểm thử bộ sinh cấu hình từ config/access.json và phát hiện LỆCH giữa các nguồn cấu hình.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const access = require("../access");
const gen = require("../../../scripts/gen-access");

const ROOT = path.join(__dirname, "..", "..", "..");
const CFG = access.load(gen.CONFIG);
const ORIGIN = "http://localhost:3000";

test("Lua: chỉ chứa ký tự an toàn để nhúng vào JSON (không nháy kép, không gạch chéo ngược, không $)", () => {
  for (const lua of [gen.luaTrace(CFG, ORIGIN), gen.luaWorkflow(CFG, ORIGIN)]) {
    assert.ok(!/["\\$`]/.test(lua), "Lua chứa ký tự nguy hiểm");
    assert.ok(/^return function\(conf, ctx\)/.test(lua) && lua.endsWith("end"));
    assert.ok(!/[^\x20-\x7e]/.test(lua), "Lua phải là ASCII");
  }
});

test("Lua route trace: cho mọi role dùng được API, không cho iot-writer", () => {
  const lua = gen.luaTrace(CFG, ORIGIN);
  for (const r of ["admin", "editor", "producer", "coop-officer", "ocop-officer", "readonly"]) assert.ok(lua.includes(`['${r}']=true`), r);
  assert.ok(!lua.includes("iot-writer"));
});

test("Lua route workflow: chỉ admin (và bí danh editor) được thay đổi quy trình", () => {
  const lua = gen.luaWorkflow(CFG, ORIGIN);
  const write = /local write = \{([^}]*)\}/.exec(lua)[1];
  assert.ok(write.includes("['admin']") && write.includes("['editor']"));
  for (const r of ["producer", "coop-officer", "ocop-officer", "readonly", "iot-writer"]) assert.ok(!write.includes(r), r);
  assert.ok(lua.includes("/api/workflow/identity") && lua.includes("/api/workflow/management")); // vẫn chặn tuyến quản trị
});

test("origin không hợp lệ bị từ chối (chống chèn mã)", () => {
  assert.throws(() => gen.luaTrace(CFG, "x'; os.execute('ls')--"), /origin/);
  assert.throws(() => gen.luaWorkflow(CFG, undefined), /origin/);
});

test("policy MinIO: admin/editor/producer/coop-officer/ocop-officer đều có Deny ghi-xóa-bypass bucket IoT", () => {
  const p = gen.minioPolicies(CFG, "dxos-iot", "dxos-data");
  assert.deepEqual(Object.keys(p).sort(), ["admin", "coop-officer", "editor", "ocop-officer", "producer"]);
  for (const [name, pol] of Object.entries(p)) {
    const deny = pol.Statement.find((s) => s.Effect === "Deny" && s.Resource.includes("arn:aws:s3:::dxos-iot/*"));
    assert.ok(deny, `${name} thiếu Deny bucket IoT`);
    for (const a of ["s3:Put*", "s3:Delete*", "s3:Abort*", "s3:Bypass*"]) assert.ok(deny.Action.includes(a), `${name}: ${a}`);
  }
});

test("policy MinIO: vai trò nghiệp vụ chỉ được ĐỌC bucket IoT (không Allow ghi)", () => {
  const dom = gen.minioPolicies(CFG, "dxos-iot", "dxos-data").producer;
  const allows = dom.Statement.filter((s) => s.Effect === "Allow").flatMap((s) => s.Action);
  assert.deepEqual(allows.sort(), ["s3:GetObject", "s3:ListBucket"]);
});

test("danh sách vai trò Keycloak khớp cấu hình", () => {
  assert.deepEqual(gen.rolesList(CFG).map((l) => l.split("|")[0]).sort(), Object.keys(CFG.roles).sort());
});

test("PHÁT HIỆN LỆCH: realm JSON có đúng tập vai trò như config/access.json", () => {
  const realm = JSON.parse(fs.readFileSync(path.join(ROOT, "keycloak", "dxos-realm.json"), "utf8").replace(/\$\{[A-Z_]+\}/g, "x"));
  const inRealm = realm.roles.realm.map((r) => r.name).sort();
  assert.deepEqual(inRealm, Object.keys(CFG.roles).sort(), "keycloak/dxos-realm.json lệch với config/access.json (cập nhật cả hai)");
});

test("PHÁT HIỆN LỆCH: mọi user trong realm JSON chỉ giữ vai trò có trong config", () => {
  const realm = JSON.parse(fs.readFileSync(path.join(ROOT, "keycloak", "dxos-realm.json"), "utf8").replace(/\$\{[A-Z_]+\}/g, "x"));
  for (const user of realm.users) for (const r of user.realmRoles ?? []) assert.ok(CFG.roles[r], `${user.username} giữ role không có trong config: ${r}`);
});

test("PHÁT HIỆN LỆCH: script thiết lập không còn ghi cứng tên role cũ (editor/readonly) trong Lua", () => {
  const setup = fs.readFileSync(path.join(ROOT, "scripts", "setup-apisix-routes.sh"), "utf8");
  assert.ok(!/r == 'editor'|r == 'readonly'/.test(setup), "Lua trong setup-apisix-routes.sh phải sinh từ config/access.json");
});

test("HỒI QUY: script không dùng `curl -o /dev/null` (với MSYS_NO_PATHCONV=1, curl.exe của Windows báo lỗi 23)", () => {
  const dir = path.join(ROOT, "scripts");
  const bad = fs.readdirSync(dir).filter((f) => f.endsWith(".sh") && /-o \/dev\/null/.test(fs.readFileSync(path.join(dir, f), "utf8")));
  assert.deepEqual(bad, [], "dùng chuyển hướng của shell (> /dev/null) hoặc lấy 3 ký tự cuối của -w thay cho -o /dev/null");
});
