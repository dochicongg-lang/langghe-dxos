// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Card from "./Card";
import Pager, { usePaged } from "./Pager";
import { useAuth } from "./AuthProvider";
import { fmtDate } from "@/lib/trace";

interface Proposal {
  id: number;
  severity: "warn" | "alert";
  title: string;
  rationale: string;
  subject: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string;
}

const statusText = { approved: "Đã duyệt", rejected: "Đã từ chối", pending: "Chờ duyệt" } as const;

/** Đề xuất của hệ thống về các mẻ nung và mẻ nhuộm cần xem lại. Hệ thống chỉ đề xuất; hành động chỉ thực hiện sau khi người có thẩm quyền duyệt. */
export default function ProposalsPanel() {
  const { apiFetch, user } = useAuth();
  const allowed = Boolean(user.permissions["application.review"]);
  const [items, setItems] = useState<Proposal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    if (!allowed) return;
    try {
      const res = await apiFetch("/api/trace/agent/proposals");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Hệ thống báo lỗi (mã ${res.status})`);
      setItems(body.proposals as Proposal[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi không xác định");
    }
  }, [apiFetch, allowed]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  async function decide(id: number, decision: "approve" | "reject") {
    setBusy(id);
    setError(null);
    try {
      const res = await apiFetch(`/api/trace/agent/proposals/${id}/decide`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, note: notes[id] ?? "" }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Hệ thống báo lỗi (mã ${res.status})`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi không xác định");
    } finally {
      setBusy(null);
    }
  }

  const pending = items?.filter((p) => p.status === "pending") ?? [];
  const done = items?.filter((p) => p.status !== "pending") ?? [];
  const pendingPaged = usePaged(pending, 5);
  const donePaged = usePaged(done, 5);
  if (!allowed) return null;
  return (
    <Card title="Đề xuất của hệ thống chờ bạn duyệt">
      <p className="text-sm text-stone-600">Khi phân tích mẻ nung hoặc mẻ nhuộm cho kết luận Cần xem lại hoặc Cảnh báo, hệ thống đề xuất một việc cần làm kèm lý do và căn cứ. Hệ thống không tự làm: chỉ khi bạn duyệt thì thông báo mới được gửi đi.</p>
      {error && (
        <p className="mt-3 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      {items && pending.length === 0 && <p className="mt-3 text-sm text-stone-500">Không có đề xuất nào đang chờ duyệt.</p>}
      <ul className="mt-3 space-y-3">
        {pendingPaged.items.map((p) => (
          <li key={p.id} className="rounded-lg border border-stone-200 p-3">
            <p className="text-sm font-semibold text-stone-900">
              <span aria-hidden="true" className={p.severity === "alert" ? "text-red-700" : "text-amber-700"}>
                {p.severity === "alert" ? "⛔ " : "⚠ "}
              </span>
              {p.title}
            </p>
            <p className="mt-1 text-sm leading-snug text-stone-700">{p.rationale}</p>
            <p className="mt-1 text-xs text-stone-500">
              Sản phẩm{" "}
              <Link href={`/trace/${p.subject}`} className="text-brand-700 hover:underline">
                {p.subject}
              </Link>{" "}
              · tạo lúc {fmtDate(p.created_at)}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor={`note-${p.id}`}>
                Ghi chú
              </label>
              <input
                id={`note-${p.id}`}
                value={notes[p.id] ?? ""}
                onChange={(e) => setNotes((n) => ({ ...n, [p.id]: e.target.value }))}
                maxLength={500}
                placeholder="Ghi chú (không bắt buộc)"
                className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              />
              <button disabled={busy === p.id} onClick={() => void decide(p.id, "approve")} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                Duyệt và gửi thông báo
              </button>
              <button disabled={busy === p.id} onClick={() => void decide(p.id, "reject")} className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-50">
                Từ chối
              </button>
            </div>
          </li>
        ))}
      </ul>
      <Pager paged={pendingPaged} noun="đề xuất" />
      {done.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs font-medium text-brand-700">Đã xử lý ({done.length})</summary>
          <ul className="mt-2 space-y-1 text-sm text-stone-600">
            {donePaged.items.map((p) => (
              <li key={p.id}>
                {statusText[p.status]} bởi {p.decided_by}: {p.title}
                {p.decision_note ? ` (${p.decision_note})` : ""}
              </li>
            ))}
          </ul>
          <Pager paged={donePaged} noun="đề xuất" />
        </details>
      )}
    </Card>
  );
}
