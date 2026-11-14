// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
/* eslint-disable @next/next/no-img-element */

// Ảnh MINH HỌA (chưa phải ảnh chụp riêng của từng sản phẩm). Gốm xoay vòng giữa vài ảnh theo mã để danh sách không lặp một ảnh.
const CRAFT = ["/photos/craft-1.jpg", "/photos/craft-2.jpg", "/photos/craft-3.jpg", "/photos/craft-4.jpg"];
const POTTERY = ["/photos/product-tea-set.jpg", "/photos/chapter-ngon-lua.jpg", "/photos/chapter-nguoi-lam.jpg", "/photos/chapter-hanh-trinh.jpg"];

function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

export function illustrationFor(category?: string | null, group?: string | null, seed?: string | null): string {
  const s = `${category ?? ""} ${group ?? ""}`.toLowerCase();
  if (/gốm|gom|sứ|su\b|thu-cong-my-nghe/.test(s)) return POTTERY[seed ? hash(seed) % POTTERY.length : 0];
  return CRAFT[seed ? hash(seed) % CRAFT.length : 0];
}

export default function ProductImage({ category, group, seed, className = "" }: { category?: string | null; group?: string | null; seed?: string | null; className?: string }) {
  return (
    <img
      src={illustrationFor(category, group, seed)}
      alt="Ảnh minh họa sản phẩm (không phải ảnh chụp riêng của sản phẩm này)"
      loading="lazy"
      // thiếu tệp ảnh (ảnh chụp không đi kèm kho mã) thì rơi về hình vẽ
      onError={(e) => {
        if (!e.currentTarget.src.endsWith("craft-generic.svg")) e.currentTarget.src = "/illustrations/craft-generic.svg";
      }}
      className={`object-cover ${className}`}
    />
  );
}
