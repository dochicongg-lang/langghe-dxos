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
  /** Trang nền tảng được thấy theo vai trò (process, data, intelligence); chỉ để ẩn/hiện giao diện. */
  pages: string[];
}

/** Lấy quyền hiệu lực của người dùng từ trace-api (/api/trace/me). Lỗi thì trả null (giao diện coi như chưa có quyền ghi). */
async function fetchMe(token: string | undefined): Promise<{ coop?: string; permissions?: Record<string, string>; pages?: string[] } | null> {
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
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    initKeycloak()
      .then(() => {
        const kc = getKeycloak();
        const t = kc.tokenParsed as Record<string, unknown> | undefined;
        if (!kc.authenticated || !t) return;
        // Token hết hạn: thử làm mới ngầm; phiên Keycloak đã hết (nghỉ lâu, bị đăng xuất nơi khác) thì báo người dùng đăng nhập lại
        kc.onTokenExpired = () => {
          kc.updateToken(30).catch(() => setExpired(true));
        };
        kc.onAuthRefreshError = () => setExpired(true);
        const base: UserInfo = {
          username: String(t.preferred_username ?? ""),
          name: String(t.name ?? t.preferred_username ?? ""),
          email: String(t.email ?? ""),
          roles: ((t.policy as string[] | undefined) ?? []).slice(),
          coop: String(t.coop ?? ""),
          permissions: {},
          pages: [],
        };
        // Chờ quyền hiệu lực từ máy chủ rồi mới hiển thị, để biểu mẫu không nhấp nháy ẩn/hiện
        return fetchMe(kc.token).then((me) => setUser({ ...base, coop: me?.coop ?? base.coop, permissions: me?.permissions ?? {}, pages: me?.pages ?? [] }));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Không kết nối được Keycloak"));
  }, []);

  const logout = useCallback(() => {
    getKeycloak().logout({ redirectUri: window.location.origin });
  }, []);

  const apiFetch = useCallback(async (path: string, init: RequestInit = {}) => {
    const kc = getKeycloak();
    try {
      await kc.updateToken(30);
    } catch {
      setExpired(true);
      throw new Error("Phiên đăng nhập đã hết hạn");
    }
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
    setUser((u) => (u ? { ...u, roles: roles.slice(), coop: me?.coop ?? u.coop, permissions: me?.permissions ?? u.permissions, pages: me?.pages ?? u.pages } : u));
    return call();
  }, []);

  const value = useMemo(() => (user ? { user, logout, apiFetch } : null), [user, logout, apiFetch]);

  if (error) {
    return (
      <Screen>
        <p className="text-lg font-semibold text-stone-900">Không thể kết nối hệ thống đăng nhập</p>
        <p className="mt-2 text-sm text-stone-600">
          {error}. Kiểm tra Keycloak tại {config.keycloakUrl} đã chạy chưa, rồi thử lại.
        </p>
        <button onClick={() => window.location.reload()} className="mt-5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
          Thử lại
        </button>
      </Screen>
    );
  }
  if (expired) {
    return (
      <Screen>
        <p className="text-lg font-semibold text-stone-900">Phiên đăng nhập đã hết hạn</p>
        <p className="mt-2 text-sm text-stone-600">Vì lý do an toàn, bạn cần đăng nhập lại. Nội dung chưa lưu trên màn hình này có thể mất.</p>
        <button onClick={() => void getKeycloak().login()} className="mt-5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
          Đăng nhập lại
        </button>
      </Screen>
    );
  }
  if (!value) {
    return (
      <Screen>
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" aria-hidden="true" />
        <p className="mt-4 text-sm text-stone-500" role="status">
          Đang xác thực…
        </p>
      </Screen>
    );
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Màn hình giữa trang dùng cho trạng thái đang tải, lỗi, hết phiên. */
function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-8 text-center shadow-sm">
        <span className="mx-auto mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 font-bold text-white">DX</span>
        {children}
      </div>
    </div>
  );
}
