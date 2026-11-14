// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
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

  useEffect(() => {
    apiFetch("/api/workflow/repository/process-definitions?latest=true")
      .then(async (res) => {
        if (!res.ok) throw new Error(`Hệ thống báo lỗi (mã ${res.status})`);
        const body = await res.json();
        setItems(body.data as ProcessDefinition[]);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Lỗi không xác định"));
  }, [apiFetch]);

  const own = (items ?? []).filter((p) => p.category === DX_CATEGORY);
  const shown = own;

  return (
    <>
      <PageTitle title="Process" desc="Các bước xử lý hồ sơ và việc nào đang chờ ai làm." />
      <Card title="Quy trình đã triển khai">
        {error && <p className="text-sm text-red-600">Không tải được dữ liệu: {error}</p>}
        {!error && !items && <p className="text-sm text-stone-500">Đang tải…</p>}
        {items && shown.length === 0 && (
          <p className="text-sm text-stone-500">Chưa có quy trình nào được thiết lập.</p>
        )}
        {items && shown.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-stone-500">
              <tr>
                <th className="pb-2">Quy trình</th>
                <th className="pb-2">Phiên bản</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {shown.map((p) => (
                <tr key={p.id}>
                  <td className="py-2 text-stone-800">{p.name ?? p.key}</td>
                  <td className="py-2 text-stone-600">v{p.version}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
