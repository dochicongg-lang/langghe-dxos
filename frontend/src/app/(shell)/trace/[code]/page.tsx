"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import Card, { PageTitle } from "@/components/Card";
import { useAuth } from "@/components/AuthProvider";
import { fmtDate, stageLabels, stageOrder, type ProductDetail } from "@/lib/trace";

const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500";

function Product() {
  const { code } = useParams<{ code: string }>();
  const { apiFetch, user } = useAuth();
  const canWrite = user.roles.includes("readwrite");
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/trace/products/${encodeURIComponent(code)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `API trả về ${res.status}`);
      setProduct(body as ProductDetail);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi không xác định");
    }
  }, [apiFetch, code]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  async function onAddEvent(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
    setSaving(true);
    setFormError(null);
    try {
      const res = await apiFetch(`/api/trace/products/${encodeURIComponent(code)}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `API trả về ${res.status}`);
      setProduct(body as ProductDetail);
      form.reset();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Lỗi không xác định");
    } finally {
      setSaving(false);
    }
  }

  if (error) {
    return (
      <>
        <Link href="/trace" className="text-sm text-indigo-600 hover:underline">
          ← Quay lại danh sách
        </Link>
        <p className="mt-4 text-sm text-red-600">{error}</p>
      </>
    );
  }
  if (!product) return <p className="text-sm text-slate-500">Đang tải…</p>;

  const done = new Set(product.events.map((e) => e.stage));
  const publicPath = `/verify/${encodeURIComponent(product.code)}`;

  return (
    <>
      <Link href="/trace" className="text-sm text-indigo-600 hover:underline">
        ← Quay lại danh sách
      </Link>
      <div className="mt-3">
        <PageTitle title={product.name} desc={`Mã ${product.code} · ${product.category || "Chưa phân loại"}`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Tiến trình công đoạn">
            <ol className="flex flex-wrap gap-2">
              {stageOrder.map((s) => (
                <li
                  key={s}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    done.has(s) ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-400"
                  }`}
                >
                  {done.has(s) ? "✓ " : ""}
                  {stageLabels[s]}
                </li>
              ))}
            </ol>
          </Card>

          <Card title="Dòng thời gian">
            {product.events.length === 0 ? (
              <p className="text-sm text-slate-500">Chưa có công đoạn nào được ghi nhận.</p>
            ) : (
              <ol className="relative ml-2 border-l-2 border-slate-200">
                {product.events.map((ev, i) => (
                  <li key={i} className="mb-5 ml-5 last:mb-0">
                    <span className="absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-indigo-500" />
                    <p className="text-sm font-semibold text-slate-800">{stageLabels[ev.stage] ?? ev.stage}</p>
                    <p className="text-xs text-slate-500">
                      {fmtDate(ev.created_at)}
                      {ev.location ? ` · ${ev.location}` : ""}
                      {ev.actor ? ` · ghi bởi ${ev.actor}` : ""}
                    </p>
                    {ev.note && <p className="mt-1 text-sm text-slate-600">{ev.note}</p>}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Thông tin">
            <dl className="divide-y divide-slate-100 text-sm">
              {[
                ["Làng nghề", product.village || "—"],
                ["Nghệ nhân / cơ sở", product.artisan || "—"],
                ["Tạo lúc", fmtDate(product.created_at)],
                ["Tạo bởi", product.created_by ?? "—"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 py-2">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="text-right font-medium text-slate-800">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-xs text-slate-500">Trang tra cứu công khai cho người mua (không cần đăng nhập):</p>
            <Link href={publicPath} target="_blank" className="break-all text-sm text-indigo-600 hover:underline">
              {publicPath}
            </Link>
          </Card>

          <Card title="Thêm công đoạn">
            {!canWrite ? (
              <p className="text-sm text-slate-500">Tài khoản của bạn chỉ có quyền xem.</p>
            ) : (
              <form onSubmit={onAddEvent} className="space-y-3">
                <label className="block text-sm">
                  <span className="mb-1 block text-slate-600">Công đoạn *</span>
                  <select name="stage" required className={inputCls} defaultValue="">
                    <option value="" disabled>
                      Chọn công đoạn…
                    </option>
                    {stageOrder.map((s) => (
                      <option key={s} value={s}>
                        {stageLabels[s]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-slate-600">Địa điểm</span>
                  <input name="location" maxLength={200} className={inputCls} placeholder="Xưởng tạo hình" />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-slate-600">Ghi chú</span>
                  <textarea name="note" maxLength={1000} rows={3} className={inputCls} />
                </label>
                {formError && <p className="text-sm text-red-600">{formError}</p>}
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? "Đang lưu…" : "Ghi nhận công đoạn"}
                </button>
              </form>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

export default function ProductPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Đang tải…</p>}>
      <Product />
    </Suspense>
  );
}
