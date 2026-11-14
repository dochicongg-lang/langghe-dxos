// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import ProductImage from "@/components/ProductImage";
import StageIcon from "@/components/StageIcon";
import { stateTone, type OcopSummary } from "@/lib/ocop";
import { visibleRoles } from "@/lib/roles";
import { useSectors, stageLabelOf } from "@/lib/sectors";
import { fmtDate, type ProductSummary } from "@/lib/trace";

interface Overview {
  products: ProductSummary[] | null;
  applications: OcopSummary[] | null;
}

const DONE = ["recognized", "not_recognized", "rejected"];

/** Trang chủ theo nguyên tắc ít mà đủ: 1) việc chính làm ngay, 2) việc đang chờ bạn, 3) tình hình hồ sơ, 4) nơi hỏi khi cần. */
export default function Home() {
  const { user, apiFetch } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<Overview | null>(null);
  const [code, setCode] = useState("");
  const sectors = useSectors();

  useEffect(() => {
    let alive = true;
    const get = async <T,>(path: string, pick: (b: Record<string, unknown>) => T): Promise<T | null> => {
      try {
        const res = await apiFetch(path);
        return res.ok ? pick((await res.json()) as Record<string, unknown>) : null;
      } catch {
        return null;
      }
    };
    void Promise.all([
      user.permissions["product.read"] ? get("/api/trace/products", (b) => b.products as ProductSummary[]) : null,
      user.permissions["application.read"] ? get("/api/trace/applications", (b) => b.applications as OcopSummary[]) : null,
    ]).then(([products, applications]) => {
      if (alive) setData({ products, applications });
    });
    return () => {
      alive = false;
    };
  }, [apiFetch, user.permissions]);

  const roles = visibleRoles(user.roles);
  const apps = data?.applications ?? [];
  const canApps = Boolean(user.permissions["application.read"]);
  const canProducts = Boolean(user.permissions["product.read"]);
  const canCreate = Boolean(user.permissions["application.create"]);

  // "Việc của bạn": hồ sơ đang chờ chính người dùng này xử lý (máy chủ luôn kiểm tra lại khi thao tác)
  const waiting: { app: OcopSummary; why: string }[] = [];
  for (const a of apps) {
    if (user.permissions["application.review"] && a.state === "in_review") waiting.push({ app: a, why: "Chờ bạn sơ duyệt" });
    else if (user.permissions["application.decide"] && a.state === "awaiting_result") waiting.push({ app: a, why: "Chờ bạn ghi kết quả" });
    else if (user.permissions["application.update"] && a.owner === user.username && a.state === "needs_revision") waiting.push({ app: a, why: "Cần bạn bổ sung" });
    else if (user.permissions["application.update"] && a.owner === user.username && a.state === "draft") waiting.push({ app: a, why: "Nháp chưa nộp" });
  }

  const count = (f: (a: OcopSummary) => boolean) => (data?.applications ? String(apps.filter(f).length) : "—");
  const stats = [
    { label: "Đang xử lý", value: count((a) => ["in_review", "awaiting_result"].includes(a.state)), tone: "text-amber-700", href: "/ocop" },
    { label: "Cần bổ sung", value: count((a) => a.state === "needs_revision"), tone: "text-orange-700", href: "/ocop" },
    { label: "Nháp", value: count((a) => a.state === "draft"), tone: "text-stone-700", href: "/ocop" },
    { label: "Đã có kết quả", value: count((a) => DONE.includes(a.state)), tone: "text-emerald-700", href: "/ocop" },
  ];

  // Ba bước của hồ sơ OCOP, nói bằng lời đời thường
  const steps = [
    { n: "1", title: "Lập hồ sơ", line: "Nhập thông tin, tải ảnh và giấy tờ, rồi nộp." },
    { n: "2", title: "HTX sơ duyệt", line: "Hợp tác xã xem và cho ý kiến, có thể yêu cầu bổ sung." },
    { n: "3", title: "Nhận kết quả", line: "Cán bộ ghi kết quả chính thức, người mua quét mã QR để xem." },
  ];

  const lookup = (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.trim();
    if (c) router.push(`/trace/${encodeURIComponent(c)}`);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <section className="relative overflow-hidden rounded-2xl bg-brand-700 p-6 text-white md:p-8">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/photos/hero-painter.jpg" alt="" aria-hidden="true" onError={(e) => { e.currentTarget.style.display = "none"; }} className="pointer-events-none absolute inset-y-0 right-0 hidden h-full w-1/2 object-cover opacity-90 [mask-image:linear-gradient(to_right,transparent,black_40%)] md:block" />
        <div className="relative max-w-xl">
        <h1 className="text-2xl font-bold md:text-3xl">Xin chào, {user.name}</h1>
        <p className="mt-1 text-sm text-brand-100">
          {roles.join(" · ") || "Chưa có vai trò nghiệp vụ"}
          {user.coop ? ` · HTX ${user.coop}` : ""}
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          {canCreate && (
            <Link href="/ocop?new=1" className="rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-brand-800 shadow hover:bg-brand-50">
              + Lập hồ sơ OCOP mới
            </Link>
          )}
          {canProducts && (
            <Link href="/trace" className="rounded-lg border border-white/50 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/10">
              Xem sản phẩm
            </Link>
          )}
        </div>
        {canProducts && (
          <form onSubmit={lookup} className="mt-5 flex max-w-xl gap-2" role="search">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Tra nhanh một sản phẩm theo mã, ví dụ GOM-BT-0001"
              aria-label="Mã sản phẩm"
              className="min-w-0 flex-1 rounded-lg border-0 bg-white px-4 py-2.5 text-sm text-stone-900 placeholder:text-stone-400"
            />
            <button className="rounded-lg bg-brand-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-stone-900">Tra cứu</button>
          </form>
        )}
        </div>
      </section>

      {!canApps && (
        <p className="rounded-xl border border-stone-200 bg-white p-5 text-sm text-stone-600">
          Tài khoản này được xem dữ liệu truy xuất và số liệu, không lập hay xử lý hồ sơ. Chọn một mục ở menu bên trái để bắt đầu.
        </p>
      )}

      <div className="grid gap-6">
      <div className="min-w-0 space-y-6">
      {canApps && (
        <>
          <section aria-label="Tình hình hồ sơ" className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {stats.map((s) => (
              <Link key={s.label} href={s.href} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm transition hover:border-brand-300">
                <span className="block text-sm text-stone-500">{s.label}</span>
                <span className={`mt-1 block text-3xl font-bold ${s.tone}`}>{s.value}</span>
              </Link>
            ))}
          </section>

          <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-stone-800">Việc của bạn</h2>
            {!data && <p className="mt-3 text-sm text-stone-500">Đang tải…</p>}
            {data && waiting.length === 0 && (
              <p className="mt-3 text-sm text-stone-500">Hiện không có hồ sơ nào đang chờ bạn. Bạn có thể nghỉ ngơi.</p>
            )}
            {waiting.length > 0 && (
              <ul className="mt-2 divide-y divide-stone-100">
                {waiting.slice(0, 5).map(({ app, why }) => (
                  <li key={app.code}>
                    <Link href={`/ocop/${encodeURIComponent(app.code)}`} className="flex items-center justify-between gap-3 py-3 hover:bg-stone-50">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-stone-800">{app.product_name}</span>
                        <span className="block font-mono text-xs text-stone-500">{app.code}</span>
                      </span>
                      <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${stateTone[app.state] ?? ""}`}>{why} →</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {waiting.length > 5 && (
              <Link href="/ocop" className="mt-2 inline-block text-sm font-medium text-brand-700 hover:underline">
                Xem thêm {waiting.length - 5} hồ sơ khác
              </Link>
            )}
          </section>

          <section aria-label="Cách làm hồ sơ OCOP">
            <h2 className="mb-3 text-base font-semibold text-stone-800">Hồ sơ OCOP đi qua ba bước</h2>
            <ol className="grid gap-3 md:grid-cols-3">
              {steps.map((s) => (
                <li key={s.n} className="flex gap-3 rounded-xl border border-stone-200 bg-white p-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 text-base font-bold text-white shadow">{s.n}</span>
                  <span>
                    <span className="block text-sm font-semibold text-stone-800">{s.title}</span>
                    <span className="block text-xs leading-relaxed text-stone-500">{s.line}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}

      {canProducts && sectors && (data?.products?.length ?? 0) > 0 && (
        <section aria-labelledby="sector-h">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 id="sector-h" className="text-base font-semibold text-stone-800">Ngành nghề trên cùng một nền tảng</h2>
            <Link href="/nen-tang" className="text-sm font-medium text-brand-700 hover:underline">
              Xem cấu trúc nền tảng ›
            </Link>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2">
            {sectors.map((s) => {
              const n = (data?.products ?? []).filter((p) => p.sector === s.key).length;
              return (
                <li key={s.key}>
                  <Link href={`/trace?sector=${s.key}`} className="group block rounded-xl border border-stone-200 bg-white p-4 shadow-sm transition hover:border-brand-300 hover:shadow">
                    <div className="flex items-center justify-between">
                      <p className="text-base font-semibold text-stone-900 group-hover:text-brand-700">{s.label}</p>
                      <p className="text-sm text-stone-500">{n} sản phẩm</p>
                    </div>
                    <ol className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-1.5 text-xs text-stone-600">
                      {s.stages.map((st, i) => (
                        <li key={st.key} className="flex items-center gap-1">
                          <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-brand-800">
                            <StageIcon stage={st.key} className="h-3 w-3" />
                            {st.label}
                          </span>
                          {i < s.stages.length - 1 && <span aria-hidden="true" className="text-stone-300">›</span>}
                        </li>
                      ))}
                    </ol>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {canProducts && (data?.products?.length ?? 0) > 0 && (
        <section aria-labelledby="recent-h">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 id="recent-h" className="text-base font-semibold text-stone-800">Sản phẩm gần đây</h2>
            <Link href="/trace" className="text-sm font-medium text-brand-700 hover:underline">
              Xem tất cả ›
            </Link>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[...(data?.products ?? [])]
              .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
              .slice(0, 4)
              .map((p) => (
                <li key={p.code}>
                  <Link href={`/trace/${encodeURIComponent(p.code)}`} className="group block overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm transition hover:border-brand-300 hover:shadow">
                    <ProductImage category={p.category} seed={p.code} className="h-28 w-full" />
                    <div className="p-3">
                      <p className="truncate text-sm font-semibold text-stone-900 group-hover:text-brand-700">{p.name}</p>
                      <p className="font-mono text-xs text-stone-500">{p.code}</p>
                      <p className="mt-2 flex items-center gap-1.5 text-xs text-stone-600">
                        {p.last_stage ? (
                          <>
                            <StageIcon stage={p.last_stage} className="h-3.5 w-3.5 text-emerald-600" />
                            {stageLabelOf(sectors, p.sector, p.last_stage)}
                          </>
                        ) : (
                          "Chưa có công đoạn"
                        )}
                      </p>
                      <p className="text-xs text-stone-400">{fmtDate(p.created_at)}</p>
                    </div>
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      )}
      </div>
      </div>
    </div>
  );
}
