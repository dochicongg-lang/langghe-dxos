// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use client";

import { useState } from "react";

export interface Paged<T> {
  items: T[]; // các phần tử của trang hiện tại
  page: number; // bắt đầu từ 0
  pages: number;
  total: number;
  size: number;
  go: (page: number) => void;
}

/**
 * Chia danh sách thành trang (mỗi trang `size` mục, nên là 5 hoặc 10) để danh sách không dài lê thê.
 * `resetKey` đổi (ví dụ đổi bộ lọc hoặc từ khóa tìm) thì quay về trang đầu.
 */
export function usePaged<T>(all: T[], size: number, resetKey = ""): Paged<T> {
  const [st, setSt] = useState({ key: resetKey, page: 0 });
  const pages = Math.max(1, Math.ceil(all.length / size));
  const page = Math.min(st.key === resetKey ? st.page : 0, pages - 1);
  const go = (p: number) => setSt({ key: resetKey, page: Math.max(0, Math.min(pages - 1, p)) });
  return { items: all.slice(page * size, page * size + size), page, pages, total: all.length, size, go };
}

/** Các số trang hiển thị: luôn có trang đầu, trang cuối và hai bên trang hiện tại; chỗ bỏ qua là "…". */
function windowOf(page: number, pages: number): (number | "gap")[] {
  const keep = new Set([0, pages - 1, page - 1, page, page + 1]);
  const out: (number | "gap")[] = [];
  let last = -1;
  for (const p of [...keep].filter((p) => p >= 0 && p < pages).sort((a, b) => a - b)) {
    if (p - last > 1) out.push("gap");
    out.push(p);
    last = p;
  }
  return out;
}

/** Thanh chuyển trang. Chỉ có một trang thì chỉ hiện dòng tổng số (nếu `showTotal`). */
export default function Pager<T>({ paged, noun = "mục", showTotal = true }: { paged: Paged<T>; noun?: string; showTotal?: boolean }) {
  const { page, pages, total, size, go } = paged;
  if (total === 0) return null;
  const from = page * size + 1;
  const to = Math.min(total, (page + 1) * size);
  const btn = "flex h-9 min-w-9 items-center justify-center rounded-lg border px-2.5 text-sm transition";
  return (
    <nav aria-label="Chuyển trang" className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      {showTotal && (
        <p className="text-xs text-stone-500" role="status">
          Hiển thị {from}–{to} trong {total} {noun}
        </p>
      )}
      {pages > 1 && (
        <ul className="flex flex-wrap items-center gap-1">
          <li>
            <button onClick={() => go(page - 1)} disabled={page === 0} className={`${btn} border-stone-300 bg-white text-stone-700 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40`}>
              ‹ Trước
            </button>
          </li>
          {windowOf(page, pages).map((p, i) =>
            p === "gap" ? (
              <li key={`g${i}`} aria-hidden="true" className="px-1 text-stone-400">
                …
              </li>
            ) : (
              <li key={p}>
                <button
                  onClick={() => go(p)}
                  aria-label={`Trang ${p + 1}`}
                  aria-current={p === page ? "page" : undefined}
                  className={`${btn} ${p === page ? "border-brand-600 bg-brand-600 font-semibold text-white" : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50"}`}
                >
                  {p + 1}
                </button>
              </li>
            ),
          )}
          <li>
            <button onClick={() => go(page + 1)} disabled={page >= pages - 1} className={`${btn} border-stone-300 bg-white text-stone-700 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40`}>
              Sau ›
            </button>
          </li>
        </ul>
      )}
    </nav>
  );
}
