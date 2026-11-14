// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use client";

import { useEffect, useState } from "react";
import type { Series } from "@/lib/iot";

type Kind = "kiln" | "dye";
type Phase = "idle" | "cold" | "ramp" | "hold" | "cool";
interface Pt {
  t: number;
  v: number;
}

/**
 * Cấu hình theo nghề. Vùng tham chiếu lấy từ hồ sơ trong config/kiln-profiles.json: là số liệu THAM KHẢO/MINH HỌA, chưa được thợ hoặc chuyên gia xác nhận.
 * Nhuộm tơ: khuyến cáo nhuộm tơ tằm bằng thuốc nhuộm axit ở 85–90 °C, giữ khoảng 35–40 phút, không để sôi, nâng nhiệt khoảng 1 °C mỗi phút.
 */
const KINDS: Record<
  Kind,
  {
    prefix: string;
    scaleMax: number;
    ticks: number[];
    ref: { peakMin: number; peakMax: number; critical: number; holdAbove: number; holdMinutes: number; rampMaxPerHour: number };
    nearBand: number; // sát đỉnh trong khoảng này thì tính là đang giữ nhiệt
    rampFrom: number;
    rampWindowMin: number;
    cold: { last: number; peak: number };
    labels: { phases: [string, string, string, string]; total: string; recent: string; aria: string; device: string; peakNote: string; note: string };
  }
> = {
  kiln: {
    prefix: "kiln",
    scaleMax: 1400,
    ticks: [0, 400, 800, 1200],
    ref: { peakMin: 1100, peakMax: 1220, critical: 1300, holdAbove: 1100, holdMinutes: 60, rampMaxPerHour: 250 },
    nearBand: 30,
    rampFrom: 300,
    rampWindowMin: 30,
    cold: { last: 80, peak: 200 },
    labels: {
      phases: ["Chuẩn bị", "Gia nhiệt", "Giữ nhiệt", "Làm nguội"],
      total: "Tổng thời gian nung",
      recent: "Mẻ nung gần nhất",
      aria: "Các giai đoạn của mẻ nung",
      device: "lò",
      peakNote: "Vùng đỉnh chuẩn",
      note: "Vùng tham chiếu lấy từ hồ sơ nung đang dùng; đây là số liệu minh họa, chưa được thợ gốm hoặc chuyên gia xác nhận. Kết luận cho từng sản phẩm xem ở mục bên dưới.",
    },
  },
  dye: {
    prefix: "dye",
    scaleMax: 120,
    ticks: [0, 40, 80, 120],
    ref: { peakMin: 85, peakMax: 93, critical: 100, holdAbove: 82, holdMinutes: 30, rampMaxPerHour: 90 },
    nearBand: 4,
    rampFrom: 30,
    rampWindowMin: 15,
    cold: { last: 40, peak: 45 },
    labels: {
      phases: ["Chuẩn bị bể", "Nâng nhiệt", "Giữ nhiệt", "Hạ nhiệt"],
      total: "Tổng thời gian nhuộm",
      recent: "Mẻ nhuộm gần nhất",
      aria: "Các giai đoạn của mẻ nhuộm",
      device: "bể nhuộm",
      peakNote: "Vùng nhiệt nhuộm",
      note: "Ngưỡng tham khảo từ tài liệu về nhuộm tơ tằm bằng thuốc nhuộm axit (85–90 °C, giữ khoảng 35–40 phút, không để sôi); không phải số liệu riêng của làng lụa và chưa được nghệ nhân hoặc chuyên gia xác nhận. Kết luận cho từng sản phẩm xem ở mục bên dưới.",
    },
  },
};

type KindCfg = (typeof KINDS)[Kind];
const LIVE_WITHIN_MS = 15 * 60_000;
const PHASE_KEYS: Exclude<Phase, "idle">[] = ["cold", "ramp", "hold", "cool"];

const fmtDur = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60_000));
  return m >= 60 ? `${Math.floor(m / 60)} giờ ${m % 60} phút` : `${m} phút`;
};
const fmtTime = (t: number) => {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())} ngày ${p(d.getDate())}/${p(d.getMonth() + 1)}`;
};

/** Chia mẻ thành các giai đoạn dựa trên đường cong: đến sát đỉnh = nâng nhiệt, quanh đỉnh = giữ nhiệt, sau đó = hạ nhiệt. */
function analyze(points: Pt[], now: number, k: KindCfg) {
  const last = points[points.length - 1];
  const first = points[0];
  let peak = first;
  for (const p of points) if (p.v > peak.v) peak = p;
  const near = peak.v - k.nearBand;
  const rampEnd = points.findIndex((p) => p.v >= near);
  let holdEnd = rampEnd;
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].v >= near) {
      holdEnd = i;
      break;
    }
  }
  const lastIdx = points.length - 1;
  const live = now - last.t <= LIVE_WITHIN_MS;
  let phase: Phase;
  if (last.v < k.cold.last && peak.v < k.cold.peak) phase = "cold";
  else if (lastIdx <= rampEnd) phase = "ramp";
  else if (lastIdx <= holdEnd) phase = "hold";
  else phase = "cool";
  let holdMs = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].v >= k.ref.holdAbove && points[i - 1].v >= k.ref.holdAbove) holdMs += Math.min(points[i].t - points[i - 1].t, 10 * 60_000);
  }
  let maxRamp = 0;
  for (let i = 0, j = 0; i < points.length; i++) {
    while (j < i && points[i].t - points[j].t > k.rampWindowMin * 60_000) j++;
    const dt = points[i].t - points[j].t;
    if (j < i && dt >= (k.rampWindowMin * 2 * 60_000) / 3 && points[j].v >= k.rampFrom && i <= rampEnd + 1) maxRamp = Math.max(maxRamp, ((points[i].v - points[j].v) / dt) * 3_600_000);
  }
  return { first, last, peak, rampEnd, holdEnd, phase, live, holdMs, maxRamp };
}

function arcPath(cx: number, cy: number, r: number, from: number, to: number) {
  const a = (d: number) => ({ x: cx + r * Math.cos(Math.PI - (d / 180) * Math.PI), y: cy - r * Math.sin(Math.PI - (d / 180) * Math.PI) });
  const s = a(from);
  const e = a(to);
  return `M ${s.x.toFixed(1)} ${s.y.toFixed(1)} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${e.x.toFixed(1)} ${e.y.toFixed(1)}`;
}

function Gauge({ value, peak, tone, k, aria }: { value: number; peak: number; tone: string; k: KindCfg; aria: string }) {
  const deg = (v: number) => Math.max(0, Math.min(180, (v / k.scaleMax) * 180));
  const needle = deg(value);
  const nx = 110 + 66 * Math.cos(Math.PI - (needle / 180) * Math.PI);
  const ny = 110 - 66 * Math.sin(Math.PI - (needle / 180) * Math.PI);
  return (
    <svg viewBox="0 0 220 124" className="mx-auto w-full max-w-[260px]" role="img" aria-label={`${aria} ${Math.round(value)} độ C`}>
      <path d={arcPath(110, 110, 84, 0, 180)} fill="none" stroke="#E7E0D8" strokeWidth="16" strokeLinecap="round" />
      <path d={arcPath(110, 110, 84, 0, deg(value))} fill="none" stroke={tone} strokeWidth="16" strokeLinecap="round" />
      <path d={arcPath(110, 110, 98, deg(k.ref.peakMin), deg(k.ref.peakMax))} fill="none" stroke="#2F9E6B" strokeWidth="5" strokeLinecap="round" />
      <path d={arcPath(110, 110, 98, deg(k.ref.critical), 180)} fill="none" stroke="#D2483A" strokeWidth="5" strokeLinecap="round" />
      <line x1="110" y1="110" x2={nx} y2={ny} stroke="#2B211C" strokeWidth="3" strokeLinecap="round" />
      <circle cx="110" cy="110" r="6" fill="#2B211C" />
      <text x="14" y="122" fontSize="10" className="fill-stone-400">
        0
      </text>
      <text x="206" y="122" fontSize="10" textAnchor="end" className="fill-stone-400">
        {k.scaleMax}
      </text>
      <title>{`Cao nhất đã đạt ${Math.round(peak)} độ C`}</title>
    </svg>
  );
}

function Chart({ points, a, k, label }: { points: Pt[]; a: ReturnType<typeof analyze>; k: KindCfg; label: string }) {
  const W = 640;
  const H = 220;
  const L = 44;
  const R = 12;
  const T = 12;
  const B = 28;
  const step = Math.max(1, Math.ceil(points.length / 240));
  const pts = points.filter((_, i) => i % step === 0 || i === points.length - 1);
  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  const x = (t: number) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const y = (v: number) => T + (1 - Math.min(v, k.scaleMax) / k.scaleMax) * (H - T - B);
  const line = pts.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const area = `${x(t0).toFixed(1)},${y(0)} ${line} ${x(t1).toFixed(1)},${y(0)}`;
  const mark = (i: number) => x(points[Math.min(i, points.length - 1)].t);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={label}>
      <rect x={L} y={y(k.ref.peakMax)} width={W - L - R} height={y(k.ref.peakMin) - y(k.ref.peakMax)} fill="#2F9E6B" opacity="0.14" />
      <line x1={L} x2={W - R} y1={y(k.ref.critical)} y2={y(k.ref.critical)} stroke="#D2483A" strokeDasharray="5 4" strokeWidth="1.2" />
      {k.ticks.map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#E7E0D8" strokeWidth="1" />
          <text x={L - 6} y={y(v) + 3} textAnchor="end" fontSize="10" className="fill-stone-400">
            {v}
          </text>
        </g>
      ))}
      <polygon points={area} fill="#C04A1F" opacity="0.12" />
      <polyline points={line} fill="none" stroke="#C04A1F" strokeWidth="2.2" strokeLinejoin="round" />
      {[a.rampEnd, a.holdEnd].map((i, n) => (
        <line key={n} x1={mark(i)} x2={mark(i)} y1={T} y2={H - B} stroke="#9F8E80" strokeDasharray="3 3" strokeWidth="1" />
      ))}
      <circle cx={x(a.peak.t)} cy={y(a.peak.v)} r="4.5" fill="#fff" stroke="#C04A1F" strokeWidth="2" />
      <text x={x(a.peak.t)} y={y(a.peak.v) - 9} textAnchor="middle" fontSize="11" fontWeight="600" className="fill-stone-800">
        {Math.round(a.peak.v)}°C
      </text>
      <text x={L} y={H - 8} fontSize="10" className="fill-stone-500">
        {fmtTime(t0)}
      </text>
      <text x={W - R} y={H - 8} textAnchor="end" fontSize="10" className="fill-stone-500">
        {fmtTime(t1)}
      </text>
    </svg>
  );
}

const TONE: Record<Phase, { label: string; pill: string; gauge: string }> = {
  idle: { label: "Đang nghỉ (không có dữ liệu mới)", pill: "bg-stone-100 text-stone-700", gauge: "#A8A29E" },
  cold: { label: "Nguội, sẵn sàng", pill: "bg-sky-50 text-sky-800", gauge: "#5B9BD5" },
  ramp: { label: "Đang nâng nhiệt", pill: "bg-orange-50 text-orange-800", gauge: "#E8742A" },
  hold: { label: "Đang giữ nhiệt", pill: "bg-red-50 text-red-800", gauge: "#C0392B" },
  cool: { label: "Đang hạ nhiệt", pill: "bg-amber-50 text-amber-800", gauge: "#D49A2A" },
};

/** Bảng theo dõi trạng thái lò nung (gốm) hoặc bể nhuộm (lụa): đồng hồ nhiệt, giai đoạn, các chỉ số chính và đường cong. Số liệu lấy từ cảm biến. */
export default function KilnStatusBoard({ series, kind = "kiln" }: { series: Series[]; kind?: Kind }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const k = KINDS[kind];
  const sensor = series.find((s) => s.id.startsWith(k.prefix) && s.metric === "temperature");
  if (!sensor || sensor.points.length < 2) return null;
  const a = analyze(sensor.points, now, k);
  const shown: Phase = a.live ? a.phase : "idle";
  const tone = TONE[shown];
  const curIdx = PHASE_KEYS.indexOf(a.phase as Exclude<Phase, "idle">);
  const dur = {
    cold: 0,
    ramp: sensor.points[a.rampEnd].t - a.first.t,
    hold: sensor.points[a.holdEnd].t - sensor.points[a.rampEnd].t,
    cool: a.last.t - sensor.points[a.holdEnd].t,
  };
  const r = k.ref;
  const tiles = [
    { label: "Nhiệt độ đỉnh", value: `${Math.round(a.peak.v)} °C`, note: `${k.labels.peakNote} ${r.peakMin}–${r.peakMax} °C`, ok: a.peak.v >= r.peakMin && a.peak.v <= r.peakMax, bad: a.peak.v > r.critical },
    { label: "Thời gian giữ nhiệt", value: fmtDur(a.holdMs), note: `Cần từ ${r.holdMinutes} phút trên ${r.holdAbove} °C`, ok: a.holdMs >= r.holdMinutes * 60_000, bad: false },
    { label: "Tốc độ nâng nhiệt lớn nhất", value: `${Math.round(a.maxRamp)} °C/giờ`, note: `Không quá ${r.rampMaxPerHour} °C/giờ`, ok: a.maxRamp <= r.rampMaxPerHour, bad: a.maxRamp > r.rampMaxPerHour * 1.3 },
    { label: k.labels.total, value: fmtDur(a.last.t - a.first.t), note: `Từ ${fmtTime(a.first.t)}`, ok: true, bad: false },
  ];
  const id = `board-${kind}`;
  return (
    <section aria-labelledby={id} className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id={id} className="text-lg font-semibold text-stone-900">
            {sensor.deviceName}
          </h2>
          <p className="text-xs text-stone-500">
            {a.live ? "Dữ liệu trực tiếp từ cảm biến" : k.labels.recent} · cập nhật {fmtTime(a.last.t)}
          </p>
        </div>
        <span className={`rounded-full px-3.5 py-1.5 text-sm font-semibold ${tone.pill}`}>{tone.label}</span>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[260px_1fr] lg:items-center">
        <div>
          <Gauge value={a.last.v} peak={a.peak.v} tone={tone.gauge} k={k} aria={`Nhiệt độ ${k.labels.device}`} />
          <p className="mt-1 text-center text-3xl font-bold text-stone-900">{Math.round(a.last.v)} °C</p>
          <p className="text-center text-xs text-stone-500">
            {a.live ? "Nhiệt độ hiện tại" : "Nhiệt độ ở điểm đo cuối"} · cao nhất đã đạt {Math.round(a.peak.v)} °C
          </p>
        </div>
        <ol className="grid grid-cols-4 gap-2" aria-label={k.labels.aria}>
          {PHASE_KEYS.map((pk, i) => {
            const done = i < curIdx || (!a.live && i === curIdx);
            const cur = a.live && i === curIdx;
            return (
              <li key={pk} className={`rounded-xl border p-3 text-center ${cur ? "border-brand-400 bg-brand-50" : done ? "border-emerald-200 bg-emerald-50/60" : "border-stone-200 bg-stone-50"}`}>
                <span className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${cur ? "bg-brand-600 text-white" : done ? "bg-emerald-600 text-white" : "bg-stone-200 text-stone-500"}`}>{done ? "✓" : i + 1}</span>
                <p className="mt-1.5 text-xs font-semibold text-stone-800">{k.labels.phases[i]}</p>
                <p className="text-[11px] text-stone-500">{pk === "cold" ? "—" : fmtDur(dur[pk])}</p>
              </li>
            );
          })}
        </ol>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className={`rounded-xl border p-3 ${t.bad ? "border-red-200 bg-red-50" : t.ok ? "border-stone-200 bg-stone-50" : "border-amber-200 bg-amber-50"}`}>
            <dt className="text-xs text-stone-500">{t.label}</dt>
            <dd className={`mt-0.5 text-lg font-bold ${t.bad ? "text-red-700" : t.ok ? "text-stone-900" : "text-amber-800"}`}>{t.value}</dd>
            <p className="text-[11px] text-stone-500">
              {t.bad ? "Vượt giới hạn. " : t.ok ? "" : "Lệch chuẩn. "}
              {t.note}
            </p>
          </div>
        ))}
      </dl>

      <div className="mt-5 rounded-xl bg-stone-50 p-3 sm:p-4">
        <Chart points={sensor.points} a={a} k={k} label={`Đường cong nhiệt độ của ${k.labels.recent.toLowerCase()}`} />
        <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-stone-500">
          <span className="inline-flex items-center gap-1">
            <i className="inline-block h-2.5 w-4 rounded-sm bg-emerald-600/30" /> {k.labels.peakNote}
          </span>
          <span className="inline-flex items-center gap-1">
            <i className="inline-block h-0.5 w-4 border-t-2 border-dashed border-red-500" /> Ngưỡng nguy hiểm {r.critical} °C
          </span>
          <span>Vạch nét đứt dọc: chuyển giai đoạn</span>
        </p>
      </div>
      <p className="mt-3 text-xs text-stone-500">{k.labels.note}</p>
    </section>
  );
}
