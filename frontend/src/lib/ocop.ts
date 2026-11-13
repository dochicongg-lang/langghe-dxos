// Kiểu dữ liệu và nhãn cho quy trình hỗ trợ hồ sơ OCOP (G2). Hệ thống chỉ hỗ trợ/theo dõi; kết quả chính thức do cơ quan có thẩm quyền.

export const stateLabels: Record<string, string> = {
  draft: "Nháp",
  in_review: "Chờ HTX sơ duyệt",
  needs_revision: "Cần bổ sung",
  awaiting_result: "Chờ kết quả chính thức",
  rejected: "Không đạt sơ duyệt",
  recognized: "Đã được công nhận",
  not_recognized: "Không được công nhận",
};

export const stateTone: Record<string, string> = {
  draft: "bg-stone-100 text-stone-700",
  in_review: "bg-amber-50 text-amber-700",
  needs_revision: "bg-orange-50 text-orange-700",
  awaiting_result: "bg-sky-50 text-sky-700",
  rejected: "bg-red-50 text-red-700",
  recognized: "bg-emerald-50 text-emerald-700",
  not_recognized: "bg-red-50 text-red-700",
};

export const actionLabels: Record<string, string> = {
  submit: "Nộp hồ sơ",
  approve: "Sơ duyệt: Đạt",
  revise: "Yêu cầu bổ sung",
  reject: "Không đạt",
  result: "Ghi kết quả chính thức",
};

export interface OcopProfile {
  id: string;
  name: string;
  verified: boolean;
  sourceNote: string;
  legalBasis: string[];
  authority: { coordinatingOffice: string; council: string; star3and4: string; star5: string };
  scoring: {
    maxTotal: number;
    parts: { key: string; label: string; max: number }[];
    stars: { stars: number; min: number; max: number; level: string }[];
    minStarsRecognized: number;
  };
  validityMonths: number;
  groups: { key: string; label: string }[];
  checklist: { key: string; label: string; required: boolean; onlyGroups?: string[]; exceptGroups?: string[] }[];
}

export interface OcopResult {
  score: number;
  stars: number;
  authority: string;
  decision_no: string;
  decided_at: string;
  valid_until: string | null;
  recognized: boolean;
  recorded_by: string;
}

export interface OcopSummary {
  code: string;
  product_name: string;
  product_group: string;
  owner: string;
  coop: string | null;
  state: string;
  stars: number | null;
  updated_at: string;
}

export interface OcopDetail extends OcopSummary {
  description: string;
  product_code: string | null;
  self_score: Record<string, number> | null;
  documents: string[];
  checklist: { key: string; label: string; required: boolean }[];
  missing_documents: string[];
  expected: { parts: Record<string, number>; total: number; stars: number | null } | null;
  result: OcopResult | null;
  history: { action: string; from_state: string | null; to_state: string; actor: string; note: string; created_at: string }[];
  actions: string[];
  can_update: boolean;
  open_task: { key: string; name: string } | null;
  disclaimer: string;
}

export function starsForScore(profile: OcopProfile, total: number): number | null {
  return profile.scoring.stars.find((s) => total >= s.min && total <= s.max)?.stars ?? null;
}
