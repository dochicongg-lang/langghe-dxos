"use client";

import { useEffect, useState } from "react";
import Card, { PageTitle } from "@/components/Card";
import { useAuth } from "@/components/AuthProvider";

interface ProcessDefinition {
  id: string;
  key: string;
  name: string | null;
  version: number;
  deploymentId: string;
  category: string | null;
}

/** Quy trình nghiệp vụ của hệ thống đặt category này (targetNamespace="dxos" trong BPMN). Các quy trình mẫu của image Flowable thuộc category khác. */
const DX_CATEGORY = "dxos";

export default function ProcessPage() {
  const { apiFetch } = useAuth();
  const [items, setItems] = useState<ProcessDefinition[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSamples, setShowSamples] = useState(false);

  useEffect(() => {
    apiFetch("/api/workflow/repository/process-definitions?latest=true")
      .then(async (res) => {
        if (!res.ok) throw new Error(`API trả về ${res.status}`);
        const body = await res.json();
        setItems(body.data as ProcessDefinition[]);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Lỗi không xác định"));
  }, [apiFetch]);

  const own = (items ?? []).filter((p) => p.category === DX_CATEGORY);
  const samples = (items ?? []).filter((p) => p.category !== DX_CATEGORY);
  const shown = showSamples ? (items ?? []) : own;

  return (
    <>
      <PageTitle title="Process" desc="Quy trình nghiệp vụ chạy trên Flowable, gọi qua API Gateway bằng JWT." />
      <Card title="Quy trình đã triển khai">
        {error && <p className="text-sm text-red-600">Không tải được dữ liệu: {error}</p>}
        {!error && !items && <p className="text-sm text-stone-500">Đang tải…</p>}
        {items && shown.length === 0 && (
          <p className="text-sm text-stone-500">
            Chưa có quy trình nghiệp vụ nào của hệ thống.
            {samples.length > 0 && !showSamples && " Các quy trình mẫu của Flowable đang được ẩn."}
          </p>
        )}
        {items && samples.length > 0 && (
          <button
            type="button"
            onClick={() => setShowSamples((v) => !v)}
            className="mb-3 rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50"
          >
            {showSamples ? "Ẩn" : "Hiện"} {samples.length} quy trình mẫu của Flowable
          </button>
        )}
        {items && shown.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-stone-500">
              <tr>
                <th className="pb-2">Key</th>
                <th className="pb-2">Tên</th>
                <th className="pb-2">Phiên bản</th>
                <th className="pb-2">Loại</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {shown.map((p) => (
                <tr key={p.id}>
                  <td className="py-2 font-mono text-stone-700">{p.key}</td>
                  <td className="py-2 text-stone-800">{p.name ?? "—"}</td>
                  <td className="py-2 text-stone-600">v{p.version}</td>
                  <td className="py-2 text-stone-500">{p.category === DX_CATEGORY ? "hệ thống" : "mẫu Flowable"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
