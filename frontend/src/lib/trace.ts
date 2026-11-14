// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
// Kiểu dữ liệu và nhãn cho ứng dụng Tầng 3: truy xuất nguồn gốc sản phẩm làng nghề.

export const stageLabels: Record<string, string> = {
  "nguyen-lieu": "Nguyên liệu",
  "so-che": "Sơ chế",
  "tao-hinh": "Tạo hình",
  "nung-hoan-thien": "Nung / hoàn thiện",
  "kiem-dinh": "Kiểm định",
  "dong-goi": "Đóng gói",
  "phan-phoi": "Phân phối",
  "nhuom-hoan-thien": "Nhuộm, hoàn thiện",
};

// Thứ tự chuẩn của ngành mặc định (gốm); mỗi ngành có chuỗi riêng do máy chủ trả về trong ProductDetail.stages
export const stageOrder = ["nguyen-lieu", "so-che", "tao-hinh", "nung-hoan-thien", "kiem-dinh", "dong-goi", "phan-phoi"];

/** Chất lượng số liệu cảm biến trong khoảng nung (máy chủ tự đánh giá). */
export interface IotQuality {
  coverage: number; // 0..1: tỷ lệ thời gian nung có dữ liệu liên tục
  maxGapSec: number; // khoảng trống lớn nhất giữa hai mẫu (kể cả đầu/cuối)
  rejected: number; // mẫu ngoài khoảng giá trị hợp lý đã bị loại
  jumps: number; // số lần giá trị đổi nhanh bất thường
  overwritten?: number; // số tệp bị ghi đè sau khi ghi (hệ thống dùng bản ghi đầu tiên)
  deleted?: number; // số tệp bị yêu cầu xóa (bản gốc vẫn được giữ)
  flags: string[]; // low-coverage | out-of-range | rapid-change | few-samples | object-overwritten | object-deleted
}

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
  gateway?: string; // gateway (client Keycloak) sở hữu thiết bị
  quality?: IotQuality; // chất lượng số liệu do máy chủ đánh giá
  verifiedAt?: string; // thời điểm máy chủ tự đối chiếu với dữ liệu cảm biến trên MinIO
}

export type KilnVerdict = "ok" | "warn" | "alert" | "insufficient";

export interface KilnInsight {
  verdict: KilnVerdict;
  summary: string;
  findings: { code: string; level: "alert" | "warn" | "info" | "ok"; text: string }[];
  metrics: { peak: number | null; samples: number; durationMin?: number; holdMin?: number; maxRampPerHour?: number | null; maxCoolPerHour?: number | null };
  baseline: { runs: number; medianPeak: number; deviationPct: number } | null;
  profile: { id: string; name: string; verified: boolean; terms?: Record<string, string> };
}

export interface ReferenceCurve {
  n: number; // số mẻ đạt khác dùng để dựng đường chuẩn
  enough: boolean; // đủ mẻ (>= 3) mới có đường chuẩn
  points: [number, number, number, number][]; // [tỉ lệ thời gian, trung vị, phân vị 25, phân vị 75]
  note: { level: "ok" | "warn"; text: string } | null;
}

export interface TraceEvent {
  stage: string;
  note: string;
  location: string;
  actor?: string; // chỉ có ở API nội bộ, ẩn ở tra cứu công khai
  iot?: IotEvidence | null; // chỉ có ở công đoạn nung khi đã gắn dữ liệu cảm biến
  insight?: KilnInsight | null; // phân tích thông minh đường cong nung (máy chủ tính từ bằng chứng đã đối chiếu)
  reference?: ReferenceCurve | null; // đường chuẩn so với các mẻ đạt khác (chỉ API nội bộ)
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
  sector?: string; // gom | lua ...
  owner?: string | null;
  coop?: string | null;
}

/** Thông tin OCOP công khai: "xác nhận của nền tảng" tách bạch với "kết quả OCOP chính thức" do cơ quan có thẩm quyền ra. */
export interface PublicOcop {
  platform: { confirmed_at: string; note: string } | null;
  official: { stars: number; authority: string; decision_no: string; decided_at: string; valid_until: string; active: boolean } | null;
}

export interface ProductDetail {
  code: string;
  name: string;
  category: string;
  sector?: string;
  sector_label?: string;
  sensor_stage?: string | null; // công đoạn được gắn dữ liệu cảm biến (gốm: nung, lụa: nhuộm)
  stages?: { key: string; label: string }[]; // chuỗi công đoạn của ngành sản phẩm này
  village: string;
  artisan: string;
  created_at: string;
  created_by?: string;
  owner?: string | null; // người tạo/chủ sở hữu (chỉ ở API nội bộ)
  coop?: string | null; // mã HTX (chỉ ở API nội bộ)
  ocop?: PublicOcop | null; // chỉ có ở tra cứu công khai
  can_update?: boolean; // người dùng hiện tại có được thêm công đoạn cho sản phẩm này không (máy chủ tính)
  events: TraceEvent[];
}

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
