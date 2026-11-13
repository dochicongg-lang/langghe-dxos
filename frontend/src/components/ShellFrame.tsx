"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useAuth } from "./AuthProvider";
import Header from "./Header";
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
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header onMenu={() => setNavOpen(true)} />
        <main className="flex-1 p-4 md:p-6">
          {allowed ? (
            children
          ) : (
            <div className="mx-auto mt-10 max-w-md rounded-2xl border border-stone-200 bg-white p-8 text-center shadow-sm">
              <p className="text-lg font-semibold text-stone-900">Trang này không thuộc vai trò của bạn</p>
              <p className="mt-2 text-sm text-stone-600">Tài khoản hiện tại không được cấp quyền xem nội dung này. Nếu cần, hãy liên hệ quản trị viên.</p>
              <Link href="/" className="mt-5 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
                Về trang tổng quan
              </Link>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
