// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use client";

import Card, { PageTitle } from "@/components/Card";
import { useAuth } from "@/components/AuthProvider";

export default function HumanPage() {
  const { user } = useAuth();
  const rows: [string, string][] = [
    ["Tên đăng nhập", user.username],
    ["Họ tên", user.name],
    ["Email", user.email || "—"],
  ];
  return (
    <>
      <PageTitle title="Human" desc="Danh tính người dùng, xác thực một lần (SSO) qua Keycloak." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Hồ sơ">
          <dl className="divide-y divide-stone-100 text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between py-2">
                <dt className="text-stone-500">{k}</dt>
                <dd className="font-medium text-stone-800">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card title="HTX và quyền hiệu lực">
          <p className="mb-2 text-sm text-stone-600">
            Hợp tác xã: <span className="font-medium text-stone-800">{user.coop || "chưa thuộc HTX nào"}</span>
          </p>
          {Object.keys(user.permissions).length ? (
            <ul className="space-y-1 text-sm">
              {Object.entries(user.permissions).map(([action, scope]) => (
                <li key={action} className="flex justify-between">
                  <span className="font-mono text-stone-600">{action}</span>
                  <span className="font-medium text-stone-800">{{ all: "mọi tài nguyên", coop: "cùng HTX", own: "của mình", self: "tạo cho mình" }[scope] ?? scope}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-stone-500">Chưa có quyền nghiệp vụ nào.</p>
          )}
        </Card>
        <Card title="Quyền (policy)">
          {user.roles.length ? (
            <ul className="flex flex-wrap gap-2">
              {user.roles.map((r) => (
                <li key={r} className="rounded-full bg-brand-50 px-3 py-1 text-sm font-medium text-brand-700">
                  {r}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-stone-500">Chưa có quyền nào được gán.</p>
          )}
        </Card>
      </div>
    </>
  );
}
