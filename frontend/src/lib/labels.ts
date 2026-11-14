// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
// Cách nói dễ hiểu cho người không chuyên kỹ thuật: mã quyền, phạm vi và vai trò đổi sang câu tiếng Việt thường.
// Tên kỹ thuật (mã quyền, tên policy) chỉ hiện trong phần "Chi tiết kỹ thuật" gập sẵn.

/** Mô tả một câu cho từng vai trò (đồng bộ ý với `desc` trong config/access.json, nhưng viết cho người dùng cuối). */
export const roleDescriptions: Record<string, string> = {
  admin: "Quản lý toàn bộ hệ thống và mọi hồ sơ.",
  editor: "Quản lý toàn bộ hệ thống và mọi hồ sơ.",
  producer: "Quản lý sản phẩm và hồ sơ OCOP của chính bạn.",
  "coop-officer": "Hỗ trợ và sơ duyệt hồ sơ cho các thành viên cùng hợp tác xã. Khi đăng nhập trên trình duyệt, bạn cần thêm mã xác minh.",
  "ocop-officer": "Xem mọi hồ sơ và ghi kết quả OCOP chính thức.",
  readonly: "Chỉ xem thông tin, không chỉnh sửa được.",
  "iot-writer": "Tài khoản của thiết bị cảm biến, chỉ dùng để gửi số liệu.",
};

export const scopePhrase: Record<string, string> = {
  all: "toàn hệ thống",
  coop: "trong hợp tác xã của bạn",
  own: "do chính bạn phụ trách",
  self: "cho chính bạn",
};

export interface PermissionGroup {
  title: string;
  items: { code: string; text: string }[];
}

/** Quyền nhóm theo công việc, kèm câu mô tả. Mã quyền lạ (thêm sau này) rơi vào nhóm "Khác" với chính mã đó. */
export const permissionGroups: PermissionGroup[] = [
  {
    title: "Sản phẩm và truy xuất nguồn gốc",
    items: [
      { code: "product.read", text: "Xem sản phẩm và hành trình của chúng" },
      { code: "product.create", text: "Thêm sản phẩm mới" },
      { code: "product.update", text: "Ghi thêm công đoạn cho sản phẩm" },
    ],
  },
  {
    title: "Hồ sơ OCOP",
    items: [
      { code: "application.read", text: "Xem hồ sơ OCOP" },
      { code: "application.create", text: "Lập hồ sơ OCOP mới" },
      { code: "application.update", text: "Sửa, đính kèm giấy tờ và nộp hồ sơ" },
      { code: "application.review", text: "Sơ duyệt hồ sơ tại hợp tác xã" },
      { code: "application.decide", text: "Ghi kết quả OCOP chính thức" },
    ],
  },
  {
    title: "Quản trị hệ thống",
    items: [
      { code: "archive.manage", text: "Quản lý việc lưu trữ dữ liệu cũ" },
      { code: "audit.read", text: "Xem nhật ký hoạt động của hệ thống" },
    ],
  },
];

/** Danh sách việc người dùng làm được, nhóm theo công việc; bỏ nhóm không có việc nào. */
export function groupedAbilities(permissions: Record<string, string>) {
  const known = new Set(permissionGroups.flatMap((g) => g.items.map((i) => i.code)));
  const groups = permissionGroups
    .map((g) => ({
      title: g.title,
      items: g.items.filter((i) => permissions[i.code]).map((i) => ({ text: i.text, scope: scopePhrase[permissions[i.code]] ?? permissions[i.code] })),
    }))
    .filter((g) => g.items.length > 0);
  const other = Object.keys(permissions).filter((c) => !known.has(c));
  if (other.length) groups.push({ title: "Khác", items: other.map((c) => ({ text: c, scope: scopePhrase[permissions[c]] ?? permissions[c] })) });
  return groups;
}
