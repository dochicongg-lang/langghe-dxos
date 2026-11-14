// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use client";

import { useCallback, useEffect, useState } from "react";
import Card, { PageTitle } from "@/components/Card";
import { useAuth } from "@/components/AuthProvider";
import AuditLog from "@/components/AuditLog";
import LakePanel from "@/components/LakePanel";
import { fmtDate } from "@/lib/trace";

interface ArchiveRun {
  id: number;
  source_table: string;
  cutoff: string;
  row_count: number;
  object_key: string;
  sha256: string;
  size: number;
  triggered_by: string;
  created_at: string;
}
interface ArchiveOverview {
  policy: { keep_days: number; interval_hours: number; enabled: boolean; source: string };
  runs: ArchiveRun[];
}

const inputCls =
  "w-28 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500";

function Tier({ label, tone, title, children }: { label: string; tone: string; title: string; children: React.ReactNode }) {
  return (
    <li className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${tone}`}>{label}</span>
      <h3 className="mt-2 text-sm font-semibold text-stone-900">{title}</h3>
      <p className="mt-1 text-sm text-stone-600">{children}</p>
    </li>
  );
}

export default function DataPage() {
  const { user, apiFetch } = useAuth();
  const canManage = Boolean(user.permissions["archive.manage"]);
  const canAudit = Boolean(user.permissions["audit.read"]);
  const [overview, setOverview] = useState<ArchiveOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [keepDays, setKeepDays] = useState("");
  const [rows, setRows] = useState<{ id: number; data: unknown[]; total: number } | null>(null);

  const load = useCallback(async () => {
    if (!canManage) return;
    try {
      const res = await apiFetch("/api/trace/archive");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Hệ thống báo lỗi (mã ${res.status})`);
      setOverview(body as ArchiveOverview);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi không xác định");
    }
  }, [apiFetch, canManage]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  async function run() {
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      const payload = keepDays.trim() === "" ? {} : { keep_days: Number(keepDays) };
      const res = await apiFetch("/api/trace/archive/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Hệ thống báo lỗi (mã ${res.status})`);
      setOverview({ policy: body.policy, runs: body.runs });
      const r = body.result as { rows: number; applications: number } | { skipped: string } | null;
      setMsg(!r ? "Không có bản ghi nào đủ điều kiện lưu trữ." : "skipped" in r ? "Một tiến trình lưu trữ khác đang chạy, thử lại sau." : `Đã chuyển ${r.rows} bản ghi của ${r.applications} hồ sơ sang kho lưu trữ.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi không xác định");
    } finally {
      setBusy(false);
    }
  }

  async function view(id: number) {
    setError(null);
    try {
      const res = await apiFetch(`/api/trace/archive/${id}/rows`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Hệ thống báo lỗi (mã ${res.status})`);
      setRows({ id, data: body.rows as unknown[], total: body.total as number });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi không xác định");
    }
  }

  return (
    <>
      <PageTitle title="Data" desc="Dữ liệu được lưu ở đâu, giữ bao lâu và được bảo vệ thế nào." />

      <section aria-labelledby="tiers">
        <h2 id="tiers" className="mb-3 text-base font-semibold text-stone-800">
          Vòng đời dữ liệu
        </h2>
        <ol className="grid gap-3 md:grid-cols-3">
          <Tier label="Đang dùng" tone="bg-orange-50 text-orange-700" title="Kho đang dùng · PostgreSQL">
            Dữ liệu xử lý hằng ngày: sản phẩm, hồ sơ và lịch sử gần đây. Mở ra rất nhanh.
          </Tier>
          <Tier label="Lưu trữ" tone="bg-sky-50 text-sky-700" title="Kho lưu trữ lâu dài · MinIO">
            Lịch sử của hồ sơ đã kết thúc và quá hạn được nén gọn, gắn mã kiểm tra nguyên vẹn rồi chuyển khỏi kho đang dùng, để hệ thống luôn nhanh mà vẫn tra cứu lại được.
          </Tier>
          <Tier label="Khóa" tone="bg-emerald-50 text-emerald-700" title="Kho khóa chống sửa · MinIO">
            Số liệu cảm biến chỉ ghi được một lần và bị khóa trong thời hạn giữ. Nếu có ai ghi đè hay xóa, hệ thống phát hiện và báo ngay.
          </Tier>
        </ol>
      </section>

      {canManage && (
        <div className="mt-6">
          <Card title="Chuyển dữ liệu cũ sang kho lưu trữ">
            {error && (
              <p className="mb-3 text-sm text-red-600" role="alert">
                {error}
              </p>
            )}
            {overview && (
              <>
                <p className="text-sm text-stone-600">
                  Quy định hiện tại: lịch sử của hồ sơ đã kết thúc được giữ <strong>{overview.policy.keep_days} ngày</strong> ở kho đang dùng, sau đó mới chuyển đi. {overview.policy.interval_hours > 0 ? `Hệ thống tự kiểm tra mỗi ${overview.policy.interval_hours} giờ.` : "Hệ thống chỉ chuyển khi bạn bấm nút."}
                </p>
                <div className="mt-3 flex flex-wrap items-end gap-3">
                  <label className="text-xs text-stone-500">
                    Giữ ở kho đang dùng (ngày)
                    <input type="number" min={0} max={3650} value={keepDays} onChange={(e) => setKeepDays(e.target.value)} placeholder={String(overview.policy.keep_days)} className={`${inputCls} mt-1 block`} />
                  </label>
                  <button onClick={() => void run()} disabled={busy || !overview.policy.enabled} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                    {busy ? "Đang lưu trữ…" : "Chạy lưu trữ ngay"}
                  </button>
                  {msg && (
                    <p className="text-sm text-emerald-700" role="status">
                      {msg}
                    </p>
                  )}
                </div>
                <div className="mt-4 overflow-x-auto">
                  {overview.runs.length === 0 ? (
                    <p className="text-sm text-stone-500">Chưa có lần lưu trữ nào.</p>
                  ) : (
                    <table className="w-full text-left text-sm">
                      <thead className="text-xs uppercase text-stone-500">
                        <tr>
                          <th className="pb-2">Lần</th>
                          <th className="pb-2">Thời điểm</th>
                          <th className="pb-2">Bản ghi</th>
                          <th className="pb-2">Tệp trong kho lưu trữ</th>
                          <th className="pb-2">Mã kiểm tra</th>
                          <th className="pb-2" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100">
                        {overview.runs.map((r) => (
                          <tr key={r.id}>
                            <td className="py-2 pr-3">#{r.id}</td>
                            <td className="py-2 pr-3 text-stone-600">
                              {fmtDate(r.created_at)} · {r.triggered_by}
                            </td>
                            <td className="py-2 pr-3">{r.row_count}</td>
                            <td className="max-w-xs truncate py-2 pr-3 font-mono text-xs text-stone-600" title={r.object_key}>
                              {r.object_key}
                            </td>
                            <td className="py-2 pr-3 font-mono text-xs text-stone-500">{r.sha256.slice(0, 10)}…</td>
                            <td className="py-2">
                              <button onClick={() => void view(r.id)} className="text-xs font-medium text-brand-700 hover:underline">
                                Xem nội dung
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
                {rows && (
                  <div className="mt-4 rounded-lg border border-stone-200 bg-stone-50 p-3">
                    <p className="mb-2 text-xs text-stone-500">
                      Lần #{rows.id}: đọc lại từ kho lưu trữ (đã kiểm tra nguyên vẹn), hiện {rows.data.length}/{rows.total} dòng.
                    </p>
                    <pre className="max-h-64 overflow-auto text-xs text-stone-700">{rows.data.map((r) => JSON.stringify(r)).join("\n")}</pre>
                  </div>
                )}
              </>
            )}
          </Card>
        </div>
      )}
      {canManage && (
        <div className="mt-6">
          <LakePanel />
        </div>
      )}
      {canAudit && (
        <div className="mt-6">
          <AuditLog />
        </div>
      )}
    </>
  );
}
