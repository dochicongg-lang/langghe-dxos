// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import Pager, { usePaged } from "./Pager";
import { useAuth } from "./AuthProvider";
import { fmtDate } from "@/lib/trace";

interface Notice {
  id: number;
  kind: string;
  level: "info" | "warn" | "alert";
  title: string;
  body: string;
  link: string | null;
  created_at: string;
  read: boolean;
}

const tone: Record<Notice["level"], string> = { info: "text-sky-700", warn: "text-amber-700", alert: "text-red-700" };
const icon: Record<Notice["level"], string> = { info: "ℹ", warn: "⚠", alert: "⛔" };

/** Chuông thông báo: nhắc hạn xử lý hồ sơ, quá hạn, gia hạn, đề xuất chờ duyệt. Tự làm mới mỗi phút. */
export default function NotificationBell() {
  const { apiFetch } = useAuth();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ unread: number; notifications: Notice[] } | null>(null);
  const paged = usePaged(data?.notifications ?? [], 5);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/api/trace/notifications");
      if (res.ok) setData(await res.json());
    } catch {
      /* mất kết nối tạm thời: giữ nguyên danh sách cũ */
    }
  }, [apiFetch]);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function markRead(id: number | null) {
    try {
      await apiFetch(id === null ? "/api/trace/notifications/read-all" : `/api/trace/notifications/${id}/read`, { method: "POST" });
    } finally {
      void load();
    }
  }

  const unread = data?.unread ?? 0;
  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={unread ? `Thông báo, ${unread} chưa đọc` : "Thông báo"}
        aria-expanded={open}
        className="relative rounded-lg border border-stone-300 p-2 text-stone-600 hover:bg-stone-100"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1 text-[11px] font-semibold text-white">{unread > 9 ? "9+" : unread}</span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-label="Thông báo" className="absolute right-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-stone-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-stone-100 px-4 py-2.5">
            <p className="text-sm font-semibold text-stone-800">Thông báo</p>
            {unread > 0 && (
              <button onClick={() => void markRead(null)} className="text-xs font-medium text-brand-700 hover:underline">
                Đánh dấu đã đọc tất cả
              </button>
            )}
          </div>
          {!data || data.notifications.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-stone-500">Chưa có thông báo nào.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-stone-100 overflow-y-auto">
              {paged.items.map((n) => (
                <li key={n.id} className={n.read ? "bg-white" : "bg-brand-50/50"}>
                  <Link
                    href={n.link ?? "/"}
                    onClick={() => {
                      setOpen(false);
                      if (!n.read) void markRead(n.id);
                    }}
                    className="block px-4 py-3 hover:bg-stone-50"
                  >
                    <p className={`text-sm ${n.read ? "font-medium" : "font-semibold"} text-stone-900`}>
                      <span aria-hidden="true" className={`mr-1 ${tone[n.level]}`}>
                        {icon[n.level]}
                      </span>
                      {n.title}
                    </p>
                    <p className="mt-0.5 text-xs leading-snug text-stone-600">{n.body}</p>
                    <p className="mt-1 text-[11px] text-stone-400">{fmtDate(n.created_at)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {data && data.notifications.length > 0 && (
            <div className="border-t border-stone-100 px-4 pb-3">
              <Pager paged={paged} noun="thông báo" showTotal={false} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
