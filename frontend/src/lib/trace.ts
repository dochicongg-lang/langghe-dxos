// Kiểu dữ liệu và nhãn cho ứng dụng Tầng 3: truy xuất nguồn gốc sản phẩm làng nghề.

export const stageLabels: Record<string, string> = {
  "nguyen-lieu": "Nguyên liệu",
  "so-che": "Sơ chế",
  "tao-hinh": "Tạo hình",
  "nung-hoan-thien": "Nung / hoàn thiện",
  "kiem-dinh": "Kiểm định",
  "dong-goi": "Đóng gói",
  "phan-phoi": "Phân phối",
};

export const stageOrder = Object.keys(stageLabels);

export interface TraceEvent {
  stage: string;
  note: string;
  location: string;
  actor?: string; // chỉ có ở API nội bộ, ẩn ở tra cứu công khai
  created_at: string;
}

export interface ProductSummary {
  code: string;
  name: string;
  category: string;
  village: string;
  artisan: string;
  created_at: string;
  event_count: number;
  last_stage: string | null;
}

export interface ProductDetail {
  code: string;
  name: string;
  category: string;
  village: string;
  artisan: string;
  created_at: string;
  created_by?: string;
  events: TraceEvent[];
}

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
