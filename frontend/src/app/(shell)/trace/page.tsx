// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import Card, { PageTitle } from "@/components/Card";
import { useAuth } from "@/components/AuthProvider";
import { visibleRoles } from "@/lib/roles";
import EmptyState from "@/components/EmptyState";
import ProductImage from "@/components/ProductImage";
import StageIcon from "@/components/StageIcon";
import { useSectors, stageLabelOf } from "@/lib/sectors";
import { fmtDate, type ProductSummary } from "@/lib/trace";

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
  const [showForm, setShowForm] = useState(false);
  const [q, setQ] = useState("");
  const [sectorFilter, setSectorFilter] = useState("all");
  const sectors = useSectors();

  // Từ trang chủ hoặc trang Cấu trúc nền tảng vào thẳng một ngành (?sector=lua)
  useEffect(() => {
    const t = setTimeout(() => {
      const s = new URLSearchParams(window.location.search).get("sector");
      if (s) setSectorFilter(s);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/api/trace/products");
      if (!res.ok) throw new Error(`Hệ thống báo lỗi (mã ${res.status})`);
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
      if (!res.ok) throw new Error(body.error ?? `Hệ thống báo lỗi (mã ${res.status})`);
      router.push(`/trace/${encodeURIComponent(body.code)}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Lỗi không xác định");
    } finally {
      setSaving(false);
    }
  }

  const shown = (products ?? []).filter((p) => (sectorFilter === "all" || p.sector === sectorFilter) && `${p.name} ${p.code} ${p.village} ${p.artisan}`.toLowerCase().includes(q.trim().toLowerCase()));
  const countOf = (k: string) => (products ?? []).filter((p) => k === "all" || p.sector === k).length;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageTitle title="Sản phẩm và truy xuất nguồn gốc" desc="Mỗi sản phẩm có một hành trình riêng theo ngành, từ nguyên liệu đến tay người mua." />
        {canWrite && (
          <button onClick={() => setShowForm((v) => !v)} className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">
            {showForm ? "Đóng biểu mẫu" : "+ Thêm sản phẩm"}
          </button>
        )}
      </div>

      <div className="space-y-4">
        {showForm && canWrite && (
          <Card title="Thêm sản phẩm">
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
          </Card>
        )}
        {!canWrite && (
          <p className="rounded-xl bg-stone-100 p-3 text-sm text-stone-600">
            Tài khoản của bạn ({visibleRoles(user.roles).join(", ") || "chưa có vai trò"}) chỉ được xem. Cần thêm sản phẩm, hãy nhờ người quản trị.
          </p>
        )}

        {error && <p className="text-sm text-red-600">Không tải được dữ liệu: {error}</p>}
        {!error && !products && <p className="text-sm text-stone-500">Đang tải…</p>}
        {products && products.length === 0 && (
          <Card>
            <EmptyState
              title="Chưa có sản phẩm nào"
              hint={canWrite ? "Bấm \"+ Thêm sản phẩm\" ở trên, rồi ghi từng công đoạn từ nguyên liệu đến phân phối." : "Khi có sản phẩm trong phạm vi bạn được xem, chúng sẽ hiện ở đây."}
            />
          </Card>
        )}
        {products && products.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex flex-wrap gap-2" role="tablist" aria-label="Lọc theo ngành nghề">
                {[{ key: "all", label: "Tất cả ngành" }, ...(sectors ?? []).map((s) => ({ key: s.key, label: s.label }))].map((s) => (
                  <button key={s.key} role="tab" aria-selected={sectorFilter === s.key} onClick={() => setSectorFilter(s.key)} className={`rounded-full px-3.5 py-1.5 text-sm transition ${sectorFilter === s.key ? "bg-brand-600 font-semibold text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"}`}>
                    {s.label} <span className="opacity-70">{countOf(s.key)}</span>
                  </button>
                ))}
              </div>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo tên, mã, làng nghề hoặc nghệ nhân" aria-label="Tìm sản phẩm" className={`${inputCls} max-w-md`} />
            </div>
            {shown.length === 0 && <p className="py-6 text-center text-sm text-stone-500">Không có sản phẩm nào khớp.</p>}
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {shown.map((p) => (
                <li key={p.code}>
                  <Link href={`/trace/${encodeURIComponent(p.code)}`} className="group block overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm transition hover:border-brand-300 hover:shadow">
                    <ProductImage category={p.category} seed={p.code} className="h-36 w-full" />
                    <div className="p-4">
                      <p className="truncate text-base font-semibold text-stone-900 group-hover:text-brand-700">{p.name}</p>
                      <p className="mt-0.5 font-mono text-xs text-stone-500">{p.code}</p>
                      <p className="mt-2 truncate text-sm text-stone-600">{[p.village, p.artisan].filter(Boolean).join(" · ") || "Chưa ghi làng nghề"}</p>
                      <div className="mt-3 flex items-center justify-between gap-2 text-xs">
                        {p.last_stage ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700">
                            <StageIcon stage={p.last_stage} className="h-3.5 w-3.5" />
                            {stageLabelOf(sectors, p.sector, p.last_stage)}
                          </span>
                        ) : (
                          <span className="rounded-full bg-stone-100 px-2.5 py-1 text-stone-500">Chưa có công đoạn</span>
                        )}
                        <span className="text-stone-500">{p.event_count} công đoạn · {fmtDate(p.created_at)}</span>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  );
}
