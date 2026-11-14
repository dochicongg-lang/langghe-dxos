// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
import { contactChannels, supportHours, type ContactChannel } from "@/lib/contact";

const COLOR: Record<ContactChannel["key"], string> = {
  phone: "bg-emerald-100 text-emerald-800",
  zalo: "bg-sky-100 text-sky-800",
  facebook: "bg-blue-100 text-blue-800",
  email: "bg-amber-100 text-amber-800",
};

const PATH: Record<ContactChannel["key"], string> = {
  phone: "M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A15 15 0 013 6a2 2 0 012-2z",
  zalo: "M4 5h16v11H9l-5 4zM8 9h8l-8 4h8",
  facebook: "M14 8h3V4h-3a4 4 0 00-4 4v2H7v4h3v6h4v-6h3l1-4h-4V8.5A.5.5 0 0114 8z",
  email: "M3 6h18v12H3zM3 7l9 7 9-7",
};

/** Danh sách các kênh liên hệ đã cấu hình, dùng chung cho cửa sổ nổi và trang Trợ giúp. */
export default function ContactList() {
  const channels = contactChannels();
  if (channels.length === 0) return null;
  return (
    <div>
      <ul className="space-y-2">
        {channels.map((c) => (
          <li key={c.key}>
            <a
              href={c.href}
              {...(c.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white px-3 py-2.5 hover:border-brand-300 hover:bg-stone-50"
            >
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${COLOR[c.key]}`}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={PATH[c.key]} />
                </svg>
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-stone-900">{c.label}</span>
                <span className="block truncate text-xs text-stone-500">{c.value}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-stone-500">{supportHours}</p>
    </div>
  );
}
