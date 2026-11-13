// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { canSee } from "@/lib/pages";
import { businessNav, platformNav, type NavItem } from "./nav";

function NavLink({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  const pathname = usePathname();
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
        active ? "bg-stone-800 text-white" : "text-stone-300 hover:bg-stone-800/60 hover:text-white"
      }`}
    >
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-bold ${
          active ? "bg-brand-500 text-white" : "bg-stone-800 text-stone-400"
        }`}
      >
        {item.letter}
      </span>
      <span>
        <span className="block font-medium">{item.title}</span>
        <span className="block text-xs text-stone-400">{item.desc}</span>
      </span>
    </Link>
  );
}

/** Thanh bên: cố định ở màn hình rộng, dạng ngăn kéo ở điện thoại (open/onClose do khung trang điều khiển). */
export default function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const business = businessNav.filter((i) => canSee(user, i.href));
  const platform = platformNav.filter((i) => canSee(user, i.href));
  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-stone-900/50 md:hidden" onClick={onClose} aria-hidden="true" />}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col bg-stone-900 text-stone-300 transition-transform md:static md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Link href="/" onClick={onClose} className="flex items-center gap-3 border-b border-stone-800 px-6 py-5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 font-bold text-white">DX</span>
          <span className="leading-tight">
            <span className="block font-semibold text-white">Làng Nghề Số</span>
            <span className="block text-xs text-stone-400">DX-OS · Tầng 2</span>
          </span>
        </Link>
        <nav className="flex-1 space-y-1 overflow-y-auto p-4" aria-label="Điều hướng chính">
          <NavLink item={{ href: "/", letter: "◎", title: "Tổng quan", desc: "Việc của bạn" }} onNavigate={onClose} />
          {business.length > 0 && <p className="px-3 pb-2 pt-5 text-xs font-medium uppercase tracking-wider text-stone-500">Nghiệp vụ · Tầng 3</p>}
          {business.map((i) => (
            <NavLink key={i.href} item={i} onNavigate={onClose} />
          ))}
          <p className="px-3 pb-2 pt-5 text-xs font-medium uppercase tracking-wider text-stone-500">Nền tảng H-P-D-I</p>
          {platform.map((i) => (
            <NavLink key={i.href} item={i} onNavigate={onClose} />
          ))}
        </nav>
      </aside>
    </>
  );
}
