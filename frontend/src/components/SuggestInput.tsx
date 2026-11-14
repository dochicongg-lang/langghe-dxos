// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use client";

import { useId, useMemo, useRef, useState } from "react";

export interface Suggestion {
  value: string; // nội dung sẽ điền vào ô
  hint?: string; // chú thích nhỏ bên cạnh (ví dụ tên sản phẩm của một mã)
}

const strip = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();

/** Danh sách gợi ý không trùng, giữ thứ tự xuất hiện (mới nhất trước nếu danh sách đầu vào đã sắp như vậy). */
export function uniqueSuggestions(values: (string | null | undefined)[], hints?: Map<string, string>): Suggestion[] {
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const raw of values) {
    const v = (raw ?? "").trim();
    if (!v || seen.has(strip(v))) continue;
    seen.add(strip(v));
    out.push({ value: v, hint: hints?.get(v) });
  }
  return out;
}

/**
 * Ô nhập có gợi ý hiện ngay bên dưới: gợi ý lấy từ những gì đã nhập trước đó (tên sản phẩm, làng nghề, nghệ nhân...) để người dùng
 * không phải gõ lại và đỡ nhập sai chính tả. Lọc theo chữ đang gõ, không phân biệt dấu. Dùng được bằng bàn phím (mũi tên, Enter, Esc).
 * Có thể dùng không điều khiển (chỉ cần `name`, đọc bằng FormData) hoặc điều khiển (`value` và `onChange`).
 */
export default function SuggestInput({
  name,
  items,
  value,
  onChange,
  onPick,
  defaultValue = "",
  className = "",
  max = 6,
  ...rest
}: {
  name: string;
  items: Suggestion[];
  value?: string;
  onChange?: (v: string) => void;
  onPick?: (s: Suggestion) => void;
  defaultValue?: string;
  className?: string;
  max?: number;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "defaultValue" | "name">) {
  const [inner, setInner] = useState(defaultValue);
  const text = value ?? inner;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const id = useId();
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const list = useMemo(() => {
    const q = strip(text.trim());
    return items.filter((s) => strip(s.value) !== q && (q === "" || strip(s.value).includes(q) || (s.hint ? strip(s.hint).includes(q) : false))).slice(0, max);
  }, [items, text, max]);

  const set = (v: string) => {
    setInner(v);
    onChange?.(v);
  };
  const pick = (s: Suggestion) => {
    set(s.value);
    onPick?.(s);
    setOpen(false);
    setActive(-1);
  };
  const showing = open && list.length > 0;

  return (
    <div className="relative">
      <input
        {...rest}
        name={name}
        value={text}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showing}
        aria-controls={`${id}-list`}
        aria-activedescendant={showing && active >= 0 ? `${id}-opt-${active}` : undefined}
        className={className}
        onChange={(e) => {
          set(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => {
          if (closeTimer.current) clearTimeout(closeTimer.current);
          setOpen(true);
        }}
        onBlur={() => {
          closeTimer.current = setTimeout(() => setOpen(false), 120);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && list.length > 0) {
            e.preventDefault();
            setOpen(true);
            setActive((a) => (a + 1) % list.length);
          } else if (e.key === "ArrowUp" && list.length > 0) {
            e.preventDefault();
            setActive((a) => (a <= 0 ? list.length - 1 : a - 1));
          } else if (e.key === "Enter" && showing && active >= 0) {
            e.preventDefault();
            pick(list[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {showing && (
        <ul id={`${id}-list`} role="listbox" className="absolute left-0 right-0 z-30 mt-1 max-h-60 overflow-auto rounded-lg border border-stone-200 bg-white py-1 shadow-lg">
          <li role="presentation" className="px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-stone-400">
            Gợi ý từ những gì đã nhập
          </li>
          {list.map((s, i) => (
            <li
              key={s.value}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault(); // giữ ô nhập không mất tiêu điểm trước khi chọn
                pick(s);
              }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3 py-2 text-sm ${i === active ? "bg-brand-50 text-stone-900" : "text-stone-800 hover:bg-stone-50"}`}
            >
              <span className="block break-words">{s.value}</span>
              {s.hint && <span className="block break-words text-xs text-stone-500">{s.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
