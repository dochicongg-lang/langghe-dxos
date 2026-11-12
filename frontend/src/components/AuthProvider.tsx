"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { config } from "@/lib/config";
import { getKeycloak, initKeycloak } from "@/lib/keycloak";

export interface UserInfo {
  username: string;
  name: string;
  email: string;
  roles: string[];
  /** Mã HTX của người dùng (claim `coop`), rỗng nếu chưa thuộc HTX nào. */
  coop: string;
  /** Quyền hiệu lực do máy chủ tính từ config/access.json: { hành động: phạm vi }. Chỉ để ẩn/hiện giao diện; máy chủ luôn kiểm tra lại. */
  permissions: Record<string, string>;
}

/** Lấy quyền hiệu lực của người dùng từ trace-api (/api/trace/me). Lỗi thì trả null (giao diện coi như chưa có quyền ghi). */
async function fetchMe(token: string | undefined): Promise<{ coop?: string; permissions?: Record<string, string> } | null> {
  try {
    const res = await fetch(`${config.apiBaseUrl}/api/trace/me`, { headers: { Authorization: `Bearer ${token}` } });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

interface AuthState {
  user: UserInfo;
  logout: () => void;
  /** Gọi API qua APISIX, tự gắn Bearer token và làm mới token khi sắp hết hạn. */
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth phải nằm trong <AuthProvider>");
  return ctx;
}

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initKeycloak()
      .then(() => {
        const kc = getKeycloak();
        const t = kc.tokenParsed as Record<string, unknown> | undefined;
        if (!kc.authenticated || !t) return;
        const base: UserInfo = {
          username: String(t.preferred_username ?? ""),
          name: String(t.name ?? t.preferred_username ?? ""),
          email: String(t.email ?? ""),
          roles: ((t.policy as string[] | undefined) ?? []).slice(),
          coop: String(t.coop ?? ""),
          permissions: {},
        };
        // Chờ quyền hiệu lực từ máy chủ rồi mới hiển thị, để biểu mẫu không nhấp nháy ẩn/hiện
        return fetchMe(kc.token).then((me) => setUser({ ...base, coop: me?.coop ?? base.coop, permissions: me?.permissions ?? {} }));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Không kết nối được Keycloak"));
  }, []);

  const logout = useCallback(() => {
    getKeycloak().logout({ redirectUri: window.location.origin });
  }, []);

  const apiFetch = useCallback(async (path: string, init: RequestInit = {}) => {
    const kc = getKeycloak();
    await kc.updateToken(30);
    const call = () => {
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${kc.token}`);
      return fetch(`${config.apiBaseUrl}${path}`, { ...init, headers });
    };
    const res = await call();
    if (res.status !== 403) return res;
    // 403 có thể do vai trò vừa đổi: Keycloak tính lại vai trò khi làm mới token. Ép làm mới một lần,
    // cập nhật vai trò hiển thị, rồi thử lại đúng một lần.
    try {
      await kc.updateToken(-1);
    } catch {
      return res;
    }
    const roles = ((kc.tokenParsed as Record<string, unknown> | undefined)?.policy as string[] | undefined) ?? [];
    const me = await fetchMe(kc.token);
    setUser((u) => (u ? { ...u, roles: roles.slice(), coop: me?.coop ?? u.coop, permissions: me?.permissions ?? u.permissions } : u));
    return call();
  }, []);

  const value = useMemo(() => (user ? { user, logout, apiFetch } : null), [user, logout, apiFetch]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md rounded-lg border border-red-200 bg-red-50 p-6 text-red-800">
          <p className="font-semibold">Không thể đăng nhập</p>
          <p className="mt-1 text-sm">
            {error}. Kiểm tra Keycloak tại {config.keycloakUrl} đã chạy chưa.
          </p>
        </div>
      </div>
    );
  }
  if (!value) {
    return <div className="flex min-h-screen items-center justify-center text-slate-500">Đang xác thực…</div>;
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
