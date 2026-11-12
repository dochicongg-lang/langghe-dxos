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

/** Bằng chứng IoT gắn vào công đoạn nung: tóm tắt số liệu cảm biến lò trong khoảng thời gian nung. */
export interface IotEvidence {
  deviceId: string;
  deviceName: string;
  metric: string;
  unit: string;
  from: string; // ISO
  to: string; // ISO
  count: number; // số mẫu đo
  min: number;
  avg: number;
  max: number;
  curve: [number, number][]; // [thời gian ms, giá trị], tối đa 60 điểm
}

export interface TraceEvent {
  stage: string;
  note: string;
  location: string;
  actor?: string; // chỉ có ở API nội bộ, ẩn ở tra cứu công khai
  iot?: IotEvidence | null; // chỉ có ở công đoạn nung khi đã gắn dữ liệu cảm biến
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
