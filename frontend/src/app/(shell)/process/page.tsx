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
}

export default function ProcessPage() {
  const { apiFetch } = useAuth();
  const [items, setItems] = useState<ProcessDefinition[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/workflow/repository/process-definitions?latest=true")
      .then(async (res) => {
        if (!res.ok) throw new Error(`API trả về ${res.status}`);
        const body = await res.json();
        setItems(body.data as ProcessDefinition[]);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Lỗi không xác định"));
  }, [apiFetch]);

  return (
    <>
      <PageTitle title="Process" desc="Quy trình nghiệp vụ chạy trên Flowable, gọi qua API Gateway bằng JWT." />
      <Card title="Quy trình đã triển khai">
        {error && <p className="text-sm text-red-600">Không tải được dữ liệu: {error}</p>}
        {!error && !items && <p className="text-sm text-slate-500">Đang tải…</p>}
        {items && items.length === 0 && <p className="text-sm text-slate-500">Chưa có quy trình nào.</p>}
        {items && items.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="pb-2">Key</th>
                <th className="pb-2">Tên</th>
                <th className="pb-2">Phiên bản</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((p) => (
                <tr key={p.id}>
                  <td className="py-2 font-mono text-slate-700">{p.key}</td>
                  <td className="py-2 text-slate-800">{p.name ?? "—"}</td>
                  <td className="py-2 text-slate-600">v{p.version}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
