// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
import { config } from "./config";

export interface ContactChannel {
  key: "phone" | "zalo" | "facebook" | "email";
  label: string;
  value: string; // chữ hiển thị
  href: string;
  external: boolean;
}

/** Chuẩn hóa một đường dẫn mạng xã hội: chỉ nhận http(s), tránh chèn đường dẫn lạ vào liên kết. */
function safeUrl(v: string): string | null {
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Các kênh liên hệ do đơn vị vận hành cấu hình. Kênh nào để trống thì không hiện; không bịa số liên hệ. */
export function contactChannels(): ContactChannel[] {
  const out: ContactChannel[] = [];
  const phone = config.supportPhone.trim();
  if (phone) out.push({ key: "phone", label: "Gọi điện", value: phone, href: `tel:${phone.replace(/[^\d+]/g, "")}`, external: false });
  const zalo = config.supportZalo.trim();
  if (zalo) {
    const href = /^[\d\s+.-]+$/.test(zalo) ? `https://zalo.me/${zalo.replace(/\D/g, "")}` : safeUrl(zalo);
    if (href) out.push({ key: "zalo", label: "Nhắn Zalo", value: /^[\d\s+.-]+$/.test(zalo) ? zalo : "Trang Zalo", href, external: true });
  }
  const fb = safeUrl(config.supportFacebook.trim());
  if (fb) out.push({ key: "facebook", label: "Facebook", value: "Trang Facebook", href: fb, external: true });
  const email = config.supportEmail.trim();
  if (email) out.push({ key: "email", label: "Email", value: email, href: `mailto:${email}`, external: false });
  return out;
}

export const supportHours = config.supportHours;
