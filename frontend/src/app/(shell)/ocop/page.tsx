// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import Card, { PageTitle } from "@/components/Card";
import { useAuth } from "@/components/AuthProvider";
import EmptyState from "@/components/EmptyState";
import { fmtDate } from "@/lib/trace";
import { stateLabels, stateTone, starsForScore, type OcopProfile, type OcopSummary } from "@/lib/ocop";

const inputCls =
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500";

export default function OcopPage() {
  const { apiFetch, user } = useAuth();
  const router = useRouter();
  const canCreate = Boolean(user.permissions["application.create"]);
  const [apps, setApps] = useState<OcopSummary[] | null>(null);
  const [profile, setProfile] = useState<OcopProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [group, setGroup] = useState("thu-cong-my-nghe");
  const [score, setScore] = useState<Record<string, string>>({ A: "", B: "", C: "" });
  const [docs, setDocs] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const [a, p] = await Promise.all([apiFetch("/api/trace/applications"), apiFetch("/api/trace/applications/profile")]);
      if (!a.ok) throw new Error(`Hệ thống báo lỗi (mã ${a.status})`);
      setApps(((await a.json()) as { applications: OcopSummary[] }).applications);
      if (p.ok) setProfile((await p.json()) as OcopProfile);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi không xác định");
    }
  }, [apiFetch]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const checklist = profile?.checklist.filter((c) => (!c.onlyGroups || c.onlyGroups.includes(group)) && !(c.exceptGroups && c.exceptGroups.includes(group))) ?? [];
  const parts = profile?.scoring.parts ?? [];
  const allFilled = parts.length > 0 && parts.every((p) => score[p.key] !== "" && !Number.isNaN(Number(score[p.key])));
  const total = allFilled ? parts.reduce((s, p) => s + Number(score[p.key]), 0) : null;
  const expectedStars = profile && total !== null ? starsForScore(profile, total) : null;

  async function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const self_score = allFilled ? Object.fromEntries(parts.map((p) => [p.key, Number(score[p.key])])) : undefined;
    setSaving(true);
    setFormError(null);
    try {
      const res = await apiFetch("/api/trace/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_name: data.product_name, product_group: group, description: data.description, product_code: data.product_code, self_score, documents: docs }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Hệ thống báo lỗi (mã ${res.status})`);
      router.push(`/ocop/${encodeURIComponent(body.code)}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Lỗi không xác định");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageTitle title="Hồ sơ OCOP" desc="Hỗ trợ lập hồ sơ, sơ duyệt tại HTX và theo dõi kết quả. Kết quả chính thức do cơ quan có thẩm quyền quyết định." />
      {profile && <p className="mb-4 text-sm text-stone-600">Quy định áp dụng: {profile.name}</p>}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Card title="Hồ sơ">
            {error && <p className="text-sm text-red-600">Không tải được dữ liệu: {error}</p>}
            {!error && !apps && <p className="text-sm text-stone-500">Đang tải…</p>}
            {apps && apps.length === 0 && (
              <EmptyState
                title="Chưa có hồ sơ nào"
                hint={canCreate ? "Lập hồ sơ đầu tiên ở khung bên cạnh: chọn nhóm sản phẩm, tự chấm điểm dự kiến và đánh dấu giấy tờ đã có." : "Hồ sơ của hợp tác xã hoặc đang chờ bạn xử lý sẽ hiện ở đây."}
              />
            )}
            {apps && apps.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase text-stone-500">
                    <tr>
                      <th className="pb-2">Mã</th>
                      <th className="pb-2">Sản phẩm</th>
                      <th className="pb-2">Người nộp</th>
                      <th className="pb-2">Trạng thái</th>
                      <th className="pb-2">Cập nhật</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {apps.map((a) => (
                      <tr key={a.code} className="hover:bg-stone-50">
                        <td className="py-2 pr-3 font-mono">
                          <Link href={`/ocop/${encodeURIComponent(a.code)}`} className="text-brand-600 hover:underline">
                            {a.code}
                          </Link>
                        </td>
                        <td className="py-2 pr-3 text-stone-800">{a.product_name}</td>
                        <td className="py-2 pr-3 text-stone-600">{a.owner}</td>
                        <td className="py-2 pr-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${stateTone[a.state] ?? ""}`}>{stateLabels[a.state] ?? a.state}</span>
                          {a.stars ? <span className="ml-2 text-amber-500">{"★".repeat(a.stars)}</span> : null}
                        </td>
                        <td className="py-2 text-stone-500">{fmtDate(a.updated_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <Card title="Lập hồ sơ mới">
          {!canCreate ? (
            <p className="text-sm text-stone-500">Vai trò của bạn không lập hồ sơ OCOP.</p>
          ) : !profile ? (
            <p className="text-sm text-stone-500">Đang tải cấu hình…</p>
          ) : (
            <form onSubmit={onCreate} className="space-y-3">
              <label className="block text-sm">
                <span className="mb-1 block text-stone-600">Tên sản phẩm *</span>
                <input name="product_name" required maxLength={200} className={inputCls} placeholder="Bình gốm men rạn" />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-stone-600">Nhóm sản phẩm *</span>
                <select value={group} onChange={(e) => setGroup(e.target.value)} className={inputCls}>
                  {profile.groups.map((g) => (
                    <option key={g.key} value={g.key}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-stone-600">Mã truy xuất liên quan (nếu có)</span>
                <input name="product_code" maxLength={40} className={inputCls} placeholder="GOM-BT-0001" />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-stone-600">Mô tả</span>
                <textarea name="description" rows={2} maxLength={2000} className={inputCls} />
              </label>
              <fieldset className="rounded-lg border border-stone-200 p-3">
                <legend className="px-1 text-sm text-stone-600">Tự chấm điểm (dự kiến)</legend>
                <div className="grid grid-cols-3 gap-2">
                  {parts.map((p) => (
                    <label key={p.key} className="block text-xs text-stone-500" title={p.label}>
                      {p.key} (tối đa {p.max})
                      <input
                        type="number"
                        min={0}
                        max={p.max}
                        step="0.5"
                        value={score[p.key]}
                        onChange={(e) => setScore((s) => ({ ...s, [p.key]: e.target.value }))}
                        className={inputCls}
                      />
                    </label>
                  ))}
                </div>
                {total !== null && (
                  <p className="mt-2 text-sm text-stone-700">
                    Tổng {total} điểm → hạng dự kiến {expectedStars ? "★".repeat(expectedStars) : "ngoài khoảng"}
                  </p>
                )}
              </fieldset>
              <fieldset className="rounded-lg border border-stone-200 p-3">
                <legend className="px-1 text-sm text-stone-600">Giấy tờ đã có</legend>
                <div className="space-y-1">
                  {checklist.map((c) => (
                    <label key={c.key} className="flex items-start gap-2 text-sm text-stone-700">
                      <input
                        type="checkbox"
                        checked={docs.includes(c.key)}
                        onChange={(e) => setDocs((d) => (e.target.checked ? [...d, c.key] : d.filter((k) => k !== c.key)))}
                        className="mt-1"
                      />
                      <span>
                        {c.label} {c.required && <span className="text-red-500">*</span>}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {formError && <p className="text-sm text-red-600">{formError}</p>}
              <button type="submit" disabled={saving} className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                {saving ? "Đang lưu…" : "Tạo hồ sơ nháp"}
              </button>
            </form>
          )}
        </Card>
      </div>
    </>
  );
}
