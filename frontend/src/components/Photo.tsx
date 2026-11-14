// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use client";
/* eslint-disable @next/next/no-img-element */

/** Ảnh trang trí: thiếu tệp ảnh (ảnh không đi kèm kho mã) thì tự ẩn, hoặc ẩn cả khung `figure` chứa nó. */
export default function Photo({ src, alt = "", className = "", hideFigure = false }: { src: string; alt?: string; className?: string; hideFigure?: boolean }) {
  return (
    <img
      src={src}
      alt={alt}
      aria-hidden={alt ? undefined : true}
      loading="lazy"
      onError={(e) => {
        if (hideFigure) e.currentTarget.closest("figure")?.setAttribute("hidden", "");
        else e.currentTarget.style.display = "none";
      }}
      className={className}
    />
  );
}
