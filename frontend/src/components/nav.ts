// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
// Mục điều hướng, đặt tên theo VIỆC người dùng làm (không dùng thuật ngữ kỹ thuật).
// "main" là việc hằng ngày; "more" là phần quản lý/nền tảng (H-P-D-I) chỉ hiện với vai trò được phép.
export type IconName = "home" | "box" | "file" | "user" | "flow" | "database" | "chart" | "help" | "layers";

export interface NavItem {
  href: string;
  icon: IconName;
  title: string;
  desc: string;
}

export const homeNav: NavItem = { href: "/", icon: "home", title: "Trang chủ", desc: "Việc của bạn" };

export const businessNav: NavItem[] = [
  { href: "/trace", icon: "box", title: "Sản phẩm", desc: "Truy xuất nguồn gốc" },
  { href: "/ocop", icon: "file", title: "Hồ sơ OCOP", desc: "Lập, duyệt, xem kết quả" },
];

export const helpNav: NavItem = { href: "/help", icon: "help", title: "Trợ giúp", desc: "Hướng dẫn và liên hệ" };

export const platformNav: NavItem[] = [
  { href: "/nen-tang", icon: "layers", title: "Cấu trúc nền tảng", desc: "Gốm và lụa trên một nền tảng" },
  { href: "/process", icon: "flow", title: "Việc đang xử lý", desc: "Các bước của hồ sơ" },
  { href: "/data", icon: "database", title: "Dữ liệu", desc: "Lưu trữ và nhật ký" },
  { href: "/intelligence", icon: "chart", title: "Phân tích", desc: "Mẻ nung, mẻ nhuộm và trợ lý hỏi đáp" },
];

const PATHS: Record<IconName, string> = {
  home: "M3 11l9-8 9 8M5 10v10h14V10",
  box: "M21 8l-9-5-9 5v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8",
  file: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  user: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0",
  flow: "M5 4h5v5H5zM14 15h5v5h-5zM7.5 9v3a3 3 0 003 3H14",
  database: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  layers: "M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5",
  help: "M12 21a9 9 0 100-18 9 9 0 000 18zM9.5 9.5a2.5 2.5 0 114 2c-.9.6-1.5 1.1-1.5 2.2M12 17h.01",
};

export function iconPath(name: IconName): string {
  return PATHS[name];
}
