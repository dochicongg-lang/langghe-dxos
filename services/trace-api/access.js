"use strict";
/**
 * Phân quyền dựa trên ma trận ở config/access.json (nguồn duy nhất, xem tệp đó).
 *
 * Vai trò lấy từ claim "policy" của JWT Keycloak. Mỗi quyền có phạm vi (scope):
 *   all  mọi tài nguyên · coop  tài nguyên cùng HTX (claim "coop") · own  do chính mình tạo · self  tạo mới cho chính mình
 * Người dùng có nhiều vai trò thì lấy phạm vi RỘNG NHẤT. Vai trò có "alias" được quy về vai trò gốc.
 */
const fs = require("node:fs");

const RANK = { self: 1, own: 2, coop: 3, all: 4 };

function load(file) {
  const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
  return validate(cfg);
}

function validate(cfg) {
  if (!cfg || typeof cfg.roles !== "object" || typeof cfg.permissions !== "object") throw new Error("access.json: thiếu roles/permissions");
  for (const [name, r] of Object.entries(cfg.roles)) {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`access.json: tên role không hợp lệ: ${name}`);
    if (r.alias && !cfg.roles[r.alias]) throw new Error(`access.json: alias của ${name} trỏ tới role không có: ${r.alias}`);
    if (r.alias && cfg.roles[r.alias].alias) throw new Error(`access.json: alias không được nối chuỗi (${name})`);
    if (r.mfa !== undefined && typeof r.mfa !== "boolean") throw new Error(`access.json: mfa của ${name} phải là true/false`);
  }
  for (const [action, byRole] of Object.entries(cfg.permissions)) {
    for (const [role, scope] of Object.entries(byRole)) {
      if (!cfg.roles[role]) throw new Error(`access.json: quyền ${action} nhắc tới role không có: ${role}`);
      if (!RANK[scope]) throw new Error(`access.json: phạm vi không hợp lệ ở ${action}/${role}: ${scope}`);
    }
  }
  return cfg;
}

/** Quy các role (kể cả bí danh) về tập vai trò gốc có trong cấu hình; bỏ role lạ. */
function expand(cfg, roles) {
  const out = new Set();
  for (const r of Array.isArray(roles) ? roles : []) {
    const def = cfg.roles[r];
    if (!def) continue;
    out.add(def.alias ?? r);
  }
  return out;
}

/** Phạm vi rộng nhất mà các vai trò có cho hành động, hoặc null nếu không có quyền. */
function scopeFor(cfg, roles, action) {
  const byRole = cfg.permissions[action] ?? {};
  let best = null;
  for (const r of expand(cfg, roles)) {
    const s = byRole[r];
    if (s && (!best || RANK[s] > RANK[best])) best = s;
  }
  return best;
}

/** Vai trò có được dùng API nghiệp vụ không (iot-writer thì không; role lạ thì không). */
function canApi(cfg, roles) {
  for (const r of Array.isArray(roles) ? roles : []) {
    const def = cfg.roles[r];
    if (def && def.api !== false) return true;
  }
  return false;
}

/**
 * user: { name, roles, coop }. resource: { owner, coop } (coop là MÃ HTX của tài nguyên).
 * Với tạo mới (scope self hoặc coop) cần người dùng có HTX.
 */
function authorize(cfg, user, action, resource = {}) {
  const scope = scopeFor(cfg, user.roles, action);
  if (!scope) return false;
  switch (scope) {
    case "all":
      return true;
    case "coop":
      return Boolean(user.coop) && resource.coop === user.coop;
    case "own":
      return Boolean(user.name) && resource.owner === user.name;
    case "self":
      return Boolean(user.coop);
    default:
      return false;
  }
}

/** Bảng quyền hiệu lực của người dùng: { hành động: phạm vi } (dùng cho giao diện, không dùng để cấp quyền). */
function permissionsOf(cfg, roles) {
  const out = {};
  for (const action of Object.keys(cfg.permissions)) {
    const s = scopeFor(cfg, roles, action);
    if (s) out[action] = s;
  }
  return out;
}

module.exports = { load, validate, expand, scopeFor, canApi, authorize, permissionsOf, RANK };
