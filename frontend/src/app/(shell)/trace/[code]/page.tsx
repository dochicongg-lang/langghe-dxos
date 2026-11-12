"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import Card, { PageTitle } from "@/components/Card";
import { useAuth } from "@/components/AuthProvider";
import KilnEvidence from "@/components/KilnEvidence";
import QrCode from "@/components/QrCode";
import { config } from "@/lib/config";
import { fmtDate, stageLabels, stageOrder, type ProductDetail } from "@/lib/trace";

const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500";

function Product() {
  const { code } = useParams<{ code: string }>();
  const { apiFetch, user } = useAuth();
  const canWrite = user.roles.includes("editor");
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [stage, setStage] = useState("");
  const [origin, setOrigin] = useState(config.publicBaseUrl);

  useEffect(() => {
    if (config.publicBaseUrl) return;
    const t = setTimeout(() => setOrigin(window.location.origin), 0);
    return () => clearTimeout(t);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/trace/products/${encodeURIComponent(code)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `API trả về ${res.status}`);
      setProduct(body as ProductDetail);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi không xác định");
    }
  }, [apiFetch, code]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  async function onAddEvent(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
    const { iotDevice, iotFrom, iotTo, ...fields } = data;
    setSaving(true);
    setFormError(null);
    try {
      let iot: { deviceId: string; from: string; to: string } | undefined;
      if (fields.stage === "nung-hoan-thien" && (iotFrom || iotTo)) {
        const fromMs = Date.parse(iotFrom);
        const toMs = Date.parse(iotTo);
        if (Number.isNaN(fromMs) || Number.isNaN(toMs)) throw new Error("Cần nhập cả thời điểm bắt đầu và kết thúc nung.");
        if (toMs <= fromMs) throw new Error("Thời điểm kết thúc phải sau thời điểm bắt đầu.");
        // Chỉ gửi thiết bị và khoảng thời gian; máy chủ tự đọc số liệu từ MinIO và tính tóm tắt.
        iot = { deviceId: (iotDevice || "kiln-01").trim(), from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() };
      }
      const res = await apiFetch(`/api/trace/products/${encodeURIComponent(code)}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...fields, iot }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `API trả về ${res.status}`);
      setProduct(body as ProductDetail);
      form.reset();
      setStage("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Lỗi không xác định");
    } finally {
      setSaving(false);
    }
  }

  if (error) {
    return (
      <>
        <Link href="/trace" className="text-sm text-indigo-600 hover:underline">
          ← Quay lại danh sách
        </Link>
        <p className="mt-4 text-sm text-red-600">{error}</p>
      </>
    );
  }
  if (!product) return <p className="text-sm text-slate-500">Đang tải…</p>;

  const done = new Set(product.events.map((e) => e.stage));
  const publicPath = `/verify/${encodeURIComponent(product.code)}`;

  return (
    <>
      <Link href="/trace" className="text-sm text-indigo-600 hover:underline">
        ← Quay lại danh sách
      </Link>
      <div className="mt-3">
        <PageTitle title={product.name} desc={`Mã ${product.code} · ${product.category || "Chưa phân loại"}`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Tiến trình công đoạn">
            <ol className="flex flex-wrap gap-2">
              {stageOrder.map((s) => (
                <li
                  key={s}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    done.has(s) ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-400"
                  }`}
                >
                  {done.has(s) ? "✓ " : ""}
                  {stageLabels[s]}
                </li>
              ))}
            </ol>
          </Card>

          <Card title="Dòng thời gian">
            {product.events.length === 0 ? (
              <p className="text-sm text-slate-500">Chưa có công đoạn nào được ghi nhận.</p>
            ) : (
              <ol className="relative ml-2 border-l-2 border-slate-200">
                {product.events.map((ev, i) => (
                  <li key={i} className="mb-5 ml-5 last:mb-0">
                    <span className="absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-indigo-500" />
                    <p className="text-sm font-semibold text-slate-800">{stageLabels[ev.stage] ?? ev.stage}</p>
                    <p className="text-xs text-slate-500">
                      {fmtDate(ev.created_at)}
                      {ev.location ? ` · ${ev.location}` : ""}
                      {ev.actor ? ` · ghi bởi ${ev.actor}` : ""}
                    </p>
                    {ev.note && <p className="mt-1 text-sm text-slate-600">{ev.note}</p>}
                    {ev.iot && <KilnEvidence iot={ev.iot} />}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Thông tin">
            <dl className="divide-y divide-slate-100 text-sm">
              {[
                ["Làng nghề", product.village || "—"],
                ["Nghệ nhân / cơ sở", product.artisan || "—"],
                ["Tạo lúc", fmtDate(product.created_at)],
                ["Tạo bởi", product.created_by ?? "—"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 py-2">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="text-right font-medium text-slate-800">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-xs text-slate-500">Trang tra cứu công khai cho người mua (không cần đăng nhập):</p>
            <Link href={publicPath} target="_blank" className="break-all text-sm text-indigo-600 hover:underline">
              {publicPath}
            </Link>
          </Card>

          <Card title="Mã QR tra cứu nguồn gốc">
            {origin ? (
              <>
                <QrCode url={`${origin}${publicPath}`} filename={`qr-${product.code}`} />
                <p className="mt-3 text-xs text-slate-500">
                  In và dán lên sản phẩm: người mua quét để xem hành trình và dữ liệu nung, không cần đăng nhập.
                </p>
                {/localhost|127\.0\.0\.1/.test(origin) && (
                  <p className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
                    Đang dùng địa chỉ máy bạn nên điện thoại chưa quét được. Khi triển khai, đặt NEXT_PUBLIC_PUBLIC_BASE_URL thành tên miền thật.
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-slate-500">Đang tạo mã…</p>
            )}
          </Card>

          <Card title="Thêm công đoạn">
            {!canWrite ? (
              <p className="text-sm text-slate-500">Tài khoản của bạn chỉ có quyền xem.</p>
            ) : (
              <form onSubmit={onAddEvent} className="space-y-3">
                <label className="block text-sm">
                  <span className="mb-1 block text-slate-600">Công đoạn *</span>
                  <select name="stage" required className={inputCls} value={stage} onChange={(e) => setStage(e.target.value)}>
                    <option value="" disabled>
                      Chọn công đoạn…
                    </option>
                    {stageOrder.map((s) => (
                      <option key={s} value={s}>
                        {stageLabels[s]}
                      </option>
                    ))}
                  </select>
                </label>
                {stage === "nung-hoan-thien" && (
                  <fieldset className="space-y-3 rounded-lg border border-indigo-200 bg-indigo-50/50 p-3">
                    <legend className="px-1 text-xs font-medium text-indigo-700">Gắn dữ liệu cảm biến lò (tùy chọn)</legend>
                    <label className="block text-sm">
                      <span className="mb-1 block text-slate-600">Mã thiết bị</span>
                      <input name="iotDevice" maxLength={60} defaultValue="kiln-01" className={inputCls} />
                    </label>
                    <label className="block text-sm">
                      <span className="mb-1 block text-slate-600">Bắt đầu nung</span>
                      <input name="iotFrom" type="datetime-local" className={inputCls} />
                    </label>
                    <label className="block text-sm">
                      <span className="mb-1 block text-slate-600">Kết thúc nung</span>
                      <input name="iotTo" type="datetime-local" className={inputCls} />
                    </label>
                    <p className="text-xs text-slate-500">
                      Máy chủ tự đọc nhiệt độ lò trong khoảng này từ MinIO và đính kèm đường cong nhiệt đã đối chiếu. Bỏ trống nếu không cần.
                    </p>
                  </fieldset>
                )}
                <label className="block text-sm">
                  <span className="mb-1 block text-slate-600">Địa điểm</span>
                  <input name="location" maxLength={200} className={inputCls} placeholder="Xưởng tạo hình" />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-slate-600">Ghi chú</span>
                  <textarea name="note" maxLength={1000} rows={3} className={inputCls} />
                </label>
                {formError && <p className="text-sm text-red-600">{formError}</p>}
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? "Đang lưu…" : "Ghi nhận công đoạn"}
                </button>
              </form>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

export default function ProductPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Đang tải…</p>}>
      <Product />
    </Suspense>
  );
}
