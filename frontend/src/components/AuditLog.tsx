"use client";

import { useCallback, useEffect, useState } from "react";
import Card from "./Card";
import { useAuth } from "./AuthProvider";

interface Row {
  id: number;
  ts: string;
  actor: string | null;
  roles: string;
  verified: boolean;
  ip: string;
  method: string;
  path: string;
  status: number;
  route: string;
  latency_ms: number;
}
interface Verify {
  ok: boolean;
  rows: number;
  broken: { id: number; reason: string } | null;
}

const field =
  "rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-stone-900 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500";
const statusTone = (s: number) => (s >= 500 ? "bg-red-50 text-red-700" : s >= 400 ? "bg-amber-50 text-amber-800" : s >= 300 ? "bg-sky-50 text-sky-700" : "bg-emerald-50 text-emerald-700");
const fmt = (iso: string) => new Date(iso).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "medium" });

/** Nhật ký kiểm toán hành vi API (chỉ quản trị): ai gọi gì, khi nào, kết quả; chỉ ghi thêm, có chuỗi băm kiểm tra toàn vẹn. */
export default function AuditLog() {
  const { apiFetch } = useAuth();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verify, setVerify] = useState<Verify | null>(null);
  const [busy, setBusy] = useState(false);
  const [actor, setActor] = useState("");
  const [method, setMethod] = useState("");
  const [statusClass, setStatusClass] = useState("");
  const [q, setQ] = useState("");

  const load = useCallback(
    async (before?: number) => {
      setBusy(true);
      try {
        const p = new URLSearchParams({ limit: "50" });
        if (actor.trim()) p.set("actor", actor.trim());
        if (method) p.set("method", method);
        if (statusClass) p.set("status_class", statusClass);
        if (q.trim()) p.set("q", q.trim());
        if (before) p.set("before", String(before));
        const res = await apiFetch(`/api/trace/audit?${p}`);
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `API trả về ${res.status}`);
        setRows((prev) => (before && prev ? [...prev, ...(body.rows as Row[])] : (body.rows as Row[])));
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Lỗi không xác định");
      } finally {
        setBusy(false);
      }
    },
    [apiFetch, actor, method, statusClass, q],
  );

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
    // chỉ tải lần đầu; các lần sau do người dùng bấm "Lọc"
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function check() {
    setBusy(true);
    setVerify(null);
    try {
      const res = await apiFetch("/api/trace/audit/verify");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `API trả về ${res.status}`);
      setVerify(body as Verify);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi không xác định");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Nhật ký kiểm toán">
      <p className="text-sm text-stone-600">
        Cổng gác ghi lại từng yêu cầu: ai gọi gì, khi nào, kết quả. Không lưu token. Nhật ký chỉ được ghi thêm (cơ sở dữ liệu chặn sửa/xóa) và mỗi dòng nối băm SHA-256 với dòng trước nên mọi sửa lén đều bị phát hiện. Người dùng ở yêu cầu bị từ chối chỉ là <em>tự khai</em> vì chưa xác thực được.
      </p>

      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <label className="text-xs text-stone-500">
          Người dùng
          <input value={actor} onChange={(e) => setActor(e.target.value)} className={`${field} mt-1 block w-32`} placeholder="hoa" />
        </label>
        <label className="text-xs text-stone-500">
          Phương thức
          <select value={method} onChange={(e) => setMethod(e.target.value)} className={`${field} mt-1 block`}>
            <option value="">Tất cả</option>
            {["GET", "POST", "PUT", "DELETE"].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-stone-500">
          Kết quả
          <select value={statusClass} onChange={(e) => setStatusClass(e.target.value)} className={`${field} mt-1 block`}>
            <option value="">Tất cả</option>
            <option value="2">Thành công (2xx)</option>
            <option value="4">Bị từ chối/lỗi người dùng (4xx)</option>
            <option value="5">Lỗi máy chủ (5xx)</option>
          </select>
        </label>
        <label className="text-xs text-stone-500">
          Đường dẫn chứa
          <input value={q} onChange={(e) => setQ(e.target.value)} className={`${field} mt-1 block w-44`} placeholder="/applications" />
        </label>
        <button type="submit" disabled={busy} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
          Lọc
        </button>
        <button type="button" onClick={() => void check()} disabled={busy} className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-50">
          Kiểm tra toàn vẹn chuỗi băm
        </button>
      </form>

      {verify && (
        <p
          role="status"
          className={`mt-3 rounded-lg border px-3 py-2 text-sm ${verify.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}
        >
          {verify.ok ? `✓ Toàn vẹn: ${verify.rows} dòng nối băm liền mạch, không có dòng nào bị sửa, xóa hay chèn.` : `⛔ Phát hiện can thiệp tại dòng #${verify.broken?.id}: ${verify.broken?.reason}.`}
        </p>
      )}
      {error && (
        <p className="mt-3 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      <div className="mt-3 overflow-x-auto">
        {rows && rows.length === 0 && <p className="text-sm text-stone-500">Không có dòng nào khớp bộ lọc.</p>}
        {rows && rows.length > 0 && (
          <table className="w-full text-left text-xs">
            <thead className="text-[11px] uppercase text-stone-500">
              <tr>
                <th className="pb-2">#</th>
                <th className="pb-2">Thời điểm</th>
                <th className="pb-2">Người dùng</th>
                <th className="pb-2">Yêu cầu</th>
                <th className="pb-2">Kết quả</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-1.5 pr-2 text-stone-400">{r.id}</td>
                  <td className="whitespace-nowrap py-1.5 pr-3 text-stone-600">{fmt(r.ts)}</td>
                  <td className="py-1.5 pr-3">
                    {r.actor ? (
                      <>
                        <span className="font-medium text-stone-800">{r.actor}</span>
                        {!r.verified && <span className="ml-1 text-[11px] text-amber-700">(tự khai)</span>}
                        {r.roles && <span className="block text-[11px] text-stone-400">{r.roles.split(",").filter((x) => !x.startsWith("default-") && x !== "offline_access" && x !== "uma_authorization").join(", ")}</span>}
                      </>
                    ) : (
                      <span className="text-stone-400">ẩn danh · {r.ip}</span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3">
                    <span className="font-mono font-semibold text-stone-700">{r.method}</span> <span className="break-all font-mono text-stone-600">{r.path}</span>
                  </td>
                  <td className="whitespace-nowrap py-1.5">
                    <span className={`rounded-full px-2 py-0.5 font-semibold ${statusTone(r.status)}`}>{r.status}</span>
                    <span className="ml-1 text-[11px] text-stone-400">{r.latency_ms} ms</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {rows && rows.length >= 50 && rows.length % 50 === 0 && (
          <button onClick={() => void load(rows[rows.length - 1].id)} disabled={busy} className="mt-3 rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-50">
            Tải thêm
          </button>
        )}
      </div>
    </Card>
  );
}
