// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { stageLabels } from "./trace";

export interface SectorStage {
  key: string;
  label: string;
}
export interface Sector {
  key: string;
  label: string;
  intelligence: string | null; // "kiln" = có phân tích mẻ nung; null = chưa có phân tích riêng
  ocopGroup?: string | null; // nhóm sản phẩm OCOP của ngành
  stages: SectorStage[];
}

let cache: Sector[] | null = null;

/** Danh sách ngành nghề và chuỗi công đoạn của từng ngành (nguồn: máy chủ, từ config/sectors.json). */
export function useSectors(): Sector[] | null {
  const { apiFetch } = useAuth();
  const [sectors, setSectors] = useState<Sector[] | null>(cache);
  useEffect(() => {
    if (cache) return;
    let alive = true;
    apiFetch("/api/trace/sectors")
      .then(async (res) => {
        if (!res.ok) return;
        const body = (await res.json()) as { sectors: Sector[] };
        cache = body.sectors;
        if (alive) setSectors(body.sectors);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [apiFetch]);
  return sectors;
}

/** Tên công đoạn theo ngành; chưa tải được cấu hình thì dùng tên chung. */
export function stageLabelOf(sectors: Sector[] | null, sector: string | undefined, stage: string): string {
  const hit = sectors?.find((s) => s.key === sector)?.stages.find((st) => st.key === stage);
  return hit?.label ?? stageLabels[stage] ?? stage;
}
