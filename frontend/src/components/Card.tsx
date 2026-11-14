// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
export default function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
      {title && <h2 className="mb-4 text-base font-semibold text-stone-800">{title}</h2>}
      {children}
    </section>
  );
}

/** Tiêu đề trang. `flush`: bỏ khoảng cách dưới khi đặt trong PageHeader (PageHeader tự lo khoảng cách). */
export function PageTitle({ title, desc, flush = false }: { title: string; desc: string; flush?: boolean }) {
  return (
    <div className={flush ? "min-w-0 flex-1 basis-72" : "mb-6"}>
      <h1 className="text-2xl font-bold text-stone-900">{title}</h1>
      <p className="mt-1 text-sm text-stone-500">{desc}</p>
    </div>
  );
}
