// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
import type { KilnInsight, KilnVerdict } from "@/lib/trace";

export const verdictLabel: Record<KilnVerdict, string> = {
  ok: "Đạt chuẩn",
  warn: "Cần xem lại",
  alert: "Cảnh báo",
  insufficient: "Chưa đủ dữ liệu",
};

export const verdictTone: Record<KilnVerdict, string> = {
  ok: "bg-emerald-50 text-emerald-700 border-emerald-200",
  warn: "bg-amber-50 text-amber-800 border-amber-200",
  alert: "bg-red-50 text-red-700 border-red-200",
  insufficient: "bg-stone-100 text-stone-600 border-stone-200",
};

const levelIcon: Record<string, string> = { ok: "✓", info: "ℹ", warn: "⚠", alert: "⛔" };
const levelTone: Record<string, string> = { ok: "text-emerald-700", info: "text-stone-500", warn: "text-amber-700", alert: "text-red-700" };

const verdictIcon: Record<KilnVerdict, string> = { ok: "✓", warn: "⚠", alert: "⛔", insufficient: "…" };

/** Nhãn kết luận: màu đi kèm biểu tượng và chữ, để không phụ thuộc vào màu sắc. */
export function VerdictBadge({ verdict }: { verdict: KilnVerdict }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${verdictTone[verdict]}`}>
      <span aria-hidden="true">{verdictIcon[verdict]}</span>
      {verdictLabel[verdict]}
    </span>
  );
}

/** Kết luận phân tích tự động đường cong nung (luật trên bằng chứng đã được máy chủ đối chiếu). */
export default function KilnInsightPanel({ insight }: { insight: KilnInsight }) {
  return (
    <div className="mt-3 rounded-lg border border-stone-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <VerdictBadge verdict={insight.verdict} />
        <p className="text-sm font-medium text-stone-800">{insight.summary}</p>
      </div>
      <ul className="mt-2 space-y-1 text-xs">
        {insight.findings.map((f) => (
          <li key={f.code} className={`flex gap-1.5 ${levelTone[f.level]}`}>
            <span aria-hidden="true">{levelIcon[f.level]}</span>
            <span>{f.text}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] leading-snug text-stone-500">
        Phân tích tự động theo {insight.profile.terms?.profile ?? "hồ sơ nung"} &ldquo;{insight.profile.name}&rdquo;.
      </p>
    </div>
  );
}
