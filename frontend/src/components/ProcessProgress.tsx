// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
import StageIcon from "./StageIcon";
import { fmtDate } from "@/lib/trace";

interface Stage {
  key: string;
  label: string;
}
interface Ev {
  stage: string;
  created_at: string;
  location?: string;
}

/** Thanh tiến độ nhỏ cho thẻ sản phẩm: vị trí công đoạn gần nhất trong chuỗi công đoạn của ngành. */
export function MiniProgress({ stages, lastStage }: { stages: Stage[]; lastStage: string | null }) {
  const idx = lastStage ? stages.findIndex((s) => s.key === lastStage) : -1;
  const done = idx + 1;
  const pct = stages.length ? Math.round((done / stages.length) * 100) : 0;
  return (
    <div className="mt-3" aria-label={`Đã qua ${done} trên ${stages.length} công đoạn`}>
      <div className="flex items-center justify-between text-[11px] text-stone-500">
        <span>Tiến độ sản xuất</span>
        <span className="font-medium text-stone-700">
          {done}/{stages.length}
        </span>
      </div>
      <div className="mt-1 flex gap-0.5" role="presentation">
        {stages.map((s, i) => (
          <span key={s.key} className={`h-1.5 flex-1 rounded-full ${i < done ? (pct === 100 ? "bg-emerald-500" : "bg-brand-500") : "bg-stone-200"}`} />
        ))}
      </div>
    </div>
  );
}

/** Các bước sản xuất của một sản phẩm: đã làm (kèm thời điểm, nơi làm), bước mới nhất, và bước còn lại. */
export default function ProcessProgress({ stages, events, onRecord, skip = [] }: { stages: Stage[]; events: Ev[]; onRecord?: (stageKey: string) => void; skip?: string[] }) {
  const byStage = new Map<string, Ev>();
  for (const e of events) byStage.set(e.stage, e); // lấy lần ghi mới nhất của mỗi công đoạn
  const doneKeys = new Set(byStage.keys());
  let latest = -1;
  stages.forEach((s, i) => {
    if (doneKeys.has(s.key)) latest = i;
  });
  const doneCount = stages.filter((s) => doneKeys.has(s.key)).length;
  const pct = stages.length ? Math.round((doneCount / stages.length) * 100) : 0;
  const complete = doneCount === stages.length && stages.length > 0;
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-stone-800">
          {complete ? "Đã hoàn tất mọi công đoạn" : `Đã làm ${doneCount} trên ${stages.length} công đoạn`}
        </p>
        <p className="text-sm font-bold text-brand-700">{pct}%</p>
      </div>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-stone-200" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Tiến độ sản xuất">
        <div className={`h-full rounded-full transition-all ${complete ? "bg-emerald-500" : "bg-brand-500"}`} style={{ width: `${pct}%` }} />
      </div>
      <ol className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stages.map((s, i) => {
          const ev = byStage.get(s.key);
          const done = Boolean(ev);
          const isLatest = i === latest;
          return (
            <li key={s.key} className={`rounded-xl border p-3 ${isLatest ? "border-brand-300 bg-brand-50" : done ? "border-emerald-200 bg-emerald-50/50" : "border-dashed border-stone-300 bg-stone-50"}`}>
              <div className="flex items-center gap-2.5">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${isLatest ? "bg-brand-600 text-white" : done ? "bg-emerald-600 text-white" : "bg-stone-200 text-stone-400"}`}>
                  {done && !isLatest ? <span aria-hidden="true" className="text-sm font-bold">✓</span> : <StageIcon stage={s.key} className="h-4 w-4" />}
                </span>
                <div className="min-w-0">
                  <p className={`text-sm font-semibold ${done ? "text-stone-900" : "text-stone-500"}`}>{s.label}</p>
                  <p className={`text-[11px] font-medium ${isLatest ? "text-brand-700" : done ? "text-emerald-700" : "text-stone-400"}`}>{isLatest ? "Mới nhất" : done ? "Hoàn tất" : "Chưa thực hiện"}</p>
                </div>
              </div>
              {!done && onRecord && !skip.includes(s.key) && (
                <button type="button" onClick={() => onRecord(s.key)} className="mt-2 w-full rounded-lg border border-brand-300 bg-white px-2 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-50">
                  Ghi nhận công đoạn này
                </button>
              )}
              {ev && (
                <p className="mt-2 text-xs leading-relaxed text-stone-600">
                  {fmtDate(ev.created_at)}
                  {ev.location ? <span className="block break-words text-stone-500">{ev.location}</span> : null}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
