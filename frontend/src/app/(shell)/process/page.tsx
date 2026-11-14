// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Card, { PageTitle } from "@/components/Card";
import { useAuth } from "@/components/AuthProvider";
import { stateLabels, stateTone, type OcopSummary } from "@/lib/ocop";

// Các chặng của hồ sơ OCOP, theo thứ tự đi của một hồ sơ
const stages: { key: string; title: string; who: string; states: string[] }[] = [
  { key: "draft", title: "Lập hồ sơ", who: "Người sản xuất", states: ["draft", "needs_revision"] },
  { key: "review", title: "HTX sơ duyệt", who: "Cán bộ hợp tác xã", states: ["in_review"] },
  { key: "result", title: "Ghi kết quả", who: "Cán bộ đầu mối OCOP", states: ["awaiting_result"] },
  { key: "done", title: "Đã có kết quả", who: "Cơ quan có thẩm quyền", states: ["recognized", "not_recognized", "rejected"] },
];

export default function ProcessPage() {
  const { apiFetch } = useAuth();
  const [apps, setApps] = useState<OcopSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/trace/applications")
      .then(async (res) => {
        if (!res.ok) throw new Error(`Hệ thống báo lỗi (mã ${res.status})`);
        setApps(((await res.json()) as { applications: OcopSummary[] }).applications);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Lỗi không xác định"));
  }, [apiFetch]);

  const inStage = (s: (typeof stages)[number]) => (apps ?? []).filter((a) => s.states.includes(a.state));
  const revisions = (apps ?? []).filter((a) => a.state === "needs_revision").length;

  return (
    <>
      <PageTitle title="Việc đang xử lý" desc="Mỗi hồ sơ OCOP đi qua bốn chặng. Xem hồ sơ đang nằm ở đâu và ai đang giữ." />
      {error && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">Không tải được dữ liệu: {error}</p>}

      <ol className="grid gap-3 md:grid-cols-4">
        {stages.map((s, i) => {
          const list = inStage(s);
          return (
            <li key={s.key} className="relative flex flex-col rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">{i + 1}</span>
              <p className="mt-3 text-base font-semibold text-stone-900">{s.title}</p>
              <p className="text-xs text-stone-500">{s.who}</p>
              <p className="mt-3 text-3xl font-bold text-stone-900">{apps ? list.length : "—"}</p>
              <p className="text-xs text-stone-500">hồ sơ{s.key === "draft" && revisions > 0 ? `, trong đó ${revisions} cần bổ sung` : ""}</p>
              {i < stages.length - 1 && (
                <span aria-hidden="true" className="absolute -right-2.5 top-1/2 z-10 hidden -translate-y-1/2 text-stone-400 md:block">
                  →
                </span>
              )}
            </li>
          );
        })}
      </ol>

      <div className="mt-6">
        <Card title="Hồ sơ cần chú ý">
          {!apps && !error && <p className="text-sm text-stone-500">Đang tải…</p>}
          {apps && apps.filter((a) => ["in_review", "needs_revision", "awaiting_result"].includes(a.state)).length === 0 && (
            <p className="text-sm text-stone-600">Không có hồ sơ nào đang chờ xử lý. Mọi hồ sơ đều đã được giải quyết hoặc còn ở dạng nháp.</p>
          )}
          <ul className="divide-y divide-stone-100">
            {(apps ?? [])
              .filter((a) => ["in_review", "needs_revision", "awaiting_result"].includes(a.state))
              .slice(0, 12)
              .map((a) => (
                <li key={a.code}>
                  <Link href={`/ocop/${encodeURIComponent(a.code)}`} className="flex items-center justify-between gap-3 py-3 hover:bg-stone-50">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-stone-800">{a.product_name}</span>
                      <span className="block truncate text-xs text-stone-500">
                        <span className="font-mono">{a.code}</span> · người nộp {a.owner}
                      </span>
                    </span>
                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${stateTone[a.state] ?? ""}`}>{stateLabels[a.state] ?? a.state}</span>
                  </Link>
                </li>
              ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
