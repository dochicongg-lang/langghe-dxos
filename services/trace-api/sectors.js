// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use strict";
/**
 * Ngành nghề (gốm, lụa...) dùng chung một nền tảng, mỗi ngành có chuỗi công đoạn riêng (config/sectors.json).
 * Ngành của sản phẩm suy ra từ danh mục (category) nên không cần đổi cơ sở dữ liệu. Hàm thuần, không đụng mạng hay CSDL.
 */
const fs = require("node:fs");

function normalize(s) {
  return String(s ?? "").normalize("NFC").toLowerCase();
}

function validate(cfg) {
  if (!cfg || !Array.isArray(cfg.sectors) || cfg.sectors.length === 0) throw new Error("sectors.json: thiếu danh sách sectors");
  const keys = new Set();
  for (const s of cfg.sectors) {
    if (!s.key || keys.has(s.key)) throw new Error(`sectors.json: khóa ngành trống hoặc trùng (${s.key})`);
    keys.add(s.key);
    if (!s.label) throw new Error(`sectors.json[${s.key}]: thiếu label`);
    if (!Array.isArray(s.match) || s.match.length === 0) throw new Error(`sectors.json[${s.key}]: thiếu match`);
    if (!Array.isArray(s.stages) || s.stages.length < 2) throw new Error(`sectors.json[${s.key}]: cần ít nhất 2 công đoạn`);
    if (s.sensorStage !== undefined && !s.stages.some((st) => st.key === s.sensorStage)) throw new Error(`sectors.json[${s.key}]: sensorStage không nằm trong chuỗi công đoạn`);
    if (s.analysis !== undefined && !["kiln", "dye"].includes(s.analysis)) throw new Error(`sectors.json[${s.key}]: analysis phải là kiln hoặc dye`);
    const seen = new Set();
    for (const st of s.stages) {
      if (!/^[a-z0-9-]{2,40}$/.test(st.key ?? "") || !st.label) throw new Error(`sectors.json[${s.key}]: công đoạn không hợp lệ`);
      if (seen.has(st.key)) throw new Error(`sectors.json[${s.key}]: công đoạn trùng (${st.key})`);
      seen.add(st.key);
    }
  }
  if (!keys.has(cfg.defaultSector)) throw new Error("sectors.json: defaultSector không có thật");
  return cfg;
}

function load(file) {
  return validate(JSON.parse(fs.readFileSync(file, "utf8")));
}

/** Ngành của sản phẩm theo danh mục; không khớp ngành nào thì dùng ngành mặc định. */
function sectorOf(cfg, category) {
  const c = normalize(category);
  if (c) {
    for (const s of cfg.sectors) if (s.match.some((m) => c.includes(normalize(m)))) return s;
  }
  return cfg.sectors.find((s) => s.key === cfg.defaultSector);
}

/** Danh sách công đoạn hợp lệ (đúng thứ tự) của một sản phẩm. */
function stagesFor(cfg, category) {
  return sectorOf(cfg, category).stages;
}

/** Cấu hình gửi cho giao diện (không có gì nhạy cảm). */
function publicView(cfg) {
  return { defaultSector: cfg.defaultSector, sectors: cfg.sectors.map((s) => ({ key: s.key, label: s.label, intelligence: s.intelligence ?? null, analysis: s.analysis ?? null, sensorStage: s.sensorStage ?? null, stages: s.stages })) };
}

module.exports = { load, validate, sectorOf, stagesFor, publicView };
