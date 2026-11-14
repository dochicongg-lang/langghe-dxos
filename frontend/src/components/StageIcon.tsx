// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors

const PATHS: Record<string, string> = {
  "nguyen-lieu": "M12 3c4 3 6 6 6 9a6 6 0 01-12 0c0-3 2-6 6-9zM12 21v-8",
  "so-che": "M4 20l8-8M14 4l6 6-4 4-6-6zM4 20h6",
  "tao-hinh": "M7 4h10l-1 4c3 2 3 8 1 12H7c-2-4-2-10 1-12zM8 8h8",
  "nung-hoan-thien": "M12 3c1 4 5 5 5 10a5 5 0 01-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z",
  "kiem-dinh": "M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6zM9 12l2 2 4-4",
  "dong-goi": "M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8M7.5 5.5l9 5",
  "nhuom-hoan-thien": "M12 3c3 4 6 7 6 11a6 6 0 01-12 0c0-4 3-7 6-11zM9 15a3 3 0 003 3",
  "phan-phoi": "M2 7h12v9H2zM14 10h4l3 3v3h-7zM6 19a2 2 0 100-4 2 2 0 000 4zM17 19a2 2 0 100-4 2 2 0 000 4z",
};

/** Biểu tượng nét đơn giản cho từng công đoạn, dùng chung ở trang tra cứu và trang chi tiết sản phẩm. */
export default function StageIcon({ stage, className = "h-5 w-5" }: { stage: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d={PATHS[stage] ?? "M12 12h.01"} />
    </svg>
  );
}
