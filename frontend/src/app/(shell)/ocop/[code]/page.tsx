// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import Card, { PageTitle } from "@/components/Card";
import { useAuth } from "@/components/AuthProvider";
import AttachmentList from "@/components/AttachmentList";
import { fmtDate } from "@/lib/trace";
import { actionLabels, stateLabels, stateTone, type OcopDetail } from "@/lib/ocop";

const inputCls =
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500";

// Ba chặng của quy trình hỗ trợ (khớp BPMN dxos-ocop-support).
const steps = [
  { key: "submit", label: "Người nộp lập và gửi hồ sơ", states: ["draft", "needs_revision"] },
  { key: "review", label: "HTX sơ duyệt", states: ["in_review"] },
  { key: "result", label: "Cơ quan có thẩm quyền: kết quả chính thức", states: ["awaiting_result"] },
];
const doneStates = ["recognized", "not_recognized", "rejected"];

function Application() {
  const { code } = useParams<{ code: string }>();
  const { apiFetch } = useAuth();
  const [app, setApp] = useState<OcopDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [docs, setDocs] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/trace/applications/${encodeURIComponent(code)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Hệ thống báo lỗi (mã ${res.status})`);
      setApp(body as OcopDetail);
      setDocs((body as OcopDetail).documents);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi không xác định");
    }
  }, [apiFetch, code]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  async function send(path: string, method: string, payload: unknown) {
    setBusy(true);
    setFormError(null);
    try {
      const res = await apiFetch(`/api/trace/applications/${encodeURIComponent(code)}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Hệ thống báo lỗi (mã ${res.status})`);
      setApp(body as OcopDetail);
      setDocs((body as OcopDetail).documents);
      setNote("");
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Lỗi không xác định");
    } finally {
      setBusy(false);
    }
  }

  async function onResult(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    await send("/actions", "POST", { action: "result", score: Number(d.score), decision_no: d.decision_no, decided_at: d.decided_at, authority: d.authority });
  }

  if (error)
    return (
      <>
        <Link href="/ocop" className="text-sm text-brand-600 hover:underline">
          ← Hồ sơ OCOP
        </Link>
        <p className="mt-4 text-sm text-red-600">Không tải được hồ sơ: {error}</p>
      </>
    );
  if (!app) return <p className="text-sm text-stone-500">Đang tải…</p>;

  const currentStep = steps.findIndex((s) => s.states.includes(app.state));
  const reviewActions = app.actions.filter((a) => ["approve", "revise", "reject"].includes(a));

  return (
    <>
      <Link href="/ocop" className="text-sm text-brand-600 hover:underline">
        ← Hồ sơ OCOP
      </Link>
      <div className="mt-2">
        <PageTitle title={app.product_name} desc={`Hồ sơ ${app.code} · người nộp ${app.owner}${app.coop ? ` · HTX ${app.coop}` : ""}`} />
      </div>
      <p className="mb-4 rounded-lg border border-stone-200 bg-stone-50 px-4 py-2 text-sm text-stone-600">{app.disclaimer}</p>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Quy trình">
            <p className="mb-3">
              <span className={`rounded-full px-3 py-1 text-sm font-medium ${stateTone[app.state] ?? ""}`}>{stateLabels[app.state] ?? app.state}</span>
              {app.open_task && <span className="ml-3 text-xs text-stone-500">Bước hiện tại: {app.open_task.name}</span>}
            </p>
            <ol className="flex flex-col gap-2 sm:flex-row">
              {steps.map((s, i) => {
                const done = doneStates.includes(app.state) ? app.state !== "rejected" || i === 0 : i < currentStep;
                const active = i === currentStep;
                return (
                  <li key={s.key} className={`flex-1 rounded-lg border px-3 py-2 text-sm ${active ? "border-brand-400 bg-brand-50 text-brand-800" : done ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-stone-200 text-stone-500"}`}>
                    <span className="mr-1 font-bold">{i + 1}.</span>
                    {s.label}
                  </li>
                );
              })}
            </ol>
          </Card>

          {app.result && (
            <Card title="Kết quả OCOP chính thức">
              <p className="text-2xl text-amber-500">{"★".repeat(app.result.stars)}</p>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm text-stone-800">
                <dt className="text-stone-500">Điểm</dt>
                <dd>{app.result.score}</dd>
                <dt className="text-stone-500">Quyết định</dt>
                <dd>
                  {app.result.decision_no} ({app.result.decided_at})
                </dd>
                <dt className="text-stone-500">Cơ quan</dt>
                <dd>{app.result.authority}</dd>
                <dt className="text-stone-500">Hiệu lực đến</dt>
                <dd>{app.result.valid_until ?? "—"}</dd>
                <dt className="text-stone-500">Người nhập</dt>
                <dd>{app.result.recorded_by}</dd>
              </dl>
            </Card>
          )}

          <Card title="Giấy tờ và tự chấm điểm">
            {app.expected ? (
              <p className="mb-3 text-sm text-stone-700">
                Tự chấm: {Object.entries(app.expected.parts).map(([k, v]) => `${k}=${v}`).join(", ")} → tổng {app.expected.total} điểm, hạng dự kiến{" "}
                {app.expected.stars ? "★".repeat(app.expected.stars) : "ngoài khoảng"}.
              </p>
            ) : (
              <p className="mb-3 text-sm text-amber-700">Chưa tự chấm điểm.</p>
            )}
            <div className="space-y-1">
              {app.checklist.map((c) => (
                <div key={c.key}>
                  <label className="flex items-start gap-2 text-sm text-stone-700">
                    <input
                      type="checkbox"
                      disabled={!app.can_update}
                      checked={docs.includes(c.key)}
                      onChange={(e) => setDocs((d) => (e.target.checked ? [...d, c.key] : d.filter((k) => k !== c.key)))}
                      className="mt-1"
                    />
                    <span>
                      {c.label} {c.required && <span className="text-red-500">*</span>}
                    </span>
                  </label>
                  <AttachmentList
                    code={app.code}
                    docKey={c.key}
                    items={app.attachments.filter((a) => a.doc_key === c.key)}
                    canEdit={app.can_update}
                    rules={app.attachment_rules}
                    onChange={() => void load()}
                  />
                </div>
              ))}
            </div>
            {app.can_update && (
              <button disabled={busy} onClick={() => void send("", "PUT", { documents: docs })} className="mt-3 rounded-lg border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-50 disabled:opacity-50">
                Lưu danh mục giấy tờ
              </button>
            )}
            {app.missing_documents.length > 0 && app.state !== "recognized" && <p className="mt-2 text-xs text-amber-700">Còn thiếu giấy tờ bắt buộc: {app.missing_documents.length}</p>}
          </Card>
        </div>

        <div className="space-y-4">
          {app.actions.length > 0 && (
            <Card title="Thao tác của bạn">
              {formError && <p className="mb-2 text-sm text-red-600">{formError}</p>}
              {app.actions.includes("submit") && (
                <button disabled={busy} onClick={() => void send("/actions", "POST", { action: "submit" })} className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                  {actionLabels.submit}
                </button>
              )}
              {reviewActions.length > 0 && (
                <div className="space-y-2">
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} placeholder="Lý do (bắt buộc khi yêu cầu bổ sung hoặc không đạt)" className={inputCls} />
                  <div className="flex flex-wrap gap-2">
                    {reviewActions.map((a) => (
                      <button key={a} disabled={busy} onClick={() => void send("/actions", "POST", { action: a, note })} className={`rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${a === "approve" ? "bg-emerald-600 hover:bg-emerald-700" : a === "revise" ? "bg-orange-500 hover:bg-orange-600" : "bg-red-600 hover:bg-red-700"}`}>
                        {actionLabels[a]}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {app.actions.includes("result") && (
                <form onSubmit={onResult} className="space-y-2">
                  <p className="text-xs text-stone-500">Nhập theo quyết định của cơ quan có thẩm quyền. Hạng sao và hiệu lực tính từ cấu hình.</p>
                  <input name="score" type="number" min={0} max={100} step="0.01" required placeholder="Điểm chính thức" className={inputCls} />
                  <input name="decision_no" required maxLength={100} placeholder="Số quyết định" className={inputCls} />
                  <input name="decided_at" type="date" required className={inputCls} />
                  <input name="authority" maxLength={300} placeholder="Cơ quan ra quyết định (để trống = theo cấu hình)" className={inputCls} />
                  <button disabled={busy} className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                    {actionLabels.result}
                  </button>
                </form>
              )}
            </Card>
          )}
          <Card title="Lịch sử xử lý">
            <ol className="space-y-3 border-l border-stone-200 pl-4">
              {app.history.map((h, i) => (
                <li key={i} className="text-sm">
                  <p className="font-medium text-stone-800">
                    {h.action === "create" ? "Tạo hồ sơ" : (actionLabels[h.action] ?? h.action)} <span className="font-normal text-stone-500">· {h.actor}</span>
                  </p>
                  <p className="text-xs text-stone-500">
                    {fmtDate(h.created_at)} → {stateLabels[h.to_state] ?? h.to_state}
                  </p>
                  {h.note && <p className="mt-1 text-stone-600">{h.note}</p>}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}

export default function ApplicationPage() {
  return (
    <Suspense fallback={<p className="text-sm text-stone-500">Đang tải…</p>}>
      <Application />
    </Suspense>
  );
}
