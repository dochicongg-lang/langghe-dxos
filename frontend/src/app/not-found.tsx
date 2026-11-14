// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-8 text-center shadow-sm">
        <span className="mx-auto mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 font-bold text-white">LN</span>
        <h1 className="text-xl font-semibold text-stone-900">Không tìm thấy trang này</h1>
        <p className="mt-2 text-sm leading-relaxed text-stone-600">Đường dẫn có thể đã gõ sai hoặc trang không còn nữa. Hãy quay về trang chủ rồi chọn lại mục bạn cần.</p>
        <Link href="/" className="mt-5 inline-block rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">
          Về trang chủ
        </Link>
      </div>
    </main>
  );
}
