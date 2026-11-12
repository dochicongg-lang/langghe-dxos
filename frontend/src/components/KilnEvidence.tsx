import type { IotEvidence } from "@/lib/trace";

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });

function fmtDuration(fromIso: string, toIso: string) {
  const mins = Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h} giờ${m ? ` ${m} phút` : ""}` : `${m} phút`;
}

/** Đường cong nhiệt độ lò trong khoảng thời gian nung, lấy từ cảm biến IoT. */
export default function KilnEvidence({ iot }: { iot: IotEvidence }) {
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
    <div className="mt-2 rounded-lg border border-indigo-100 bg-indigo-50/60 p-3">
      <p className="text-xs font-medium text-indigo-700">
        Dữ liệu cảm biến: {iot.deviceName || iot.deviceId} · nhiệt độ
      </p>
      <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 h-16 w-full" preserveAspectRatio="none" role="img" aria-label="Đường cong nhiệt độ lò">
        <polyline points={path} fill="none" stroke="#6366f1" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <dl className="mt-2 grid grid-cols-4 gap-2 text-center text-xs">
        {[
          ["Thấp nhất", `${iot.min} ${iot.unit}`],
          ["Trung bình", `${iot.avg} ${iot.unit}`],
          ["Cao nhất", `${iot.max} ${iot.unit}`],
          ["Số mẫu đo", String(iot.count)],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-slate-500">{k}</dt>
            <dd className="font-semibold text-slate-800">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-slate-500">
        {fmtTime(iot.from)} → {fmtTime(iot.to)} ({fmtDuration(iot.from, iot.to)})
      </p>
    </div>
  );
}
