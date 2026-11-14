// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
import KilnInsightPanel from "./KilnInsight";
import type { IotEvidence, KilnInsight } from "@/lib/trace";

export const flagText = (flag: string, q: NonNullable<IotEvidence["quality"]>) =>
  ({
    "low-coverage": `Dữ liệu có nhiều khoảng trống (độ phủ ${Math.round(q.coverage * 100)}%): cảm biến có thể đã mất kết nối trong lúc đo.`,
    "out-of-range": `${q.rejected} mẫu nằm ngoài khoảng giá trị hợp lý nên đã bị loại.`,
    "rapid-change": `${q.jumps} lần giá trị đổi nhanh bất thường.`,
    "few-samples": "Quá ít mẫu đo để đánh giá.",
    "object-overwritten": `${q.overwritten} tệp dữ liệu bị ghi đè sau khi ghi; hệ thống chỉ dùng bản ghi đầu tiên (đã khóa chống sửa).`,
    "object-deleted": `${q.deleted} tệp dữ liệu bị yêu cầu xóa; bản gốc vẫn được giữ nguyên (đã khóa chống xóa).`,
  })[flag] ?? flag;

export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });

export function fmtDuration(fromIso: string, toIso: string) {
  const mins = Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h} giờ${m ? ` ${m} phút` : ""}` : `${m} phút`;
}

/** Đường cong nhiệt độ lò trong khoảng thời gian nung, lấy từ cảm biến IoT. */
export default function KilnEvidence({ iot, insight }: { iot: IotEvidence; insight?: KilnInsight | null }) {
  const w = 300;
  const h = 70;
  const ts = iot.curve.map((p) => p[0]);
  const vs = iot.curve.map((p) => p[1]);
  const t0 = Math.min(...ts);
  const t1 = Math.max(...ts);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const path = iot.curve
    .map(([t, v]) => {
      const x = t1 === t0 ? w / 2 : ((t - t0) / (t1 - t0)) * w;
      const y = hi === lo ? h / 2 : h - ((v - lo) / (hi - lo)) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div className="mt-2 rounded-lg border border-brand-100 bg-brand-50/60 p-3">
      <p className="text-xs font-medium text-brand-700">
        Dữ liệu cảm biến: {iot.deviceName || iot.deviceId} · nhiệt độ
      </p>
      <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 h-16 w-full" preserveAspectRatio="none" role="img" aria-label="Đường cong nhiệt độ">
        <polyline points={path} fill="none" stroke="#c04a1f" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <dl className="mt-2 grid grid-cols-4 gap-2 text-center text-xs">
        {[
          ["Thấp nhất", `${iot.min} ${iot.unit}`],
          ["Trung bình", `${iot.avg} ${iot.unit}`],
          ["Cao nhất", `${iot.max} ${iot.unit}`],
          ["Số mẫu đo", String(iot.count)],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-stone-500">{k}</dt>
            <dd className="font-semibold text-stone-800">{v}</dd>
          </div>
        ))}
      </dl>
      {iot.quality && (
        <>
          <p className="mt-2 text-xs text-stone-500">
            Độ phủ dữ liệu {Math.round(iot.quality.coverage * 100)}% · khoảng trống lớn nhất {iot.quality.maxGapSec} giây
          </p>
          {iot.quality.flags.map((f) => (
            <p key={f} className="mt-1 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
              ⚠ {flagText(f, iot.quality!)}
            </p>
          ))}
        </>
      )}
      {insight && <KilnInsightPanel insight={insight} />}
      {iot.verifiedAt && (
        <p className="mt-2 text-xs font-medium text-emerald-700">✓ Máy chủ đã đối chiếu với dữ liệu cảm biến lưu trên hệ thống</p>
      )}
      <p className="mt-1 text-xs text-stone-500">
        {fmtTime(iot.from)} → {fmtTime(iot.to)} ({fmtDuration(iot.from, iot.to)})
      </p>
    </div>
  );
}
