// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
import type { ReactNode } from "react";

/** Trạng thái trống: nói rõ vì sao chưa có gì và gợi ý bước tiếp theo, thay vì chỉ một dòng "chưa có". */
export default function EmptyState({ title, hint, children }: { title: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50/60 px-5 py-8 text-center">
      <p className="text-sm font-semibold text-stone-800">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-md text-sm text-stone-600">{hint}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
