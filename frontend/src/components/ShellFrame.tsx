// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useAuth } from "./AuthProvider";
import Header from "./Header";
import HelpWidget from "./HelpWidget";
import Sidebar from "./Sidebar";
import { canSee } from "@/lib/pages";

/** Khung trang sau đăng nhập: thanh bên (ngăn kéo ở điện thoại) + đầu trang + nội dung. */
export default function ShellFrame({ children }: { children: React.ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  const { user } = useAuth();
  const pathname = usePathname();
  const allowed = canSee(user, pathname);
  return (
    <div className="flex min-h-screen bg-canvas">
      <a href="#noi-dung" className="sr-only z-50 rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Bỏ qua menu, đến nội dung chính
      </a>
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header onMenu={() => setNavOpen(true)} />
        <main id="noi-dung" tabIndex={-1} className="flex-1 p-4 outline-none md:p-6">
          {allowed ? (
            children
          ) : (
            <div className="mx-auto mt-10 max-w-md rounded-2xl border border-stone-200 bg-white p-8 text-center shadow-sm">
              <p className="text-lg font-semibold text-stone-900">Trang này không thuộc vai trò của bạn</p>
              <p className="mt-2 text-sm text-stone-600">Tài khoản hiện tại không được cấp quyền xem nội dung này. Nếu cần, hãy liên hệ quản trị viên.</p>
              <Link href="/" className="mt-5 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
                Về trang chủ
              </Link>
            </div>
          )}
        </main>
        <footer className="border-t border-stone-200 px-4 pb-24 pt-4 text-xs sm:pb-4 sm:pr-32 text-stone-500 md:px-6 md:pr-36">
          <p>
            Làng Nghề Số · Hỗ trợ lập hồ sơ OCOP và truy xuất nguồn gốc làng nghề. Kết quả OCOP chính thức do cơ quan có thẩm quyền quyết định.{" "}
            <Link href="/help" className="font-medium text-brand-700 hover:underline">
              Trợ giúp và liên hệ
            </Link>
            {" · "}
            <Link href="/gioi-thieu" className="font-medium text-brand-700 hover:underline">
              Giới thiệu
            </Link>
          </p>
        </footer>
      </div>
      <HelpWidget />
    </div>
  );
}
