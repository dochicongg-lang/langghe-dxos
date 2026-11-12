"use strict";
/**
 * Vai trò (claim "policy" trong JWT Keycloak; tên role = tên policy MinIO):
 *   editor      nhân viên: xem và tạo/sửa dữ liệu truy xuất
 *   readonly    chỉ xem
 *   iot-writer  thiết bị IoT: chỉ ghi dữ liệu cảm biến vào MinIO, KHÔNG dùng được API nghiệp vụ này
 */
const READERS = ["editor", "readonly"];
const WRITERS = ["editor"];

const canRead = (roles) => Array.isArray(roles) && roles.some((r) => READERS.includes(r));
const canWrite = (roles) => Array.isArray(roles) && roles.some((r) => WRITERS.includes(r));

module.exports = { canRead, canWrite };
