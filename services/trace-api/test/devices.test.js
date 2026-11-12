"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { parseDevices, loadDevices } = require("../devices");

test("parseDevices: đọc danh bạ hợp lệ", () => {
  const m = parseDevices(JSON.stringify({ _doc: "bỏ qua", devices: { "kiln-01": "dxos-iot", "kiln-02": "gw-b" } }));
  assert.equal(m.get("kiln-01"), "dxos-iot");
  assert.equal(m.get("kiln-02"), "gw-b");
  assert.equal(m.size, 2);
});

test("parseDevices: từ chối định dạng sai", () => {
  const bad = [
    "không phải json",
    "[]",
    "{}",
    JSON.stringify({ devices: [] }),
    JSON.stringify({ devices: { "../x": "gw" } }),
    JSON.stringify({ devices: { "kiln-01": "" } }),
    JSON.stringify({ devices: { "kiln-01": "a/b" } }),
    JSON.stringify({ devices: { "kiln-01": 5 } }),
  ];
  for (const t of bad) assert.throws(() => parseDevices(t), Error, t);
});

test("loadDevices: không có tệp -> danh bạ rỗng; có tệp -> đọc được", () => {
  assert.equal(loadDevices(path.join(os.tmpdir(), "khong-ton-tai-" + Date.now() + ".json")).size, 0);
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dev-")), "iot-devices.json");
  fs.writeFileSync(f, JSON.stringify({ devices: { a1: "gw" } }));
  assert.equal(loadDevices(f).get("a1"), "gw");
});

test("danh bạ trong repo (config/iot-devices.json) hợp lệ và có thiết bị lò nung", () => {
  const m = loadDevices(path.join(__dirname, "..", "..", "..", "config", "iot-devices.json"));
  assert.ok(m.has("kiln-01"));
});
