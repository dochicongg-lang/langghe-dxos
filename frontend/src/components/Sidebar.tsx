"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { stages } from "@/lib/stages";

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden w-64 shrink-0 flex-col bg-slate-900 text-slate-300 md:flex">
      <Link href="/" className="flex items-center gap-3 border-b border-slate-800 px-6 py-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500 font-bold text-white">DX</span>
        <span className="leading-tight">
          <span className="block font-semibold text-white">Làng Nghề Số</span>
          <span className="block text-xs text-slate-400">DX-OS · Tầng 2</span>
        </span>
      </Link>
      <nav className="flex-1 space-y-1 p-4">
        <p className="px-3 pb-2 text-xs font-medium uppercase tracking-wider text-slate-500">H-P-D-I</p>
        {stages.map((s) => {
          const active = pathname.startsWith(s.href);
          return (
            <Link
              key={s.href}
              href={s.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
                active ? "bg-slate-800 text-white" : "hover:bg-slate-800/60 hover:text-white"
              }`}
            >
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-md text-xs font-bold ${
                  active ? "bg-indigo-500 text-white" : "bg-slate-800 text-slate-400"
                }`}
              >
                {s.letter}
              </span>
              <span>
                <span className="block font-medium">{s.title}</span>
                <span className="block text-xs text-slate-500">{s.desc}</span>
              </span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
