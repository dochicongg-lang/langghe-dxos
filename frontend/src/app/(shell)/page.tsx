import Link from "next/link";
import { PageTitle } from "@/components/Card";
import { stages } from "@/lib/stages";

export default function Home() {
  return (
    <>
      <PageTitle
        title="Tổng quan"
        desc="Tầng 2 thể hiện sự tiến hóa Human → Process → Data → Intelligence trên nền dịch vụ lõi Tầng 1."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stages.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-indigo-300 hover:shadow"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500 text-lg font-bold text-white">
              {s.letter}
            </span>
            <h2 className="mt-4 font-semibold text-slate-900">{s.title}</h2>
            <p className="mt-1 text-sm text-slate-500">{s.desc}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
