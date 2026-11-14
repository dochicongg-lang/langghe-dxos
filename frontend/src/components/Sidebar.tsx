// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { canSee } from "@/lib/pages";
import { businessNav, helpNav, homeNav, iconPath, platformNav, type NavItem } from "./nav";

function NavLink({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  const pathname = usePathname();
  const active = item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`);
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
        active ? "bg-brand-600 text-white" : "text-stone-300 hover:bg-stone-800 hover:text-white"
      }`}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
        <path d={iconPath(item.icon)} />
      </svg>
      <span>
        <span className="block font-medium">{item.title}</span>
        <span className={`block text-xs ${active ? "text-brand-100" : "text-stone-400"}`}>{item.desc}</span>
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
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 font-bold text-white">LN</span>
          <span className="leading-tight">
            <span className="block font-semibold text-white">Làng Nghề Số</span>
            <span className="block text-xs text-stone-400">Cổng dịch vụ làng nghề</span>
          </span>
        </Link>
        <nav className="flex-1 space-y-1 overflow-y-auto p-4" aria-label="Điều hướng chính">
          <NavLink item={homeNav} onNavigate={onClose} />
          {business.map((i) => (
            <NavLink key={i.href} item={i} onNavigate={onClose} />
          ))}
          {platform.length > 0 && <p className="px-3 pb-1 pt-5 text-xs font-medium uppercase tracking-wider text-stone-500">Quản lý</p>}
          {platform.map((i) => (
            <NavLink key={i.href} item={i} onNavigate={onClose} />
          ))}
          <div className="pt-4">
            <NavLink item={helpNav} onNavigate={onClose} />
          </div>
        </nav>
      </aside>
    </>
  );
}
