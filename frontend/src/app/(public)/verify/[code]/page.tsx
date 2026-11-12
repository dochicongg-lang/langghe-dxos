"use client";

// Trang tra cứu công khai cho người mua: không đăng nhập, chỉ hiện thông tin được phép công bố.
import { useParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import KilnEvidence from "@/components/KilnEvidence";
import { config } from "@/lib/config";
import { fmtDate, stageLabels, type ProductDetail } from "@/lib/trace";

function Verify() {
  const { code } = useParams<{ code: string }>();
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${config.apiBaseUrl}/api/public/trace/${encodeURIComponent(code)}`)
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

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <p className="text-center text-sm font-medium text-indigo-600">Làng Nghề Số · Tra cứu nguồn gốc</p>
        {error && <p className="mt-8 rounded-lg border border-red-200 bg-red-50 p-4 text-center text-sm text-red-700">{error}</p>}
        {!error && !product && <p className="mt-8 text-center text-sm text-slate-500">Đang tải…</p>}
        {product && (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
              ✓ Sản phẩm có thông tin truy xuất
            </p>
            <h1 className="mt-3 text-2xl font-bold text-slate-900">{product.name}</h1>
            <p className="font-mono text-sm text-slate-500">{product.code}</p>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
              {[
                ["Danh mục", product.category],
                ["Làng nghề", product.village],
                ["Nghệ nhân / cơ sở", product.artisan],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg bg-slate-50 p-3">
                  <dt className="text-xs text-slate-500">{k}</dt>
                  <dd className="mt-0.5 font-medium text-slate-800">{v || "—"}</dd>
                </div>
              ))}
            </dl>

            <h2 className="mb-3 mt-6 text-base font-semibold text-slate-800">Hành trình sản phẩm</h2>
            {product.events.length === 0 ? (
              <p className="text-sm text-slate-500">Chưa có công đoạn nào được công bố.</p>
            ) : (
              <ol className="relative ml-2 border-l-2 border-slate-200">
                {product.events.map((ev, i) => (
                  <li key={i} className="mb-5 ml-5 last:mb-0">
                    <span className="absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" />
                    <p className="text-sm font-semibold text-slate-800">{stageLabels[ev.stage] ?? ev.stage}</p>
                    <p className="text-xs text-slate-500">
                      {fmtDate(ev.created_at)}
                      {ev.location ? ` · ${ev.location}` : ""}
                    </p>
                    {ev.note && <p className="mt-1 text-sm text-slate-600">{ev.note}</p>}
                    {ev.iot && <KilnEvidence iot={ev.iot} />}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<p className="p-10 text-center text-sm text-slate-500">Đang tải…</p>}>
      <Verify />
    </Suspense>
  );
}
