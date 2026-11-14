// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use client";

import { useId, useRef, useState } from "react";

const WIDTH = 208; // w-52
const MARGIN = 8;

/**
 * Dấu ? nhỏ giải thích một thuật ngữ; hiện khi rê chuột hoặc bấm, Esc để đóng.
 * Khung giải thích đặt theo vị trí cố định trên màn hình (không nằm trong dòng chảy của trang) và luôn nằm gọn trong cửa sổ,
 * nên không làm hiện thanh cuộn ngang khi dấu ? nằm trong bảng hoặc khung có cuộn.
 */
export default function Tip({ text, className = "" }: { text: string; className?: string }) {
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const show = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.min(Math.max(MARGIN, r.left + r.width / 2 - WIDTH / 2), window.innerWidth - WIDTH - MARGIN);
    setPos({ left, top: r.bottom + 6 });
  };
  const hide = () => setPos(null);

  return (
    <span className={`relative inline-flex align-middle ${className}`} onMouseEnter={show} onMouseLeave={hide}>
      <button
        ref={btn}
        type="button"
        aria-label="Giải thích"
        data-no-title
        aria-describedby={pos ? id : undefined}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (pos) hide();
          else show();
        }}
        onFocus={show}
        onBlur={hide}
        onKeyDown={(e) => {
          if (e.key === "Escape") hide();
        }}
        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-stone-300 bg-white text-[10px] font-semibold leading-none text-stone-500 hover:border-brand-500 hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        ?
      </button>
      {pos && (
        <span id={id} role="tooltip" style={{ position: "fixed", left: pos.left, top: pos.top, width: WIDTH }} className="z-50 rounded-lg bg-stone-900 px-3 py-2 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-white shadow-lg">
          {text}
        </span>
      )}
    </span>
  );
}
