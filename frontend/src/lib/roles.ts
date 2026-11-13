// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
// Nhãn vai trò hiển thị cho người dùng (tên role Keycloak = tên policy MinIO, xem config/access.json).
export const roleLabels: Record<string, string> = {
  admin: "Quản trị",
  editor: "Quản trị",
  producer: "Chủ thể sản xuất",
  "coop-officer": "Cán bộ HTX",
  "ocop-officer": "Cán bộ đầu mối OCOP",
  readonly: "Chỉ xem",
  "iot-writer": "Thiết bị IoT",
};

/** Các vai trò nghiệp vụ của người dùng (bỏ role mặc định của Keycloak), đã đổi sang nhãn tiếng Việt, không trùng. */
export function visibleRoles(roles: string[]): string[] {
  return [...new Set(roles.filter((r) => roleLabels[r]).map((r) => roleLabels[r]))];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "")).toUpperCase();
}
