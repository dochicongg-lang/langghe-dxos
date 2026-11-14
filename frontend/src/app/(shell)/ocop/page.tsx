// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import Card, { PageTitle } from "@/components/Card";
import { useAuth } from "@/components/AuthProvider";
import EmptyState from "@/components/EmptyState";
import Pager, { usePaged } from "@/components/Pager";
import SuggestInput, { uniqueSuggestions } from "@/components/SuggestInput";
import Photo from "@/components/Photo";
import ProductImage from "@/components/ProductImage";
import { useSectors } from "@/lib/sectors";
import { fmtDate, type ProductSummary } from "@/lib/trace";
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
  const [pickedGroup, setGroup] = useState("thu-cong-my-nghe");
  const [score, setScore] = useState<Record<string, string>>({ A: "", B: "", C: "" });
  const [docs, setDocs] = useState<string[]>([]);
  const [showForm, setShowForm] = useState(false);
  const sectors = useSectors();
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [pname, setPname] = useState("");
  const [pcode, setPcode] = useState("");
  const [desc, setDesc] = useState("");
  const [made, setMade] = useState<{ code: string; name: string }[]>([]); // hồ sơ vừa lập trong lúc "lập tiếp"
  const again = useRef(false);
  // Tệp dùng chung: chọn một lần cho từng giấy tờ, tự tải lên MỌI hồ sơ tạo trong lần này (ví dụ giấy phép kinh doanh giống nhau cho mọi sản phẩm)
  const [files, setFiles] = useState<Record<string, File[]>>({});
  const [pastDescs, setPastDescs] = useState<string[]>([]);
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        setPastDescs(JSON.parse(localStorage.getItem("dxos.ocop.descs") ?? "[]"));
      } catch {
        setPastDescs([]);
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);
  const ALLOWED = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
  const MAX_BYTES = 5 * 1024 * 1024;
  function pickFiles(key: string, list: FileList | null) {
    const ok: File[] = [];
    const bad: string[] = [];
    for (const f of Array.from(list ?? [])) {
      if (ALLOWED.includes(f.type) && f.size <= MAX_BYTES) ok.push(f);
      else bad.push(f.name);
    }
    if (bad.length) setFormError(`Bỏ qua tệp không hợp lệ (chỉ JPG, PNG, WEBP, PDF; tối đa 5 MB): ${bad.join(", ")}`);
    if (ok.length) setFiles((m) => ({ ...m, [key]: [...(m[key] ?? []), ...ok] }));
  }
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");

  // Từ trang chủ bấm "Lập hồ sơ mới" thì mở sẵn biểu mẫu
  useEffect(() => {
    const t = setTimeout(() => {
      if (new URLSearchParams(window.location.search).get("new") === "1") setShowForm(true);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const load = useCallback(async () => {
    try {
      const [a, p, pr] = await Promise.all([apiFetch("/api/trace/applications"), apiFetch("/api/trace/applications/profile"), apiFetch("/api/trace/products").catch(() => null)]);
      if (pr && pr.ok) setProducts(((await pr.json()) as { products: ProductSummary[] }).products);
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

  // Chỉ cho chọn nhóm sản phẩm thuộc các ngành của nền tảng (gốm, lụa đều là hàng thủ công mỹ nghệ), không liệt kê thực phẩm, đồ uống... không liên quan
  const sectorGroups = [...new Set((sectors ?? []).map((s) => s.ocopGroup).filter((g): g is string => Boolean(g)))];
  const groups = profile ? (sectorGroups.length ? profile.groups.filter((g) => sectorGroups.includes(g.key)) : profile.groups) : [];
  // Chỉ có một nhóm thì dùng luôn, không hỏi người dùng
  const group = groups.length === 1 ? groups[0].key : pickedGroup;
  const checklist = profile?.checklist.filter((c) => (!c.onlyGroups || c.onlyGroups.includes(group)) && !(c.exceptGroups && c.exceptGroups.includes(group))) ?? [];
  const parts = profile?.scoring.parts ?? [];
  const allFilled = parts.length > 0 && parts.every((p) => score[p.key] !== "" && !Number.isNaN(Number(score[p.key])));
  const total = allFilled ? parts.reduce((s, p) => s + Number(score[p.key]), 0) : null;
  const expectedStars = profile && total !== null ? starsForScore(profile, total) : null;

  async function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = { product_name: pname, description: desc, product_code: pcode };
    const keepGoing = again.current;
    again.current = false;
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
      // tải các tệp dùng chung lên hồ sơ vừa tạo
      const failed: string[] = [];
      for (const [key, list] of Object.entries(files)) {
        if (!docs.includes(key)) continue;
        for (const f of list) {
          const up = await apiFetch(`/api/trace/applications/${encodeURIComponent(body.code)}/attachments?doc=${encodeURIComponent(key)}&name=${encodeURIComponent(f.name)}`, { method: "POST", headers: { "Content-Type": f.type }, body: f });
          if (!up.ok) failed.push(f.name);
        }
      }
      if (failed.length) setFormError(`Hồ sơ đã tạo nhưng chưa tải được: ${failed.join(", ")}. Bạn tải lại ở trang hồ sơ.`);
      if (data.description.trim()) {
        try {
          const next = [data.description.trim(), ...pastDescs.filter((d) => d !== data.description.trim())].slice(0, 8);
          localStorage.setItem("dxos.ocop.descs", JSON.stringify(next));
          setPastDescs(next);
        } catch {
          // không lưu được thì thôi
        }
      }
      if (keepGoing) {
        // Lập tiếp hồ sơ cho mẫu khác: giữ mô tả, điểm tự chấm, giấy tờ; chỉ xóa tên và mã sản phẩm
        setMade((m) => [{ code: body.code, name: data.product_name }, ...m]);
        setPname("");
        setPcode("");
        void load();
      } else {
        router.push(`/ocop/${encodeURIComponent(body.code)}`);
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Lỗi không xác định");
    } finally {
      setSaving(false);
    }
  }

  const group_of = (s: string) => (s === "draft" ? "draft" : ["in_review", "awaiting_result"].includes(s) ? "review" : s === "needs_revision" ? "todo" : "done");
  const chips = [
    ["all", "Tất cả"],
    ["todo", "Cần xử lý"],
    ["draft", "Nháp"],
    ["review", "Đang duyệt"],
    ["done", "Đã có kết quả"],
  ];
  const countOf = (k: string) => (apps ?? []).filter((a) => k === "all" || group_of(a.state) === k).length;
  const shown = (apps ?? []).filter((a) => (filter === "all" || group_of(a.state) === filter) && `${a.product_name} ${a.code}`.toLowerCase().includes(q.trim().toLowerCase()));
  const paged = usePaged(shown, 10, `${filter}|${q}`);
  const nameSug = uniqueSuggestions([...products.map((p) => p.name), ...(apps ?? []).map((a) => a.product_name)]);
  const codeSug = products.map((p) => ({ value: p.code, hint: p.name }));
  const groupLabel = (key?: string) => profile?.groups.find((g) => g.key === key)?.label;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-4">
        <PageTitle flush title="Hồ sơ OCOP" desc="Lập hồ sơ, HTX sơ duyệt, rồi theo dõi kết quả. Kết quả chính thức do cơ quan có thẩm quyền quyết định." />
        <Photo src="/illustrations/ocop.svg" className="order-last hidden h-24 w-44 shrink-0 rounded-xl object-cover md:block" />
        {canCreate && (
          <button onClick={() => setShowForm((v) => !v)} className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">
            {showForm ? "Đóng biểu mẫu" : "+ Lập hồ sơ mới"}
          </button>
        )}
      </div>
      {profile && <p className="-mt-3 mb-4 text-xs text-stone-500">Quy định áp dụng: {profile.name}</p>}

      <div className="space-y-4">
        {showForm && (
          <Card title="Lập hồ sơ mới">
            {!profile ? <p className="text-sm text-stone-500">Đang tải cấu hình…</p> : (
              <form onSubmit={onCreate} className="space-y-3">
                            <label className="block text-sm">
                              <span className="mb-1 block text-stone-600">Tên sản phẩm *</span>
                              <SuggestInput name="product_name" items={nameSug} value={pname} onChange={setPname} required maxLength={200} className={inputCls} placeholder="Bình gốm men rạn" />
                            </label>
                            {groups.length > 1 && (
                            <label className="block text-sm">
                              <span className="mb-1 block text-stone-600">Nhóm sản phẩm *</span>
                                <select value={group} onChange={(e) => setGroup(e.target.value)} className={inputCls}>
                                  {groups.map((g) => (
                                    <option key={g.key} value={g.key}>
                                      {g.label}
                                    </option>
                                  ))}
                                </select>
                            </label>
                            )}
                            <label className="block text-sm">
                              <span className="mb-1 block text-stone-600">Mã truy xuất liên quan (nếu có)</span>
                              <SuggestInput name="product_code" items={codeSug} value={pcode} onChange={setPcode} onPick={(s) => { if (!pname.trim() && s.hint) setPname(s.hint); }} maxLength={40} className={inputCls} placeholder="GOM-BT-0001" />
                            </label>
                            <label className="block text-sm">
                              <span className="mb-1 block text-stone-600">Mô tả</span>
                              <textarea name="description" value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} maxLength={2000} className={inputCls} />
                              {pastDescs.filter((d) => d !== desc).length > 0 && (
                                <span className="mt-1.5 block text-xs text-stone-500">
                                  Dùng lại mô tả đã nhập trên máy này:
                                  <span className="mt-1 flex flex-wrap gap-1.5">
                                    {pastDescs.filter((d) => d !== desc).slice(0, 4).map((d) => (
                                      <button key={d} type="button" onClick={() => setDesc(d)} className="max-w-full truncate rounded-full border border-stone-300 px-2.5 py-1 text-left text-stone-700 hover:bg-stone-100" title={d}>
                                        {d.length > 48 ? d.slice(0, 48) + "…" : d}
                                      </button>
                                    ))}
                                  </span>
                                </span>
                              )}
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
                              <p className="mb-2 text-xs text-stone-500">Tích những giấy tờ bạn đang có. Với giấy tờ đã tích, bấm «Chọn tệp» để đính kèm ngay (tệp được gắn vào mọi hồ sơ tạo trong lần này, tiện cho giấy phép dùng chung); hoặc tải sau ở trang hồ sơ.</p>
                              <div className="space-y-1">
                                {checklist.map((c) => (
                                  <div key={c.key}>
                                  <label className="flex items-start gap-2 text-sm text-stone-700">
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
                                  {docs.includes(c.key) && (
                                    <div className="mb-1 ml-6 text-xs text-stone-500">
                                      <label className="cursor-pointer rounded-md border border-stone-300 px-2 py-1 text-stone-700 hover:bg-stone-100">
                                        Chọn tệp
                                        <input type="file" multiple accept={ALLOWED.join(",")} className="sr-only" onChange={(e) => { pickFiles(c.key, e.target.files); e.target.value = ""; }} />
                                      </label>
                                      {(files[c.key] ?? []).map((f, i) => (
                                        <span key={f.name + i} className="ml-2 inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5">
                                          {f.name}
                                          <button type="button" aria-label={`Bỏ ${f.name}`} onClick={() => setFiles((m) => ({ ...m, [c.key]: (m[c.key] ?? []).filter((_, j) => j !== i) }))}>✕</button>
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                  </div>
                                ))}
                              </div>
                            </fieldset>
                            {made.length > 0 && (
                              <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
                                Đã tạo {made.length} hồ sơ nháp trong lần này:{" "}
                                {made.map((m, i) => (
                                  <span key={m.code}>
                                    {i > 0 && ", "}
                                    <Link href={`/ocop/${encodeURIComponent(m.code)}`} className="font-medium underline">{m.name}</Link>
                                  </span>
                                ))}
                                . Mô tả, điểm tự chấm và giấy tờ được giữ lại cho mẫu tiếp theo; chỉ cần nhập tên (và mã) mẫu khác.
                              </div>
                            )}
                            {formError && <p className="text-sm text-red-600">{formError}</p>}
                            <button type="submit" disabled={saving} className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                              {saving ? "Đang lưu…" : "Tạo hồ sơ nháp"}
                            </button>
                            <button type="submit" disabled={saving} onClick={() => { again.current = true; }} className="w-full rounded-lg border border-brand-600 px-4 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50">
                              Tạo và lập tiếp hồ sơ cho mẫu khác
                            </button>
                          </form>
            )}
          </Card>
        )}

        <Card>
          {error && <p className="text-sm text-red-600">Không tải được dữ liệu: {error}</p>}
          {!error && !apps && <p className="text-sm text-stone-500">Đang tải…</p>}
          {apps && apps.length === 0 && (
            <EmptyState
              title="Chưa có hồ sơ nào"
              hint={canCreate ? "Bấm \"+ Lập hồ sơ mới\" ở trên: chọn nhóm sản phẩm, tự chấm điểm dự kiến và đánh dấu giấy tờ đã có." : "Hồ sơ của hợp tác xã hoặc đang chờ bạn xử lý sẽ hiện ở đây."}
            />
          )}
          {apps && apps.length > 0 && (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2" role="tablist" aria-label="Lọc hồ sơ">
                  {chips.map(([k, label]) => (
                    <button
                      key={k}
                      role="tab"
                      aria-selected={filter === k}
                      onClick={() => setFilter(k)}
                      className={`rounded-full px-3.5 py-1.5 text-sm transition ${filter === k ? "bg-brand-600 font-semibold text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"}`}
                    >
                      {label} <span className="opacity-70">{countOf(k)}</span>
                    </button>
                  ))}
                </div>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo tên hoặc mã" aria-label="Tìm hồ sơ" className={`${inputCls} max-w-xs`} />
              </div>
              {shown.length === 0 ? (
                <p className="py-6 text-center text-sm text-stone-500">Không có hồ sơ nào khớp. Thử bỏ bớt bộ lọc.</p>
              ) : (
                <ul className="divide-y divide-stone-100">
                  {paged.items.map((a) => (
                    <li key={a.code}>
                      <Link href={`/ocop/${encodeURIComponent(a.code)}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 hover:bg-stone-50">
                        <ProductImage group={a.product_group} seed={a.code} className="h-14 w-20 shrink-0 rounded-lg border border-stone-200" />
                        <span className="min-w-[11rem] flex-1">
                          <span className="block break-words text-sm font-semibold text-stone-900">{a.product_name}</span>
                          <span className="mt-0.5 block break-words text-xs leading-relaxed text-stone-500">
                            <span className="font-mono">{a.code}</span>
                            {groupLabel(a.product_group) ? ` · ${groupLabel(a.product_group)}` : ""} · {a.owner} · cập nhật {fmtDate(a.updated_at)}
                          </span>
                        </span>
                        <span className="ml-auto flex shrink-0 flex-col items-end gap-1 max-sm:w-full max-sm:flex-row max-sm:items-center max-sm:justify-between">
                          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${stateTone[a.state] ?? ""}`}>{stateLabels[a.state] ?? a.state}</span>
                          {a.stars ? <span className="text-amber-500">{"★".repeat(a.stars)}</span> : null}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <Pager paged={paged} noun="hồ sơ" />
            </>
          )}
        </Card>
      </div>
    </>
  );
}
