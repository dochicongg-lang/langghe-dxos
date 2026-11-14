// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
import type { UserInfo } from "@/components/AuthProvider";

/**
 * Người dùng có được thấy trang này không (theo quyền hiệu lực và danh sách trang do máy chủ tính từ config/access.json).
 * Chỉ để ẩn menu và chặn vào nhầm; dữ liệu thật vẫn do cổng gác và API kiểm tra.
 */
export function canSee(user: Pick<UserInfo, "permissions" | "pages">, pathname: string): boolean {
  const first = "/" + (pathname.split("/").filter(Boolean)[0] ?? "");
  switch (first) {
    case "/trace":
      return Boolean(user.permissions["product.read"]);
    case "/ocop":
      return Boolean(user.permissions["application.read"]);
    case "/process":
    case "/data":
    case "/intelligence":
      return user.pages.includes(first.slice(1));
    case "/tong-quan":
      return user.pages.includes("overview");
    case "/nen-tang":
      return user.pages.includes("platform");
    default:
      return true; // trang chủ, tài khoản, trợ giúp, trợ lý
  }
}
