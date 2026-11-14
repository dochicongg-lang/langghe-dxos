// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
import type { IotEvidence } from "@/lib/trace";

const fmtClock = (ms: number) => new Date(ms).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });

/**
 * Đường cong nhiệt độ lò dạng lớn, có trục và điểm đỉnh: "dấu vân tay nhiệt" của một mẻ nung.
 * Số liệu lấy nguyên từ bằng chứng IoT đã được máy chủ đối chiếu; không thêm hay làm mịn điểm nào.
 */
export default function KilnCurve({ iot }: { iot: IotEvidence }) {
  const W = 460;
  const H = 240;
  const padL = 46;
  const padR = 16;
  const padT = 20;
  const padB = 30;
  const pts = iot.curve;
  if (pts.length < 2) return null;

  const ts = pts.map((p) => p[0]);
  const vs = pts.map((p) => p[1]);
  const t0 = Math.min(...ts);
  const t1 = Math.max(...ts);
  const lo = Math.floor(Math.min(...vs) / 50) * 50;
  const hi = Math.ceil(Math.max(...vs) / 50) * 50 || lo + 50;
  const span = hi === lo ? 1 : hi - lo;
  const x = (t: number) => padL + (t1 === t0 ? 0.5 : (t - t0) / (t1 - t0)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - lo) / span) * (H - padT - padB);

  const line = pts.map(([t, v], i) => `${i ? "L" : "M"}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(t1).toFixed(1)},${H - padB} L${x(t0).toFixed(1)},${H - padB} Z`;
  const peak = pts.reduce((a, b) => (b[1] > a[1] ? b : a));
  const ticks = [lo, (lo + hi) / 2, hi];
  const peakLeft = x(peak[0]) < W / 2;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto h-auto w-full max-w-xl" role="img" aria-label={`Đường cong nhiệt độ lò, cao nhất ${peak[1]} ${iot.unit}`}>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="currentColor" className="text-stone-200" strokeDasharray="3 4" />
          <text x={padL - 8} y={y(v) + 4} textAnchor="end" className="fill-stone-500" fontSize="13">
            {Math.round(v)}
          </text>
        </g>
      ))}
      <text x={padL - 8} y={10} textAnchor="end" className="fill-stone-500" fontSize="13">
        {iot.unit}
      </text>
      <path d={area} className="fill-brand-500/10" />
      <path d={line} pathLength={1} fill="none" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" className="curve-draw stroke-brand-600" />
      <line x1={x(peak[0])} x2={x(peak[0])} y1={y(peak[1])} y2={H - padB} stroke="currentColor" className="text-brand-300" strokeDasharray="2 3" />
      <circle cx={x(peak[0])} cy={y(peak[1])} r="5" className="fill-brand-600 stroke-white" strokeWidth="2" />
      <text x={x(peak[0]) + (peakLeft ? 10 : -10)} y={y(peak[1]) - 8} textAnchor={peakLeft ? "start" : "end"} className="fill-brand-800" fontSize="13" fontWeight="600">
        Đỉnh {peak[1]} {iot.unit}
      </text>
      <text x={padL} y={H - 8} className="fill-stone-500" fontSize="13">
        {fmtClock(t0)}
      </text>
      <text x={W - padR} y={H - 8} textAnchor="end" className="fill-stone-500" fontSize="13">
        {fmtClock(t1)}
      </text>
    </svg>
  );
}
