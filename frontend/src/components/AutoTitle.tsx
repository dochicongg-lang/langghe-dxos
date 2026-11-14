// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use client";

import { useEffect } from "react";

/** Nút chỉ có biểu tượng đã có aria-label (cho trình đọc màn hình): gắn thêm title để người dùng rê chuột cũng thấy chú giải. */
export default function AutoTitle() {
  useEffect(() => {
    const apply = () => {
      document.querySelectorAll<HTMLElement>("button[aria-label], a[aria-label]").forEach((el) => {
        const t = el.getAttribute("aria-label");
        if (t && !el.hasAttribute("title") && !el.hasAttribute("data-no-title")) el.setAttribute("title", t);
      });
    };
    apply();
    const mo = new MutationObserver(apply);
    mo.observe(document.body, { subtree: true, childList: true });
    return () => mo.disconnect();
  }, []);
  return null;
}
