"use client";

import { useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";
import type { Attachment, AttachmentRules } from "@/lib/ocop";

const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const typeLabel = (types: string[]) => types.map((t) => ({ "image/jpeg": "JPG", "image/png": "PNG", "image/webp": "WEBP", "application/pdf": "PDF" })[t] ?? t).join(", ");

/** Một tệp đã đính kèm: ảnh hiện hình thu nhỏ (tải qua API có xác thực, không có đường dẫn công khai), PDF hiện biểu tượng. */
function Item({ code, a, canEdit, onRemove, busy }: { code: string; a: Attachment; canEdit: boolean; onRemove: (a: Attachment) => void; busy: boolean }) {
  const { apiFetch } = useAuth();
  const [thumb, setThumb] = useState<string | null>(null);
  const isImage = a.content_type.startsWith("image/");
  const path = `/api/trace/applications/${encodeURIComponent(code)}/attachments/${a.id}/file`;

  useEffect(() => {
    if (!isImage) return;
    let url: string | null = null;
    let alive = true;
    apiFetch(path)
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (b && alive) {
          url = URL.createObjectURL(b);
          setThumb(url);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [apiFetch, path, isImage]);

  async function open() {
    const res = await apiFetch(path);
    if (!res.ok) return;
    const url = URL.createObjectURL(await res.blob());
    if (isImage) window.open(url, "_blank");
    else {
      const link = document.createElement("a");
      link.href = url;
      link.download = a.filename;
      link.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  return (
    <li className="flex items-center gap-2 rounded-lg border border-stone-200 bg-white p-1.5 pr-2 text-xs">
      <button type="button" onClick={() => void open()} className="flex min-w-0 items-center gap-2 text-left" aria-label={`Mở ${a.filename}`}>
        {isImage ? (
          thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt={a.filename} className="h-10 w-10 shrink-0 rounded object-cover" />
          ) : (
            <span className="h-10 w-10 shrink-0 animate-pulse rounded bg-stone-100" />
          )
        ) : (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-red-50 text-[10px] font-bold text-red-700">PDF</span>
        )}
        <span className="min-w-0">
          <span className="block max-w-[11rem] truncate font-medium text-stone-800">{a.filename}</span>
          <span className="block text-stone-500">
            {fmtSize(a.size)} · {a.uploaded_by}
          </span>
        </span>
      </button>
      {canEdit && (
        <button type="button" disabled={busy} onClick={() => onRemove(a)} className="ml-1 rounded p-1 text-stone-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50" aria-label={`Gỡ ${a.filename}`}>
          ✕
        </button>
      )}
    </li>
  );
}

/** Danh sách tệp của một giấy tờ trong danh mục, kèm nút tải lên (khi hồ sơ còn sửa được). Kiểm tra sơ bộ ở trình duyệt; máy chủ kiểm lại. */
export default function AttachmentList({ code, docKey, items, canEdit, rules, onChange }: { code: string; docKey: string; items: Attachment[]; canEdit: boolean; rules: AttachmentRules; onChange: () => void }) {
  const { apiFetch } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    setErr(null);
    setBusy(true);
    for (const f of files) {
      if (!rules.types.includes(f.type)) {
        setErr(`"${f.name}": loại tệp không được phép (chỉ ${typeLabel(rules.types)}).`);
        continue;
      }
      if (f.size > rules.maxBytes) {
        setErr(`"${f.name}" lớn ${fmtSize(f.size)}, tối đa ${fmtSize(rules.maxBytes)}.`);
        continue;
      }
      try {
        const res = await apiFetch(`/api/trace/applications/${encodeURIComponent(code)}/attachments?doc=${encodeURIComponent(docKey)}&name=${encodeURIComponent(f.name)}`, {
          method: "POST",
          headers: { "Content-Type": f.type },
          body: f,
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((body as { error?: string }).error ?? `API trả về ${res.status}`);
      } catch (ex) {
        setErr(`"${f.name}": ${ex instanceof Error ? ex.message : "Lỗi không xác định"}`);
      }
    }
    setBusy(false);
    onChange();
  }

  async function onRemove(a: Attachment) {
    if (!window.confirm(`Gỡ tệp "${a.filename}" khỏi hồ sơ?`)) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await apiFetch(`/api/trace/applications/${encodeURIComponent(code)}/attachments/${a.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `API trả về ${res.status}`);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Lỗi không xác định");
    }
    setBusy(false);
    onChange();
  }

  if (!items.length && !(canEdit && rules.enabled)) return null;
  return (
    <div className="ml-6 mt-1 mb-2">
      {items.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {items.map((a) => (
            <Item key={a.id} code={code} a={a} canEdit={canEdit} onRemove={(x) => void onRemove(x)} busy={busy} />
          ))}
        </ul>
      )}
      {canEdit && rules.enabled && (
        <label className="mt-1 inline-flex cursor-pointer items-center gap-1 rounded-lg border border-dashed border-stone-300 px-2.5 py-1 text-xs text-stone-600 focus-within:ring-2 focus-within:ring-brand-500 hover:border-brand-400 hover:text-brand-700">
          <input type="file" multiple accept={rules.types.join(",")} onChange={(e) => void onPick(e)} disabled={busy} className="sr-only" />
          {busy ? "Đang tải…" : "＋ Tải ảnh/tệp"}
          <span className="text-stone-400">({typeLabel(rules.types)}, ≤ {Math.floor(rules.maxBytes / 1024 / 1024)} MB)</span>
        </label>
      )}
      {err && (
        <p className="mt-1 text-xs text-red-600" role="alert">
          {err}
        </p>
      )}
    </div>
  );
}
