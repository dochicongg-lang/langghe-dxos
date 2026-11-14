// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
import Tip from "@/components/Tip";
import type { IotEvidence, ReferenceCurve } from "@/lib/trace";

/**
 * Đường cong của mẻ này chồng lên đường chuẩn: trung vị (nét đứt) và dải thường gặp (vùng mờ) của các mẻ ĐẠT khác trên cùng thiết bị.
 * Hai đường được căn theo tỉ lệ thời gian từ đầu đến cuối mẻ nên mẻ dài ngắn khác nhau vẫn so được.
 */
export default function CurveCompare({ iot, reference }: { iot: IotEvidence; reference: ReferenceCurve }) {
  const w = 300;
  const h = 110;
  const pad = 6;
  const cur = [...iot.curve].sort((a, b) => a[0] - b[0]);
  if (cur.length < 2 || !reference.enough || reference.points.length < 2) return null;
  const t0 = cur[0][0];
  const t1 = cur[cur.length - 1][0];
  const all = [...cur.map((p) => p[1]), ...reference.points.flatMap((p) => [p[2], p[3]])];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = hi === lo ? 1 : hi - lo;
  const x = (f: number) => pad + f * (w - 2 * pad);
  const y = (v: number) => pad + (1 - (v - lo) / span) * (h - 2 * pad);
  const mine = cur.map(([t, v]) => `${x(t1 === t0 ? 0.5 : (t - t0) / (t1 - t0)).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const med = reference.points.map((p) => `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(" ");
  const band = [...reference.points.map((p) => `${x(p[0]).toFixed(1)},${y(p[3]).toFixed(1)}`), ...[...reference.points].reverse().map((p) => `${x(p[0]).toFixed(1)},${y(p[2]).toFixed(1)}`)].join(" ");
  const note = reference.note;

  return (
    <div className="mt-2">
      <p className="text-xs font-medium text-stone-600">
        So với đường chuẩn
        <Tip text="Đường chuẩn là trung vị của các mẻ đạt khác trên cùng thiết bị, căn theo tỉ lệ thời gian của mẻ." />
      </p>
      <svg viewBox={`0 0 ${w} ${h}`} className="mt-1 h-28 w-full" preserveAspectRatio="none" role="img" aria-label="Đường cong của mẻ này so với đường chuẩn của các mẻ đạt">
        <polygon points={band} className="fill-stone-300/50" />
        <polyline points={med} fill="none" stroke="#78716c" strokeWidth="1.5" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
        <polyline points={mine} fill="none" stroke="#c04a1f" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-stone-500">
        <span className="inline-flex items-center gap-1">
          <span aria-hidden="true" className="inline-block h-0.5 w-4 bg-brand-600" />
          Mẻ này
        </span>
        <span className="inline-flex items-center gap-1">
          <span aria-hidden="true" className="inline-block w-4 border-t-2 border-dashed border-stone-500" />
          Trung vị
        </span>
        <span className="inline-flex items-center gap-1">
          <span aria-hidden="true" className="inline-block h-2.5 w-4 rounded-sm bg-stone-300/70" />
          Dải thường gặp ({reference.n} mẻ đạt)
        </span>
      </p>
      {note && <p className={`mt-1.5 rounded-md p-2 text-xs ${note.level === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>{note.text}</p>}
    </div>
  );
}
