// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use client";

import { useAuth } from "./AuthProvider";
import { initials, visibleRoles } from "@/lib/roles";

export default function Header({ onMenu }: { onMenu: () => void }) {
  const { user, logout } = useAuth();
  const roles = visibleRoles(user.roles);
  return (
    <header className="flex items-center justify-between gap-3 border-b border-stone-200 bg-white px-4 py-3 md:px-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenu}
          aria-label="Mở menu"
          className="rounded-lg border border-stone-300 p-2 text-stone-600 hover:bg-stone-100 md:hidden"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <p className="hidden text-sm text-stone-500 sm:block">Cổng dịch vụ dùng chung · Tầng 2</p>
      </div>
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-800"
        >
          {initials(user.name)}
        </span>
        <div className="hidden text-right leading-tight sm:block">
          <p className="text-sm font-medium text-stone-800">{user.name}</p>
          <p className="text-xs text-stone-500">{roles.join(" · ") || user.email || user.username}</p>
        </div>
        <button onClick={logout} className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-100">
          Đăng xuất
        </button>
      </div>
    </header>
  );
}
