// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
import Image from "next/image";

/** Logo Làng Nghề Số (chữ LN kèm tên), màu đất nung, nền trong suốt. Chiều cao đặt bằng className. */
export default function Logo({ className = "h-10 w-auto" }: { className?: string }) {
  return <Image src="/logo.png" alt="Làng Nghề Số" width={900} height={613} priority className={className} />;
}
