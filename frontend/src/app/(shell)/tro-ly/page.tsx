// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use client";

import { PageTitle } from "@/components/Card";
import AssistantPanel from "@/components/AssistantPanel";

/** Trợ lý hỏi đáp dành cho mọi người dùng: hỏi về hạng sao, giấy tờ, hạn xử lý; câu trả lời kèm nguồn. */
export default function AssistantPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle title="Hỏi trợ lý" desc="Hỏi bằng câu thường ngày, ví dụ “hồ sơ OCOP cần giấy tờ gì”. Câu trả lời luôn kèm nguồn; nếu không tìm thấy, trợ lý sẽ nói thẳng là không biết." />
      <AssistantPanel />
    </div>
  );
}
