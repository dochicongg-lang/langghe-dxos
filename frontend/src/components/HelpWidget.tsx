// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import ContactList from "./ContactList";
import Photo from "./Photo";
import { contactChannels } from "@/lib/contact";
import { canSee } from "@/lib/pages";

type Panel = "help" | "contact" | null;

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

/** Hai cửa sổ nhỏ nổi ở góc dưới bên phải: "Trợ giúp" (hướng dẫn) và "Liên hệ" (điện thoại, Zalo, Facebook...). Mở một cái thì cái kia đóng. */
export default function HelpWidget() {
  const { user } = useAuth();
  const [panel, setPanel] = useState<Panel>(null);
  const box = useRef<HTMLDivElement>(null);
  const assistant = canSee(user, "/intelligence");
  const hasContact = contactChannels().length > 0;

  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPanel(null);
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setPanel(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [panel]);

  const toggle = (p: Exclude<Panel, null>) => setPanel((cur) => (cur === p ? null : p));
  const rows = [
    { href: "/help", title: "Hướng dẫn sử dụng", sub: "Từng bước làm hồ sơ, tra cứu, quét mã QR" },
    ...(assistant ? [{ href: "/intelligence", title: "Hỏi trợ lý", sub: "Hạng sao, giấy tờ, hạn xử lý" }] : []),
    { href: "/help#lien-he", title: "Cách nhờ giúp đỡ", sub: "Hỏi cán bộ hợp tác xã hoặc quản trị viên" },
  ];

  const close = (
    <button onClick={() => setPanel(null)} aria-label="Đóng cửa sổ" className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-stone-600 shadow hover:bg-white">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
  const panelCls = "w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-xl";
  const btnCls = "flex items-center gap-2 rounded-full px-4 py-3 text-sm font-semibold shadow-lg";

  return (
    <div ref={box} className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-3">
      {panel === "help" && (
        <section id="help-widget" role="dialog" aria-label="Trợ giúp" className={panelCls}>
          <div className="relative">
            <Photo src="/illustrations/support.svg" className="h-28 w-full object-cover object-top" />
            {close}
          </div>
          <div className="p-4">
            <h2 className="text-base font-semibold text-stone-900">Bạn cần giúp gì?</h2>
            <ul className="mt-2 divide-y divide-stone-100">
              {rows.map((r) => (
                <li key={r.title}>
                  <Link href={r.href} onClick={() => setPanel(null)} className="flex items-center justify-between gap-3 py-2.5 hover:bg-stone-50">
                    <span>
                      <span className="block text-sm font-medium text-stone-800">{r.title}</span>
                      <span className="block text-xs text-stone-500">{r.sub}</span>
                    </span>
                    <span aria-hidden="true" className="text-stone-400">›</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
      {panel === "contact" && (
        <section id="contact-widget" role="dialog" aria-label="Liên hệ" className={panelCls}>
          <div className="relative border-b border-stone-100 bg-brand-50 px-4 py-4">
            <h2 className="pr-8 text-base font-semibold text-stone-900">Liên hệ với chúng tôi</h2>
            <p className="text-xs text-stone-600">Chọn cách thuận tiện nhất cho bạn</p>
            {close}
          </div>
          <div className="p-4">
            <ContactList />
          </div>
        </section>
      )}
      <div className="flex items-center gap-2">
        {hasContact && (
          <button onClick={() => toggle("contact")} aria-expanded={panel === "contact"} aria-controls="contact-widget" className={`${btnCls} ${panel === "contact" ? "bg-stone-800 text-white" : "bg-white text-brand-800 ring-1 ring-brand-200 hover:bg-brand-50"}`}>
            <Icon d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A15 15 0 013 6a2 2 0 012-2z" />
            {panel === "contact" ? "Đóng" : "Liên hệ"}
          </button>
        )}
        <button onClick={() => toggle("help")} aria-expanded={panel === "help"} aria-controls="help-widget" className={`${btnCls} ${panel === "help" ? "bg-stone-800 text-white" : "bg-brand-600 text-white hover:bg-brand-700"}`}>
          <Icon d="M12 21a9 9 0 100-18 9 9 0 000 18zM9.5 9.5a2.5 2.5 0 114 2c-.9.6-1.5 1.1-1.5 2.2M12 17h.01" />
          {panel === "help" ? "Đóng" : "Trợ giúp"}
        </button>
      </div>
    </div>
  );
}
