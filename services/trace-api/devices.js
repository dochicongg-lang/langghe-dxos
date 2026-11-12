"use strict";
/**
 * Danh bạ thiết bị: mỗi thiết bị cảm biến (deviceId) thuộc về ĐÚNG MỘT cổng thu thập (gateway = client Keycloak).
 *
 * Vì sao cần: MinIO chỉ cho mỗi gateway ghi vào thư mục riêng iot/service-account-<client>/ (policy iot-writer dùng
 * biến ${jwt:preferred_username}). Khi dựng bằng chứng, trace-api chỉ đọc thư mục của gateway SỞ HỮU thiết bị đó,
 * nên một gateway bị lộ khóa không thể giả số liệu của thiết bị thuộc gateway khác (dù có ghi deviceId trùng).
 *
 * File JSON (config/iot-devices.json): { "devices": { "kiln-01": "dxos-iot", ... } }
 */
const fs = require("node:fs");

const DEVICE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/;
const GATEWAY_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/;

/** Phân tích nội dung JSON thành Map(deviceId -> gateway). Ném lỗi nếu sai định dạng. */
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
  for (const [id, gw] of Object.entries(devices)) {
    if (!DEVICE_RE.test(id)) throw new Error(`deviceId không hợp lệ: ${id}`);
    if (typeof gw !== "string" || !GATEWAY_RE.test(gw)) throw new Error(`gateway của thiết bị ${id} không hợp lệ`);
    map.set(id, gw);
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
