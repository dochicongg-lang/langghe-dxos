// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use client";

// Trang tra cứu công khai cho người mua: không đăng nhập, chỉ hiện thông tin được phép công bố.
// Trình bày như một câu chuyện ba chương (người làm ra, ngọn lửa, chứng nhận); công đoạn thiếu hiện thành khoảng trống nhìn thấy được, không bị giấu.
import { useParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import KilnCurve from "@/components/KilnCurve";
import StageIcon from "@/components/StageIcon";
import { flagText, fmtDuration, fmtTime } from "@/components/KilnEvidence";
import KilnInsightPanel, { VerdictBadge } from "@/components/KilnInsight";
import { fmtDate, stageLabels, stageOrder, type ProductDetail, type TraceEvent } from "@/lib/trace";
import Tip from "@/components/Tip";

type Stage = { key: string; label: string };
interface Chapter {
  id: string;
  no: string;
  title: string;
  lead: string;
  stages: string[];
  photo: string | null;
  cap: string;
}

// Mỗi ngành có chuỗi công đoạn riêng (từ máy chủ); ba chương chia theo vị trí: 3 công đoạn đầu, công đoạn thứ tư (nung hoặc nhuộm), phần còn lại.
const COPY: Record<string, { c1: [string, string, string]; c2: [string, string, string]; c3: [string, string, string]; photos: [string, string, string] }> = {
  gom: {
    c1: ["Người làm ra", "Nguyên liệu và đôi tay tạo hình", "Nặn và hoàn thiện sản phẩm ngay tại xưởng"],
    c2: ["Ngọn lửa", "Mẻ nung để lại dấu vân tay nhiệt", "Men màu rực rỡ sau khi ra lò"],
    c3: ["Chứng nhận và hành trình", "Kiểm định, kết quả OCOP và đường tới người mua", "Gốm trưng bày và đến tay người mua"],
    photos: ["/photos/chapter-nguoi-lam.jpg", "/photos/chapter-ngon-lua.jpg", "/photos/chapter-hanh-trinh.jpg"],
  },
  lua: {
    c1: ["Từ sợi tơ đến tấm lụa", "Chọn tơ, chuẩn bị sợi và dệt trên khung cửi", "Sợi tơ được se, mắc và dệt thủ công"],
    c2: ["Sắc màu", "Nhuộm và hoàn thiện cho màu bền, vải mềm", "Màu nhuộm trên khung dệt"],
    c3: ["Chứng nhận và hành trình", "Kiểm định, kết quả OCOP và đường tới người mua", "Lụa đến tay người mua"],
    photos: ["/photos/craft-1.jpg", "/photos/craft-2.jpg", "/photos/craft-3.jpg"],
  },
};

function chaptersFor(product: ProductDetail | null): Chapter[] {
  const stages: Stage[] = product?.stages ?? stageOrder.map((k) => ({ key: k, label: stageLabels[k] }));
  const copy = COPY[product?.sector ?? "gom"] ?? COPY.gom;
  const keys = stages.map((s) => s.key);
  const parts = [keys.slice(0, 3), keys.slice(3, 4), keys.slice(4)];
  return (["c1", "c2", "c3"] as const).map((k, i) => ({
    id: ["nguoi-lam", "ngon-lua", "chung-nhan"][i],
    no: ["01", "02", "03"][i],
    title: copy[k][0],
    lead: copy[k][1],
    stages: parts[i],
    photo: copy.photos[i],
    cap: copy[k][2],
  }));
}

/** Vòng tròn biểu tượng đặt trên đường dọc của hành trình. */
function Dot({ stage, muted = false }: { stage: string; muted?: boolean }) {
  return (
    <span className={`absolute -left-[17px] top-0 flex h-8 w-8 items-center justify-center rounded-full border-2 ${muted ? "border-dashed border-stone-300 bg-canvas text-stone-400" : "border-white bg-brand-600 text-white shadow"}`}>
      <StageIcon stage={stage} className="h-4 w-4" />
    </span>
  );
}

function useActiveChapter(ids: string[], enabled: boolean) {
  const [active, setActive] = useState(ids[0]);
  useEffect(() => {
    if (!enabled) return;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setActive(e.target.id)),
      { rootMargin: "-35% 0px -55% 0px" },
    );
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, [ids, enabled]);
  return active;
}

function Gap({ stage, label }: { stage: string; label: string }) {
  return (
    <li className="relative border-l-2 border-dashed border-stone-300 pb-6 pl-8 last:pb-0">
      <Dot stage={stage} muted />
      <p className="text-sm font-semibold text-stone-500">{label}</p>
      <p className="text-sm text-stone-500">Chưa có bản ghi được công bố cho công đoạn này.</p>
    </li>
  );
}

function Step({ ev, label }: { ev: TraceEvent; label: string }) {
  return (
    <li className="relative border-l-2 border-brand-200 pb-6 pl-8 last:pb-0">
      <Dot stage={ev.stage} />
      <p className="text-base font-semibold text-stone-900">{label}</p>
      <p className="text-xs text-stone-500">
        {fmtDate(ev.created_at)}
        {ev.location ? ` · ${ev.location}` : ""}
      </p>
      {ev.note && <p className="mt-1.5 text-sm leading-relaxed text-stone-700">{ev.note}</p>}
    </li>
  );
}

/** Công đoạn nung có dữ liệu cảm biến: đường cong là hiện vật trung tâm của câu chuyện. */
function FireStory({ ev }: { ev: TraceEvent }) {
  const iot = ev.iot!;
  const tiles: [string, string][] = [
    ["Nhiệt độ đỉnh", `${iot.max} ${iot.unit}`],
    ["Trung bình", `${iot.avg} ${iot.unit}`],
    ["Thấp nhất", `${iot.min} ${iot.unit}`],
    [iot.deviceId.startsWith("dye") ? "Thời gian nhuộm" : "Thời gian nung", fmtDuration(iot.from, iot.to)],
  ];
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-widest text-brand-700">Dấu vân tay nhiệt</p>
      <p className="mt-1 text-sm text-stone-600">
        {fmtDate(ev.created_at)}
        {ev.location ? ` · ${ev.location}` : ""} · cảm biến {iot.deviceName || iot.deviceId}
      </p>
      {ev.note && <p className="mt-2 text-sm leading-relaxed text-stone-700">{ev.note}</p>}
      {ev.insight && <KilnInsightPanel insight={ev.insight} />}
      <div className="mt-4 rounded-xl bg-stone-50 p-3 sm:p-4">
        <KilnCurve iot={iot} />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map(([k, v]) => (
          <div key={k} className="rounded-xl bg-brand-50 p-3 text-center">
            <dt className="text-xs text-stone-600">{k}</dt>
            <dd className="mt-0.5 text-lg font-semibold text-brand-800">{v}</dd>
          </div>
        ))}
      </dl>
      {iot.quality?.flags.map((f) => (
        <p key={f} className="mt-3 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800">
          ⚠ {flagText(f, iot.quality!)}
        </p>
      ))}
      <p className="mt-4 text-xs text-stone-500">
        {iot.count} mẫu đo · {fmtTime(iot.from)} → {fmtTime(iot.to)}
        {iot.quality ? ` · độ phủ dữ liệu ${Math.round(iot.quality.coverage * 100)}%` : ""}
      </p>
      {iot.verifiedAt && (
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
          <span aria-hidden="true">✓</span> Máy chủ đã đối chiếu với dữ liệu cảm biến lưu trên hệ thống
          <Tip text="Số liệu do hệ thống tự đọc từ cảm biến, không phải người nhập." />
        </p>
      )}
    </div>
  );
}

function Verify() {
  const { code } = useParams<{ code: string }>();
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // cùng nguồn gốc: Next chuyển tiếp tới cổng gác (xem next.config.ts), nên điện thoại quét QR không cần địa chỉ API riêng
    fetch(`/api/public/trace/${encodeURIComponent(code)}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(res.status === 404 ? "Không tìm thấy sản phẩm với mã này." : (body.error ?? `Lỗi ${res.status}`));
        if (!cancelled) setProduct(body as ProductDetail);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Lỗi không xác định"));
    return () => {
      cancelled = true;
    };
  }, [code]);

  const chapters = useMemo(() => chaptersFor(product), [product]);
  const labelOf = (key: string) => product?.stages?.find((s) => s.key === key)?.label ?? stageLabels[key] ?? key;
  const ids = useMemo(() => chapters.map((c) => c.id), [chapters]);
  const active = useActiveChapter(ids, Boolean(product));

  // công đoạn lạ (không nằm trong 7 công đoạn chuẩn) được xếp vào chương cuối để không mất thông tin
  const byChapter = useMemo(() => {
    const known = new Set<string>(chapters.flatMap((c) => c.stages));
    return chapters.map((c, i) => {
      const own = (product?.events ?? []).filter((e) => c.stages.includes(e.stage) || (i === chapters.length - 1 && !known.has(e.stage)));
      return { ...c, events: own };
    });
  }, [product, chapters]);

  const fire = product?.events.find((e) => e.iot && e.insight);
  const official = product?.ocop?.official;
  const hasPhotos = true; // ảnh minh họa theo ngành (gốm, lụa); thiếu tệp ảnh thì tự ẩn

  return (
    <div className="min-h-screen bg-canvas">
      <header className="relative overflow-hidden bg-stone-900 text-white">
        {hasPhotos && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product?.sector === "lua" ? "/photos/craft-1.jpg" : "/photos/hero-painter.jpg"} alt="" aria-hidden="true" onError={(e) => { e.currentTarget.style.display = "none"; }} className="absolute inset-0 h-full w-full object-cover opacity-40" />
        )}
        <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(ellipse_at_85%_0%,rgba(217,96,44,0.55),transparent_55%),radial-gradient(ellipse_at_0%_100%,rgba(130,50,25,0.6),transparent_50%)]" />
        <div className="relative mx-auto max-w-5xl px-4 pb-16 pt-8 sm:pt-12">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-300">Làng Nghề Số · Tra cứu nguồn gốc</p>
          {error && (
            <div className="mt-10 rounded-lg border border-red-300/40 bg-red-950/40 p-4 text-sm text-red-100" role="alert">
              <p>{error}</p>
              <p className="mt-2 text-red-200">Kiểm tra lại mã in trên tem hoặc mã QR, hoặc liên hệ nơi bán hàng.</p>
            </div>
          )}
          {!error && !product && <p className="mt-10 text-sm text-stone-300">Đang tải…</p>}
          {product && (
            <>
              <h1 className="mt-8 max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">{product.name}</h1>
              <p className="mt-3 font-mono text-sm text-stone-300">{product.code}</p>
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white ring-1 ring-white/20">
                  <span aria-hidden="true">✓</span> Có thông tin truy xuất
                </span>
                {fire?.insight && <VerdictBadge verdict={fire.insight.verdict} />}
                {official && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">
                    <span aria-hidden="true">★</span> OCOP {official.stars} sao{official.active ? "" : " (hết hiệu lực)"}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </header>

      {product && (
        <main className="mx-auto max-w-5xl px-4 pb-16">
          {/* tấm biển bảo tàng: nhãn ngắn gọn cho hiện vật */}
          <dl className="relative -mt-8 grid gap-px overflow-hidden rounded-2xl border border-stone-200 bg-stone-200 shadow-md sm:grid-cols-3">
            {[
              ["Danh mục", product.category],
              ["Làng nghề", product.village],
              ["Nghệ nhân / cơ sở", product.artisan],
            ].map(([k, v]) => (
              <div key={k} className="bg-white p-4">
                <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">{k}</dt>
                <dd className="mt-1 text-base font-semibold text-stone-900">{v || "—"}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-10 lg:grid lg:grid-cols-[200px_1fr] lg:gap-10">
            <nav aria-label="Các chương" className="sticky top-0 z-20 -mx-4 mb-6 bg-canvas/95 px-4 py-2 backdrop-blur lg:top-8 lg:mx-0 lg:mb-0 lg:self-start lg:bg-transparent lg:px-0 lg:py-0">
              <ol className="flex gap-2 overflow-x-auto [scrollbar-width:none] lg:flex-col lg:overflow-visible lg:gap-1 lg:border-l lg:border-stone-300">
                {chapters.map((c) => (
                  <li key={c.id} className="shrink-0">
                    <a
                      href={`#${c.id}`}
                      aria-current={active === c.id ? "true" : undefined}
                      className={`block whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition-colors lg:-ml-px lg:rounded-none lg:border-l-2 lg:py-2 lg:pl-4 ${
                        active === c.id
                          ? "bg-brand-600 font-semibold text-white lg:border-brand-600 lg:bg-transparent lg:text-brand-700"
                          : "bg-stone-100 text-stone-600 hover:text-stone-900 lg:border-transparent lg:bg-transparent"
                      }`}
                    >
                      <span className="mr-1.5 font-mono text-xs opacity-70">{c.no}</span>
                      {c.title}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>

            <div className="space-y-14">
              {byChapter.map((c) => (
                <section key={c.id} id={c.id} aria-labelledby={`${c.id}-h`} className="scroll-mt-16">
                  <p className="font-mono text-sm text-brand-700">{c.no}</p>
                  <h2 id={`${c.id}-h`} className="text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">
                    {c.title}
                  </h2>
                  <p className="mt-1 text-sm text-stone-600">{c.lead}</p>
                  {hasPhotos && c.photo && (
                    <figure className="mt-4 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={c.photo} alt={c.cap} loading="lazy" onError={(e) => { e.currentTarget.closest("figure")?.setAttribute("hidden", ""); }} className="h-48 w-full object-cover sm:h-72" />
                    </figure>
                  )}

                  {c.id === "chung-nhan" && product.ocop && (
                    <div className="mt-5 grid gap-3 sm:grid-cols-2">
                      <section className="rounded-xl border border-stone-200 bg-white p-4" aria-labelledby="ocop-official">
                        <h3 id="ocop-official" className="text-sm font-semibold text-stone-800">
                          Kết quả OCOP chính thức
                          <Tip text="Do cơ quan có thẩm quyền quyết định, nền tảng chỉ ghi lại." />
                        </h3>
                        {official ? (
                          <>
                            <p className="mt-1 text-3xl text-amber-500" aria-label={`${official.stars} sao`}>
                              {"★".repeat(official.stars)}
                            </p>
                            <p className="text-sm text-stone-700">{official.authority}</p>
                            <p className="mt-1 text-xs text-stone-600">
                              {official.decision_no} ({official.decided_at})
                            </p>
                            <p className={`mt-2 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${official.active ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                              <span aria-hidden="true">{official.active ? "✓" : "⛔"}</span>
                              {official.active ? "Còn hiệu lực" : "Đã hết hiệu lực"} đến {official.valid_until}
                            </p>
                          </>
                        ) : (
                          <p className="mt-1 text-sm text-stone-600">Chưa có kết quả chính thức từ cơ quan có thẩm quyền.</p>
                        )}
                      </section>
                      <section className="rounded-xl border border-stone-200 bg-stone-50 p-4" aria-labelledby="ocop-platform">
                        <h3 id="ocop-platform" className="text-sm font-semibold text-stone-800">
                          Xác nhận của nền tảng
                          <Tip text="Hợp tác xã đã sơ duyệt hồ sơ. Chưa phải giấy chứng nhận OCOP." />
                        </h3>
                        {product.ocop.platform ? (
                          <>
                            <p className="mt-1 text-sm text-stone-700">{product.ocop.platform.note}</p>
                            <p className="mt-1 text-xs text-stone-600">Ngày xác nhận: {fmtDate(product.ocop.platform.confirmed_at)}</p>
                          </>
                        ) : (
                          <p className="mt-1 text-sm text-stone-600">Chưa có.</p>
                        )}
                      </section>
                    </div>
                  )}

                  <ol className="mt-6">
                    {c.stages.map((st) => {
                      const evs = c.events.filter((e) => e.stage === st);
                      if (evs.length === 0) return <Gap key={st} stage={st} label={labelOf(st)} />;
                      return evs.map((ev, i) =>
                        ev.iot ? (
                          <li key={`${st}-${i}`} className="relative border-l-2 border-brand-200 pb-6 pl-8 last:pb-0">
                            <Dot stage={st} />
                            <p className="mb-3 text-base font-semibold text-stone-900">{labelOf(st)}</p>
                            <FireStory ev={ev} />
                          </li>
                        ) : (
                          <Step key={`${st}-${i}`} ev={ev} label={labelOf(ev.stage)} />
                        ),
                      );
                    })}
                    {c.events
                      .filter((e) => !c.stages.includes(e.stage))
                      .map((ev, i) => (
                        <Step key={`x-${i}`} ev={ev} label={labelOf(ev.stage)} />
                      ))}
                  </ol>
                </section>
              ))}
            </div>
          </div>

          <aside className="mt-6 rounded-2xl border border-stone-200 bg-white p-5 text-sm text-stone-700">
            <h2 className="text-base font-semibold text-stone-900">Vì sao có thể tin trang này</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Số liệu cảm biến (lò nung, bể nhuộm) được ghi vào kho dữ liệu có khóa chống sửa và chống xóa; nếu bị ghi đè, hệ thống chỉ dùng bản ghi đầu tiên và gắn cờ cảnh báo.</li>
              <li>Máy chủ tự đọc lại dữ liệu cảm biến để tính nhiệt độ và đường cong, người nhập hồ sơ không gõ tay các con số này.</li>
              <li>Kết quả OCOP chính thức do cơ quan có thẩm quyền quyết định, được hiển thị tách khỏi xác nhận của nền tảng.</li>
            </ul>
          </aside>
        </main>
      )}
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<p className="p-10 text-center text-sm text-stone-500">Đang tải…</p>}>
      <Verify />
    </Suspense>
  );
}
