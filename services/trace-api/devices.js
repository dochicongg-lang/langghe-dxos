"use strict";
/**
 * Danh bạ thiết bị: mỗi thiết bị cảm biến (deviceId) thuộc về ĐÚNG MỘT cổng thu thập (gateway = client Keycloak).
 *
 * Vì sao cần: MinIO chỉ cho mỗi gateway ghi vào thư mục riêng iot/service-account-<client>/ (policy iot-writer dùng
 * biến ${jwt:preferred_username}). Khi dựng bằng chứng, trace-api chỉ đọc thư mục của gateway SỞ HỮU thiết bị đó,
 * nên một gateway bị lộ khóa không thể giả số liệu của thiết bị thuộc gateway khác (dù có ghi deviceId trùng).
 *
 * File JSON (config/iot-devices.json). Mỗi thiết bị là tên gateway, hoặc đối tượng kèm giới hạn hợp lý để phát hiện số liệu đáng ngờ:
 *   { "devices": { "kiln-01": { "gateway": "dxos-iot", "min": 0, "max": 1400, "maxRatePerSec": 30 }, "kiln-02": "gw-b" } }
 *   min/max: khoảng giá trị khả dĩ (mẫu ngoài khoảng bị loại và báo); maxRatePerSec: tốc độ đổi tối đa (vượt thì gắn cờ).
 */
const fs = require("node:fs");

const DEVICE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/;
const GATEWAY_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/;

/** Phân tích nội dung JSON thành Map(deviceId -> { gateway, min?, max?, maxRatePerSec? }). Ném lỗi nếu sai định dạng. */
function parseDevices(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error("iot-devices.json không phải JSON hợp lệ");
  }
  const devices = doc?.devices;
  if (typeof devices !== "object" || devices === null || Array.isArray(devices)) throw new Error('iot-devices.json cần có đối tượng "devices"');
  const map = new Map();
  const limit = (v, name, id) => {
    if (v === undefined) return undefined;
    if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${name} của thiết bị ${id} phải là số`);
    return v;
  };
  for (const [id, entry] of Object.entries(devices)) {
    if (!DEVICE_RE.test(id)) throw new Error(`deviceId không hợp lệ: ${id}`);
    const o = typeof entry === "string" ? { gateway: entry } : entry;
    if (typeof o !== "object" || o === null || Array.isArray(o)) throw new Error(`cấu hình thiết bị ${id} không hợp lệ`);
    if (typeof o.gateway !== "string" || !GATEWAY_RE.test(o.gateway)) throw new Error(`gateway của thiết bị ${id} không hợp lệ`);
    const min = limit(o.min, "min", id);
    const max = limit(o.max, "max", id);
    const maxRatePerSec = limit(o.maxRatePerSec, "maxRatePerSec", id);
    if (min !== undefined && max !== undefined && min >= max) throw new Error(`min phải nhỏ hơn max (thiết bị ${id})`);
    if (maxRatePerSec !== undefined && maxRatePerSec <= 0) throw new Error(`maxRatePerSec phải > 0 (thiết bị ${id})`);
    map.set(id, { gateway: o.gateway, min, max, maxRatePerSec });
  }
  return map;
}

/** Đọc danh bạ từ tệp. Không có tệp -> danh bạ rỗng (tính năng gắn IoT sẽ báo thiết bị chưa đăng ký). */
function loadDevices(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return new Map();
    throw e;
  }
  return parseDevices(text);
}

module.exports = { parseDevices, loadDevices };
