// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use client";

import Link from "next/link";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-8 text-center shadow-sm" role="alert">
        <span className="mx-auto mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 font-bold text-white">LN</span>
        <h1 className="text-xl font-semibold text-stone-900">Có lỗi xảy ra</h1>
        <p className="mt-2 text-sm leading-relaxed text-stone-600">Trang này gặp sự cố. Công việc đã lưu không bị mất. Hãy thử lại; nếu vẫn lỗi, báo người quản trị.</p>
        <div className="mt-5 flex justify-center gap-3">
          <button onClick={reset} className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">
            Thử lại
          </button>
          <Link href="/" className="rounded-lg border border-stone-300 px-5 py-2.5 text-sm font-semibold text-stone-700 hover:bg-stone-100">
            Về trang chủ
          </Link>
        </div>
      </div>
    </main>
  );
}
