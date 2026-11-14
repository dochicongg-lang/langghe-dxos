// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Ô nhập mã in trên tem hoặc dưới mã QR để mở trang tra cứu công khai. */
export default function CodeLookup({ dark = false }: { dark?: boolean }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const c = code.trim();
        if (c) router.push(`/verify/${encodeURIComponent(c)}`);
      }}
      className="flex w-full max-w-xl gap-2"
    >
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        aria-label="Mã sản phẩm"
        placeholder="Nhập mã trên tem, ví dụ GOM-BT-0001"
        className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900 placeholder:text-stone-400"
      />
      <button className={`rounded-lg px-5 py-3 text-sm font-semibold text-white ${dark ? "bg-brand-900 hover:bg-stone-900" : "bg-brand-600 hover:bg-brand-700"}`}>Tra cứu</button>
    </form>
  );
}
