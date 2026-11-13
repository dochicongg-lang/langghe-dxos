"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import Card, { PageTitle } from "@/components/Card";
import { useAuth } from "@/components/AuthProvider";
import { fmtDate, stageLabels, type ProductSummary } from "@/lib/trace";

const inputCls =
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500";

export default function TracePage() {
  const { apiFetch, user } = useAuth();
  const router = useRouter();
  const canWrite = Boolean(user.permissions["product.create"]);
  const [products, setProducts] = useState<ProductSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/api/trace/products");
      if (!res.ok) throw new Error(`API trả về ${res.status}`);
      setProducts((await res.json()).products as ProductSummary[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi không xác định");
    }
  }, [apiFetch]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  async function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
    setSaving(true);
    setFormError(null);
    try {
      const res = await apiFetch("/api/trace/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `API trả về ${res.status}`);
      router.push(`/trace/${encodeURIComponent(body.code)}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Lỗi không xác định");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageTitle title="Truy xuất nguồn gốc" desc="Theo dõi sản phẩm làng nghề từ nguyên liệu đến phân phối (Tầng 3)." />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Card title="Sản phẩm">
            {error && <p className="text-sm text-red-600">Không tải được dữ liệu: {error}</p>}
            {!error && !products && <p className="text-sm text-stone-500">Đang tải…</p>}
            {products && products.length === 0 && <p className="text-sm text-stone-500">Chưa có sản phẩm nào.</p>}
            {products && products.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase text-stone-500">
                    <tr>
                      <th className="pb-2">Mã</th>
                      <th className="pb-2">Tên</th>
                      <th className="pb-2">Làng nghề</th>
                      <th className="pb-2">Công đoạn gần nhất</th>
                      <th className="pb-2">Tạo lúc</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {products.map((p) => (
                      <tr key={p.code} className="hover:bg-stone-50">
                        <td className="py-2 pr-3 font-mono">
                          <Link href={`/trace/${encodeURIComponent(p.code)}`} className="text-brand-600 hover:underline">
                            {p.code}
                          </Link>
                        </td>
                        <td className="py-2 pr-3 text-stone-800">{p.name}</td>
                        <td className="py-2 pr-3 text-stone-600">{p.village || "—"}</td>
                        <td className="py-2 pr-3">
                          {p.last_stage ? (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                              {stageLabels[p.last_stage] ?? p.last_stage}
                            </span>
                          ) : (
                            <span className="text-stone-400">—</span>
                          )}
                        </td>
                        <td className="py-2 text-stone-500">{fmtDate(p.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <Card title="Thêm sản phẩm">
          {!canWrite ? (
            <p className="text-sm text-stone-500">Vai trò của bạn không có quyền tạo sản phẩm (vai trò hiện tại: {user.roles.filter((r) => !r.startsWith("default-") && r !== "offline_access" && r !== "uma_authorization").join(", ") || "chưa có"}).</p>
          ) : (
            <form onSubmit={onCreate} className="space-y-3">
              <label className="block text-sm">
                <span className="mb-1 block text-stone-600">Tên sản phẩm *</span>
                <input name="name" required maxLength={200} className={inputCls} placeholder="Bình gốm men rạn" />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-stone-600">Mã (để trống sẽ tự tạo)</span>
                <input name="code" maxLength={40} className={inputCls} placeholder="GOM-BT-0002" />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-stone-600">Danh mục</span>
                <input name="category" maxLength={100} className={inputCls} placeholder="Gốm sứ" />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-stone-600">Làng nghề</span>
                <input name="village" maxLength={200} className={inputCls} placeholder="Bát Tràng, Hà Nội" />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-stone-600">Nghệ nhân / cơ sở</span>
                <input name="artisan" maxLength={200} className={inputCls} />
              </label>
              {formError && <p className="text-sm text-red-600">{formError}</p>}
              <button
                type="submit"
                disabled={saving}
                className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {saving ? "Đang lưu…" : "Tạo sản phẩm"}
              </button>
            </form>
          )}
        </Card>
      </div>
    </>
  );
}
