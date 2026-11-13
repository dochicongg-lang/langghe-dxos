// Mục điều hướng. "Nghiệp vụ" là việc người dùng làm hằng ngày; "Nền tảng H-P-D-I" là bốn chặng tiến hóa của Tầng 2.
export interface NavItem {
  href: string;
  letter: string;
  title: string;
  desc: string;
}

export const businessNav: NavItem[] = [
  { href: "/trace", letter: "T", title: "Truy xuất nguồn gốc", desc: "Sản phẩm làng nghề" },
  { href: "/ocop", letter: "O", title: "Hồ sơ OCOP", desc: "Lập, sơ duyệt, kết quả" },
];

export const platformNav: NavItem[] = [
  { href: "/human", letter: "H", title: "Human", desc: "Con người & danh tính" },
  { href: "/process", letter: "P", title: "Process", desc: "Quy trình & workflow" },
  { href: "/data", letter: "D", title: "Data", desc: "Dữ liệu & lưu trữ" },
  { href: "/intelligence", letter: "I", title: "Intelligence", desc: "Phân tích & AI" },
];
