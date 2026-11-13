"use client";

import { create } from "qrcode";
import { useMemo, useState } from "react";

const QUIET = 4; // vùng trắng xung quanh theo chuẩn QR (4 ô)

/** Dựng mã QR thành một đường vẽ SVG duy nhất (không dùng innerHTML). */
function buildQr(text: string) {
  const { modules } = create(text, { errorCorrectionLevel: "M" });
  const n = modules.size;
  let d = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (modules.get(r, c)) d += `M${c + QUIET} ${r + QUIET}h1v1h-1z`;
    }
  }
  return { size: n + QUIET * 2, d };
}

/** Mã QR dẫn tới trang tra cứu công khai, kèm nút tải về (SVG, dùng in nhãn) và sao chép liên kết. */
export default function QrCode({ url, filename }: { url: string; filename: string }) {
  const qr = useMemo(() => buildQr(url), [url]);
  const [copied, setCopied] = useState(false);

  function download() {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${qr.size} ${qr.size}" width="512" height="512" shape-rendering="crispEdges">` +
      `<rect width="100%" height="100%" fill="#fff"/><path d="${qr.d}" fill="#000"/></svg>`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    a.download = `${filename}.svg`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // trình duyệt chặn clipboard: người dùng vẫn có thể chép liên kết hiển thị bên dưới
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <svg
        viewBox={`0 0 ${qr.size} ${qr.size}`}
        className="h-44 w-44 rounded-lg border border-stone-200 bg-white"
        shapeRendering="crispEdges"
        role="img"
        aria-label={`Mã QR dẫn tới ${url}`}
      >
        <rect width="100%" height="100%" fill="#fff" />
        <path d={qr.d} fill="#000" />
      </svg>
      <p className="break-all text-center text-xs text-stone-500">{url}</p>
      <div className="flex gap-2">
        <button type="button" onClick={download} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700">
          Tải mã QR (SVG)
        </button>
        <button type="button" onClick={copy} className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50">
          {copied ? "Đã chép" : "Chép liên kết"}
        </button>
      </div>
    </div>
  );
}
