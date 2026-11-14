// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use client";

import { useCallback, useEffect, useState } from "react";
import Card from "./Card";
import { useAuth } from "./AuthProvider";
import { fmtDate } from "@/lib/trace";

interface Lineage {
  source: string;
  rows?: number;
  sha256?: string;
  note?: string;
  tier?: string;
}
interface Dataset {
  dataset: string;
  title: string;
  latest: { id: number; rows: number; object_key: string; sha256: string; size: number; lineage: Lineage[]; created_at: string; triggered_by: string; runs: number } | null;
}
interface Overview {
  datasets: Dataset[];
  analytics: { id: string; title: string; dataset: string }[];
}
interface Result {
  title: string;
  exported: boolean;
  as_of?: string;
  rows: Record<string, string | number>[];
}

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const sourceLabel = (s: string) => (s.startsWith("postgres:") ? `bảng ${s.slice(9)} (kho đang dùng)` : s.startsWith("minio:") ? `tệp lưu trữ ${s.slice(6).split("/").pop()}` : s.startsWith("config:") ? `cấu hình ${s.slice(7)}` : s);

/** Hồ dữ liệu phân tích (chỉ quản trị): xuất bản sao dạng cột (Parquet), xem nguồn gốc dữ liệu, chạy các phân tích mẫu. */
export default function LakePanel() {
  const { apiFetch } = useAuth();
  const [ov, setOv] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/api/trace/lake");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Hệ thống báo lỗi (mã ${res.status})`);
      setOv(body as Overview);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi không xác định");
    }
  }, [apiFetch]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  async function exportNow() {
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      const res = await apiFetch("/api/trace/lake/export", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Hệ thống báo lỗi (mã ${res.status})`);
      setMsg("skipped" in body ? "Một lần xuất khác đang chạy, thử lại sau." : `Đã xuất ${body.exported.length} bộ dữ liệu.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi không xác định");
    } finally {
      setBusy(false);
    }
  }

  async function analyze(id: string) {
    setError(null);
    setResult(null);
    try {
      const res = await apiFetch(`/api/trace/lake/analytics/${id}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Hệ thống báo lỗi (mã ${res.status})`);
      setResult(body as Result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi không xác định");
    }
  }

  const cols = result?.rows[0] ? Object.keys(result.rows[0]) : [];
  return (
    <Card title="Hồ dữ liệu phân tích">
      <p className="text-sm text-stone-600">
        Bản sao dạng bảng cột (Parquet) của các dữ liệu chính, gồm cả dữ liệu đã chuyển sang kho lưu trữ, để phân tích nhanh mà không làm chậm hệ thống đang dùng. Mỗi lần xuất ghi lại dữ liệu lấy từ đâu và mã kiểm tra nguyên vẹn của tệp.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button onClick={() => void exportNow()} disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
          {busy ? "Đang xuất…" : "Xuất dữ liệu sang hồ ngay"}
        </button>
        {msg && (
          <p className="text-sm text-emerald-700" role="status">
            {msg}
          </p>
        )}
        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
      </div>

      {ov && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-stone-500">
              <tr>
                <th className="pb-2">Bộ dữ liệu</th>
                <th className="pb-2">Số dòng</th>
                <th className="pb-2">Lần xuất mới nhất</th>
                <th className="pb-2">Nguồn dữ liệu</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {ov.datasets.map((d) => (
                <tr key={d.dataset} className="align-top">
                  <td className="py-2 pr-3 font-medium text-stone-800">{d.title}</td>
                  <td className="py-2 pr-3">{d.latest ? d.latest.rows : "chưa xuất"}</td>
                  <td className="py-2 pr-3 text-xs text-stone-600">
                    {d.latest ? (
                      <>
                        {fmtDate(d.latest.created_at)} · {kb(d.latest.size)} · lần #{d.latest.id}
                        <span className="block font-mono text-stone-400" title={d.latest.sha256}>
                          mã kiểm tra {d.latest.sha256.slice(0, 10)}…
                        </span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2 text-xs text-stone-600">
                    {d.latest?.lineage.map((l, i) => (
                      <span key={i} className="block">
                        {sourceLabel(l.source)}
                        {l.rows !== undefined ? ` (${l.rows} dòng)` : ""}
                      </span>
                    )) ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {ov && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold text-stone-800">Phân tích nhanh trên hồ</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {ov.analytics.map((a) => (
              <button key={a.id} onClick={() => void analyze(a.id)} className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50">
                {a.title}
              </button>
            ))}
          </div>
          {result && (
            <div className="mt-3 rounded-lg border border-stone-200 bg-stone-50 p-3">
              <p className="mb-2 text-sm font-medium text-stone-800">{result.title}</p>
              {!result.exported ? (
                <p className="text-sm text-stone-600">Bộ dữ liệu này chưa được xuất, hãy bấm &ldquo;Xuất dữ liệu sang hồ ngay&rdquo;.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs uppercase text-stone-500">
                      <tr>
                        {cols.map((c) => (
                          <th key={c} className="pb-1 pr-4">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-200">
                      {result.rows.map((r, i) => (
                        <tr key={i}>
                          {cols.map((c) => (
                            <td key={c} className="py-1 pr-4 text-stone-800">
                              {String(r[c])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {result.as_of && <p className="mt-2 text-xs text-stone-500">Số liệu tính trên bản xuất lúc {fmtDate(result.as_of)}.</p>}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
