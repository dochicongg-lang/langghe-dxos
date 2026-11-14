// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
// Nút chỉ có biểu tượng (đăng nhập lại từ đầu, hiện/ẩn mật khẩu) đã có aria-label nhưng chưa có chú giải khi rê chuột: gắn title từ aria-label.
(function () {
  function label(root) {
    root.querySelectorAll("button[aria-label], a[aria-label]").forEach(function (el) {
      var t = el.getAttribute("aria-label");
      if (t && el.getAttribute("title") !== t) el.setAttribute("title", t);
    });
  }
  function start() {
    label(document);
    // nút hiện/ẩn mật khẩu đổi aria-label mỗi lần bấm
    new MutationObserver(function () { label(document); }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["aria-label"], childList: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
