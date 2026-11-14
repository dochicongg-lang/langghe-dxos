// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use client";

import { useCallback, useEffect, useState } from "react";
import Card, { PageTitle } from "@/components/Card";
import KilnInsights from "@/components/KilnInsights";
import KilnStatusBoard from "@/components/KilnStatusBoard";
import Photo from "@/components/Photo";
import ProposalsPanel from "@/components/ProposalsPanel";
import { fetchReadings, latestBatch, toSeries, type Reading, type Series } from "@/lib/iot";

const REFRESH_MS = 10_000;
const metricLabel: Record<string, string> = { temperature: "Nhiệt độ", humidity: "Độ ẩm", ph: "Độ pH" };

function Sparkline({ points }: { points: { t: number; v: number }[] }) {
  if (points.length < 2) return <div className="h-14 text-xs text-stone-400">Chưa đủ điểm để vẽ</div>;
  const w = 240;
  const h = 56;
  const vs = points.map((p) => p.v);
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const span = max - min || 1;
  const path = points
    .map((p, i) => `${(i / (points.length - 1)) * w},${h - 4 - ((p.v - min) / span) * (h - 8)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-14 w-full" preserveAspectRatio="none" role="img" aria-label="Biểu đồ xu hướng">
      <polyline points={path} fill="none" stroke="#c04a1f" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function SeriesCard({ s }: { s: Series }) {
  const vs = s.points.map((p) => p.v);
  const last = s.points[s.points.length - 1];
  const avg = vs.reduce((a, b) => a + b, 0) / vs.length;
  return (
    <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-stone-500">{s.deviceName}</p>
      <p className="text-xs font-medium uppercase tracking-wide text-brand-600">{metricLabel[s.metric] ?? s.metric}</p>
      <p className="mt-2 text-3xl font-bold text-stone-900">
        {last.v.toFixed(1)}
        <span className="ml-1 text-base font-medium text-stone-500">{s.unit}</span>
      </p>
      <div className="mt-3">
        <Sparkline points={s.points} />
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
        {[
          ["Thấp nhất", Math.min(...vs)],
          ["Trung bình", avg],
          ["Cao nhất", Math.max(...vs)],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-lg bg-stone-50 py-2">
            <dt className="text-stone-500">{label}</dt>
            <dd className="font-semibold text-stone-800">{(value as number).toFixed(1)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-stone-400">{s.points.length} điểm · cập nhật {new Date(last.t).toLocaleTimeString("vi-VN")}</p>
    </section>
  );
}

export default function IntelligencePage() {
  const [readings, setReadings] = useState<Reading[] | null>(null);
  const [objects, setObjects] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const { readings, objects } = await fetchReadings();
      setReadings(readings);
      setObjects(objects);
      setError(null);
      setUpdatedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi không xác định");
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [load]);

  const series = readings ? toSeries(readings).map((s) => latestBatch(s)) : [];
  const others = series.filter((s) => !((s.id.startsWith("kiln") || s.id.startsWith("dye")) && s.metric === "temperature"));
  const recent = readings ? [...readings].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)).slice(0, 10) : [];

  return (
    <>
      <div className="mb-6 flex items-start justify-between gap-6">
        <PageTitle flush title="Phân tích và trợ lý" desc="Nhận định về các mẻ nung, mẻ nhuộm và số liệu từ cảm biến, cập nhật liên tục." />
        <Photo src="/illustrations/kiln.svg" className="hidden h-24 w-44 shrink-0 rounded-xl object-cover md:block" />
      </div>

      {series.length > 0 && (
        <div className="mb-6 space-y-6">
          <KilnStatusBoard series={series} kind="kiln" />
          <KilnStatusBoard series={series} kind="dye" />
        </div>
      )}

      <div className="mb-6">
        <KilnInsights />
      </div>

      <div className="mb-6 space-y-6">
        <ProposalsPanel />
      </div>

      <div className="mb-4 flex items-center justify-between text-sm text-stone-500">
        <span>
          {updatedAt ? `Cập nhật lúc ${updatedAt.toLocaleTimeString("vi-VN")} · ${objects} tệp · tự làm mới mỗi ${REFRESH_MS / 1000}s` : "Đang tải…"}
        </span>
        <button onClick={() => void load()} className="rounded-lg border border-stone-300 px-3 py-1.5 text-stone-700 hover:bg-stone-100">
          Làm mới
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Không đọc được dữ liệu: {error}
        </div>
      )}

      {readings && series.length === 0 && !error && (
        <Card title="Chưa có dữ liệu">
          <p className="text-sm text-stone-600">Thiết bị cảm biến chưa gửi số liệu nào. Khi có số liệu, trang này sẽ tự hiện.</p>
        </Card>
      )}

      {series.length > 0 && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {others.map((s) => (
              <SeriesCard key={s.id} s={s} />
            ))}
          </div>

          <div className="mt-4">
            <Card title="10 bản ghi mới nhất">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase text-stone-500">
                    <tr>
                      <th className="pb-2">Thời gian</th>
                      <th className="pb-2">Thiết bị</th>
                      <th className="pb-2">Chỉ số</th>
                      <th className="pb-2 text-right">Giá trị</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {recent.map((r, i) => (
                      <tr key={`${r.timestamp}-${r.deviceId}-${r.metric}-${i}`}>
                        <td className="py-2 text-stone-600">{new Date(r.timestamp).toLocaleTimeString("vi-VN")}</td>
                        <td className="py-2 text-stone-800">{r.deviceName}</td>
                        <td className="py-2 text-stone-600">{metricLabel[r.metric] ?? r.metric}</td>
                        <td className="py-2 text-right font-mono text-stone-800">
                          {r.value.toFixed(1)} {r.unit}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
