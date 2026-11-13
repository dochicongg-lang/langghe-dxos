#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use strict";
/**
 * Sinh cấu hình phân quyền từ NGUỒN DUY NHẤT config/access.json.
 *
 *   node scripts/gen-access.js roles                         danh sách vai trò Keycloak: "tên|mô tả" mỗi dòng
 *   node scripts/gen-access.js lua trace    <origin>         Lua kiểm tra vai trò cho route /api/trace/*
 *   node scripts/gen-access.js lua workflow <origin>         Lua cho route /api/workflow/*
 *   node scripts/gen-access.js minio <thư-mục> <bucketIoT> <bucketỨngDụng>   ghi policy MinIO (một tệp JSON mỗi vai trò)
 *
 * Tên policy MinIO = tên role Keycloak. Lua chỉ dùng ký tự ASCII, không có dấu nháy kép hay gạch chéo ngược để nhúng được vào JSON.
 */
const fs = require("node:fs");
const path = require("node:path");
const access = require("../services/trace-api/access");

const CONFIG = path.join(__dirname, "..", "config", "access.json");

/** Vai trò gốc của một role (đi qua bí danh). */
const baseOf = (cfg, name) => cfg.roles[name].alias ?? name;

/** Role dùng được API nghiệp vụ (kể cả bí danh). */
function apiRoles(cfg) {
  return Object.keys(cfg.roles).filter((n) => cfg.roles[n].api !== false);
}

/** Role được thao tác ghi trên workflow (admin và các bí danh của nó). */
function workflowWriters(cfg) {
  return Object.keys(cfg.roles).filter((n) => cfg.roles[baseOf(cfg, n)].workflowWrite === true);
}

function rolesList(cfg) {
  return Object.entries(cfg.roles).map(([n, r]) => `${n}|${r.desc ?? ""}`);
}

function checkOrigin(origin) {
  if (!/^[A-Za-z0-9:/._-]+$/.test(origin ?? "")) throw new Error("origin không hợp lệ");
  return origin;
}

const luaSet = (names) => "{" + names.map((n) => `['${n}']=true`).join(", ") + "}";

const BEARER_DECODE =
  "local p = h:match('^[Bb]earer%s+[%w%-_]+%.([%w%-_]+)%.'); local c = nil; " +
  "if p then p = p:gsub('%-', '+'):gsub('_', '/'); p = p .. string.rep('=', (4 - #p % 4) % 4); local d = ngx.decode_base64(p); c = d and core.json.decode(d); end; " +
  "local roles = (c and type(c.policy) == 'table') and c.policy or {}; ";

// Nhật ký kiểm toán: xóa tiêu đề do client tự gửi, rồi gắn danh tính đọc từ token (chỉ ký tự an toàn, có giới hạn độ dài).
// Lua chạy trước bước xác thực chữ ký nên danh tính chỉ được tin khi yêu cầu cuối cùng thành công (xem services/trace-api/audit.js).
const AUDIT_RESET = "core.request.set_header(ctx, 'X-Audit-User', ''); core.request.set_header(ctx, 'X-Audit-Roles', ''); ";
const AUDIT_STAMP =
  "do local u = ''; if c and type(c.preferred_username) == 'string' then u = (c.preferred_username:gsub('[^%w%._@%-]', '')) end; " +
  "local rs = {}; for _, r in ipairs(roles) do if type(r) == 'string' then rs[#rs + 1] = r end end; " +
  "core.request.set_header(ctx, 'X-Audit-User', string.sub(u, 1, 64)); " +
  "core.request.set_header(ctx, 'X-Audit-Roles', string.sub((table.concat(rs, ',')):gsub('[^%w,_%-]', ''), 1, 200)) end; ";

function luaTrace(cfg, origin) {
  checkOrigin(origin);
  return (
    "return function(conf, ctx) local core = require('apisix.core'); " +
    AUDIT_RESET +
    "local h = core.request.header(ctx, 'Authorization'); if not h then return end; " +
    `local allow = ${luaSet(apiRoles(cfg))}; ` +
    BEARER_DECODE +
    AUDIT_STAMP +
    "local ok = false; for _, r in ipairs(roles) do if allow[r] then ok = true end end; " +
    `if not ok then ngx.header['Access-Control-Allow-Origin'] = '${origin}'; return 403, {error = 'Can vai tro nghiep vu hop le. Neu vua doi vai tro, hay dang xuat roi dang nhap lai.'} end end`
  );
}

function luaWorkflow(cfg, origin) {
  checkOrigin(origin);
  return (
    "return function(conf, ctx) local core = require('apisix.core'); " +
    AUDIT_RESET +
    "local h = core.request.header(ctx, 'Authorization'); if not h then return end; " +
    `local read = ${luaSet(apiRoles(cfg))}; local write = ${luaSet(workflowWriters(cfg))}; ` +
    BEARER_DECODE +
    AUDIT_STAMP +
    "local ro = false; local ed = false; for _, r in ipairs(roles) do if read[r] then ro = true end if write[r] then ed = true end end; " +
    `local m = ngx.req.get_method(); local u = ngx.var.uri or ''; local o = '${origin}'; ` +
    "if not ro then ngx.header['Access-Control-Allow-Origin'] = o; return 403, {error = 'Can vai tro nghiep vu hop le. Neu vua doi vai tro, hay dang xuat roi dang nhap lai.'} end; " +
    "if u:find('/api/workflow/identity', 1, true) == 1 or u:find('/api/workflow/management', 1, true) == 1 then ngx.header['Access-Control-Allow-Origin'] = o; return 403, {error = 'Khong duoc phep truy cap tuyen quan tri cua workflow'} end; " +
    "if m ~= 'GET' and m ~= 'HEAD' and m ~= 'OPTIONS' and not ed then ngx.header['Access-Control-Allow-Origin'] = o; return 403, {error = 'Chi quan tri moi duoc thay doi quy trinh'} end end"
  );
}

/** Policy MinIO cho các vai trò dùng mẫu "admin" hoặc "domain" (iot-writer và readonly do script thiết lập xử lý riêng). */
function minioPolicies(cfg, iotBucket, appBucket, docsBucket = "dxos-docs") {
  // Bucket tệp đính kèm hồ sơ chỉ dành cho trace-api (tài khoản trace-docs); người dùng cuối không được chạm tới bằng STS
  const denyDocs = { Effect: "Deny", Action: ["s3:*"], Resource: [`arn:aws:s3:::${docsBucket}`, `arn:aws:s3:::${docsBucket}/*`] };
  const denyIot = {
    Effect: "Deny",
    Action: ["s3:Put*", "s3:Delete*", "s3:Abort*", "s3:Bypass*"],
    Resource: [`arn:aws:s3:::${iotBucket}`, `arn:aws:s3:::${iotBucket}/*`],
  };
  const admin = {
    Version: "2012-10-17",
    Statement: [
      { Effect: "Allow", Action: ["s3:*"], Resource: ["arn:aws:s3:::*"] },
      // bucket ứng dụng cũ còn giữ bản sao iot/: vẫn cấm ghi/xóa
      { Effect: "Deny", Action: ["s3:PutObject", "s3:DeleteObject", "s3:DeleteObjectVersion", "s3:AbortMultipartUpload"], Resource: [`arn:aws:s3:::${appBucket}/iot/*`] },
      denyIot,
      denyDocs,
    ],
  };
  const domain = {
    Version: "2012-10-17",
    Statement: [
      // đọc số liệu cảm biến; thư mục hồ sơ của ứng dụng sẽ được cấp ở giai đoạn sau
      { Effect: "Allow", Action: ["s3:GetObject"], Resource: [`arn:aws:s3:::${iotBucket}/*`] },
      { Effect: "Allow", Action: ["s3:ListBucket"], Resource: [`arn:aws:s3:::${iotBucket}`] },
      denyIot,
      denyDocs,
    ],
  };
  const out = {};
  for (const [name, r] of Object.entries(cfg.roles)) {
    if (r.minio === "admin") out[name] = admin;
    else if (r.minio === "domain") out[name] = domain;
  }
  return out;
}

module.exports = { baseOf, apiRoles, workflowWriters, rolesList, luaTrace, luaWorkflow, minioPolicies, CONFIG };

if (require.main === module) {
  const [cmd, ...args] = process.argv.slice(2);
  const cfg = access.load(CONFIG);
  try {
    if (cmd === "roles") console.log(rolesList(cfg).join("\n"));
    else if (cmd === "lua" && args[0] === "trace") process.stdout.write(luaTrace(cfg, args[1]));
    else if (cmd === "lua" && args[0] === "workflow") process.stdout.write(luaWorkflow(cfg, args[1]));
    else if (cmd === "minio") {
      const [dir, iot, app, docs] = args;
      if (!dir || !iot || !app) throw new Error("dùng: minio <thư-mục> <bucketIoT> <bucketỨngDụng>");
      fs.mkdirSync(dir, { recursive: true });
      for (const f of fs.readdirSync(dir)) if (f.endsWith(".json")) fs.unlinkSync(path.join(dir, f));
      for (const [name, policy] of Object.entries(minioPolicies(cfg, iot, app, docs))) fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(policy, null, 2));
      console.log(Object.keys(minioPolicies(cfg, iot, app, docs)).join(" "));
    } else throw new Error("lệnh không hợp lệ: roles | lua trace|workflow <origin> | minio <thư-mục> <bucketIoT> <bucketỨngDụng>");
  } catch (e) {
    console.error("gen-access:", e.message);
    process.exit(1);
  }
}
