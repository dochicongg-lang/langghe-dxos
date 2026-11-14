// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const sectors = require("../sectors");

const CFG = sectors.load(path.join(__dirname, "..", "..", "..", "config", "sectors.json"));

test("danh mục gốm sứ và dệt may xếp đúng ngành", () => {
  assert.equal(sectors.sectorOf(CFG, "Gốm sứ").key, "gom");
  assert.equal(sectors.sectorOf(CFG, "Dệt may").key, "lua");
  assert.equal(sectors.sectorOf(CFG, "Lụa tơ tằm").key, "lua");
  assert.equal(sectors.sectorOf(CFG, "Thổ cẩm").key, "lua");
});

test("danh mục lạ hoặc trống dùng ngành mặc định", () => {
  assert.equal(sectors.sectorOf(CFG, "Mây tre đan").key, CFG.defaultSector);
  assert.equal(sectors.sectorOf(CFG, null).key, CFG.defaultSector);
  assert.equal(sectors.sectorOf(CFG, "").key, CFG.defaultSector);
});

test("lụa có công đoạn nhuộm thay cho nung, vẫn đủ bảy công đoạn", () => {
  const lua = sectors.stagesFor(CFG, "Dệt may").map((s) => s.key);
  assert.equal(lua.length, 7);
  assert.ok(lua.includes("nhuom-hoan-thien"));
  assert.ok(!lua.includes("nung-hoan-thien"));
  const gom = sectors.stagesFor(CFG, "Gốm sứ").map((s) => s.key);
  assert.ok(gom.includes("nung-hoan-thien"));
  assert.ok(!gom.includes("nhuom-hoan-thien"));
});

test("cấu hình sai bị từ chối khi nạp", () => {
  assert.throws(() => sectors.validate({ defaultSector: "x", sectors: [] }), /thiếu danh sách/);
  const bad = { defaultSector: "a", sectors: [{ key: "a", label: "A", match: ["a"], stages: [{ key: "b1", label: "B" }, { key: "b1", label: "B" }] }] };
  assert.throws(() => sectors.validate(bad), /trùng/);
  assert.throws(() => sectors.validate({ ...bad, defaultSector: "zzz", sectors: [{ ...bad.sectors[0], stages: [{ key: "b1", label: "B" }, { key: "b2", label: "C" }] }] }), /defaultSector/);
});

test("giao diện nhận cấu hình gọn", () => {
  const v = sectors.publicView(CFG);
  assert.equal(v.sectors.length, 2);
  assert.equal(v.sectors[0].intelligence, "kiln");
  assert.equal(v.sectors[1].intelligence, "dye");
  assert.equal(v.sectors[0].sensorStage, "nung-hoan-thien");
  assert.equal(v.sectors[1].sensorStage, "nhuom-hoan-thien");
});
