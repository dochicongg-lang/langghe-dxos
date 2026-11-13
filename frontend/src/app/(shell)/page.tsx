// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Card, { PageTitle } from "@/components/Card";
import { useAuth } from "@/components/AuthProvider";
import { stateLabels, stateTone, type OcopSummary } from "@/lib/ocop";
import { canSee } from "@/lib/pages";
import { visibleRoles } from "@/lib/roles";
import type { ProductSummary } from "@/lib/trace";

interface Overview {
  products: ProductSummary[] | null;
  applications: OcopSummary[] | null;
  openTasks: number | null;
}

const TERMINAL = ["rejected", "recognized", "not_recognized"];

export default function Home() {
  const { user, apiFetch } = useAuth();
  const [data, setData] = useState<Overview | null>(null);

  useEffect(() => {
    let alive = true;
    const get = async <T,>(path: string, pick: (b: Record<string, unknown>) => T): Promise<T | null> => {
      try {
        const res = await apiFetch(path);
        return res.ok ? pick((await res.json()) as Record<string, unknown>) : null;
      } catch {
        return null;
      }
    };
    void Promise.all([
      user.permissions["product.read"] ? get("/api/trace/products", (b) => b.products as ProductSummary[]) : null,
      user.permissions["application.read"] ? get("/api/trace/applications", (b) => b.applications as OcopSummary[]) : null,
      user.pages.includes("process") ? get("/api/workflow/runtime/tasks?size=1", (b) => Number(b.total ?? 0)) : null,
    ]).then(([products, applications, openTasks]) => {
      if (alive) setData({ products, applications, openTasks });
    });
    return () => {
      alive = false;
    };
  }, [apiFetch, user.permissions, user.pages]);

  const roles = visibleRoles(user.roles);
  const apps = data?.applications ?? [];

  // "Việc của bạn": hồ sơ đang chờ chính người dùng này xử lý, suy ra từ quyền hiệu lực (máy chủ luôn kiểm tra lại khi thao tác)
  const waiting: { app: OcopSummary; why: string }[] = [];
  for (const a of apps) {
    if (user.permissions["application.review"] && a.state === "in_review") waiting.push({ app: a, why: "Chờ bạn sơ duyệt" });
    else if (user.permissions["application.decide"] && a.state === "awaiting_result") waiting.push({ app: a, why: "Chờ ghi kết quả chính thức" });
    else if (user.permissions["application.update"] && a.owner === user.username && a.state === "needs_revision") waiting.push({ app: a, why: "HTX yêu cầu bổ sung" });
    else if (user.permissions["application.update"] && a.owner === user.username && a.state === "draft") waiting.push({ app: a, why: "Bản nháp chưa nộp" });
  }
  const inProgress = apps.filter((a) => !TERMINAL.includes(a.state)).length;
  const events = data?.products?.reduce((s, p) => s + p.event_count, 0) ?? null;
  const num = (n: number | null | undefined) => (n === null || n === undefined ? "—" : String(n));

  // Bốn chặng tiến hóa của Tầng 2, kèm con số thật để thấy mỗi chặng đang "sống" thế nào
  const journey = [
    { href: "/human", letter: "H", title: "Human", line: "Danh tính, vai trò, HTX", metric: `${Object.keys(user.permissions).length} quyền`, hint: roles.join(", ") || "chưa có vai trò" },
    { href: "/process", letter: "P", title: "Process", line: "Quy trình hồ sơ OCOP trên Flowable", metric: `${num(data?.openTasks)} việc mở`, hint: "nhiệm vụ đang chờ xử lý" },
    { href: "/data", letter: "D", title: "Data", line: "Sản phẩm, công đoạn, tệp", metric: `${num(data?.products?.length)} sản phẩm`, hint: `${num(events)} công đoạn đã ghi` },
    { href: "/intelligence", letter: "I", title: "Intelligence", line: "Số liệu cảm biến lò nung", metric: "Đường cong", hint: "bằng chứng nhiệt độ" },
  ];

  const visibleJourney = journey.filter((j) => canSee(user, j.href));
  const canApps = Boolean(user.permissions["application.read"]);
  const canProducts = Boolean(user.permissions["product.read"]);
  const canProcess = user.pages.includes("process");

  return (
    <>
      <PageTitle title={`Xin chào, ${user.name}`} desc={`${roles.join(" · ") || "Chưa có vai trò nghiệp vụ"}${user.coop ? ` · HTX ${user.coop}` : ""}`} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className={`space-y-4 ${canApps ? "lg:col-span-2" : "lg:col-span-3"}`}>
          {!canApps && (
            <Card title="Chế độ chỉ xem">
              <p className="text-sm text-stone-600">
                Tài khoản này được xem dữ liệu truy xuất và số liệu, không lập hay xử lý hồ sơ. Chọn một mục ở menu bên trái để bắt đầu
                {canProducts && (
                  <>
                    , ví dụ{" "}
                    <Link href="/trace" className="font-medium text-brand-700 hover:underline">
                      Truy xuất nguồn gốc
                    </Link>
                  </>
                )}
                .
              </p>
            </Card>
          )}
          {canApps && <Card title="Việc của bạn">
            {!data && <p className="text-sm text-stone-500">Đang tải…</p>}
            {data && waiting.length === 0 && (
              <p className="text-sm text-stone-500">
                Không có hồ sơ nào đang chờ bạn.{" "}
                {user.permissions["application.create"] && (
                  <Link href="/ocop" className="font-medium text-brand-700 hover:underline">
                    Lập hồ sơ OCOP mới
                  </Link>
                )}
              </p>
            )}
            {waiting.length > 0 && (
              <ul className="divide-y divide-stone-100">
                {waiting.slice(0, 6).map(({ app, why }) => (
                  <li key={app.code}>
                    <Link href={`/ocop/${encodeURIComponent(app.code)}`} className="flex items-center justify-between gap-3 py-3 hover:bg-stone-50">
                      <span>
                        <span className="block text-sm font-medium text-stone-800">{app.product_name}</span>
                        <span className="block font-mono text-xs text-stone-500">{app.code}</span>
                      </span>
                      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${stateTone[app.state] ?? ""}`}>{why}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {waiting.length > 6 && <p className="mt-2 text-xs text-stone-500">và {waiting.length - 6} hồ sơ khác, xem ở mục Hồ sơ OCOP.</p>}
          </Card>}

          <div className="grid gap-4 sm:grid-cols-3">
            {canProducts && <Stat href="/trace" label="Sản phẩm truy xuất" value={num(data?.products?.length)} note="được phép xem" />}
            {canApps && <Stat href="/ocop" label="Hồ sơ OCOP" value={num(data?.applications ? inProgress : null)} note={`đang xử lý / ${num(data?.applications?.length)} hồ sơ`} />}
            {canProcess && <Stat href="/process" label="Nhiệm vụ quy trình" value={num(data?.openTasks)} note="đang mở trong Flowable" />}
          </div>
        </div>

        {canApps && <Card title="Trạng thái hồ sơ OCOP">
          {!data?.applications ? (
            <p className="text-sm text-stone-500">{data ? "Vai trò của bạn không xem hồ sơ OCOP." : "Đang tải…"}</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {Object.keys(stateLabels).map((s) => {
                const n = apps.filter((a) => a.state === s).length;
                return (
                  <li key={s} className="flex items-center justify-between">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${stateTone[s]}`}>{stateLabels[s]}</span>
                    <span className="font-semibold text-stone-800">{n}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>}
      </div>

      <section className="mt-6" aria-labelledby="journey">
        <h2 id="journey" className="mb-1 text-base font-semibold text-stone-800">
          Nền tảng H-P-D-I
        </h2>
        <p className="mb-3 text-sm text-stone-500">Bốn chặng tiến hóa của Tầng 2: từ con người, đến quy trình, dữ liệu, rồi trí tuệ. Bạn thấy các chặng thuộc vai trò của mình.</p>
        <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {visibleJourney.map((j, i) => (
            <li key={j.href} className="relative">
              <Link href={j.href} className="block h-full rounded-xl border border-stone-200 bg-white p-4 shadow-sm transition hover:border-brand-300 hover:shadow">
                <span className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-base font-bold text-white">{j.letter}</span>
                  <span>
                    <span className="block text-sm font-semibold text-stone-900">{j.title}</span>
                    <span className="block text-xs text-stone-500">{j.line}</span>
                  </span>
                </span>
                <span className="mt-3 block text-lg font-semibold text-brand-700">{j.metric}</span>
                <span className="block text-xs text-stone-500">{j.hint}</span>
              </Link>
              {i < visibleJourney.length - 1 && (
                <span aria-hidden="true" className="absolute -right-2.5 top-1/2 z-10 hidden -translate-y-1/2 text-stone-400 xl:block">
                  →
                </span>
              )}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

function Stat({ href, label, value, note }: { href: string; label: string; value: string; note: string }) {
  return (
    <Link href={href} className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm transition hover:border-brand-300 hover:shadow">
      <span className="block text-xs font-medium uppercase tracking-wide text-stone-500">{label}</span>
      <span className="mt-1 block text-3xl font-bold text-stone-900">{value}</span>
      <span className="block text-xs text-stone-500">{note}</span>
    </Link>
  );
}
