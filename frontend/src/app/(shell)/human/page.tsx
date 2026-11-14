// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use client";

import Card, { PageTitle } from "@/components/Card";
import { useAuth } from "@/components/AuthProvider";
import { groupedAbilities, roleDescriptions } from "@/lib/labels";
import { roleLabels } from "@/lib/roles";

export default function HumanPage() {
  const { user } = useAuth();
  const rows: [string, string][] = [
    ["Tên đăng nhập", user.username],
    ["Họ tên", user.name],
    ["Email", user.email || "—"],
    ["Hợp tác xã", user.coop || "chưa thuộc hợp tác xã nào"],
  ];
  // mỗi vai trò hiện một lần dù có nhiều tên kỹ thuật cùng nhãn (admin và editor)
  const roleCards = [...new Map(user.roles.filter((r) => roleLabels[r]).map((r) => [roleLabels[r], r])).entries()];
  const abilities = groupedAbilities(user.permissions);

  return (
    <>
      <PageTitle title="Human" desc="Bạn là ai trong hệ thống và bạn được làm những việc gì. Đăng nhập một lần là dùng được mọi trang." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Tài khoản của bạn">
          <dl className="divide-y divide-stone-100 text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 py-2">
                <dt className="text-stone-500">{k}</dt>
                <dd className="text-right font-medium text-stone-800">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card title="Vai trò của bạn">
          {roleCards.length ? (
            <ul className="space-y-3">
              {roleCards.map(([label, key]) => (
                <li key={label} className="rounded-lg bg-brand-50 p-3">
                  <p className="text-sm font-semibold text-brand-800">{label}</p>
                  <p className="mt-0.5 text-sm text-stone-700">{roleDescriptions[key]}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-stone-600">Tài khoản của bạn chưa được giao vai trò nào. Hãy liên hệ người quản trị hoặc cán bộ hợp tác xã để được cấp quyền.</p>
          )}
        </Card>

        <div className="lg:col-span-2">
          <Card title="Bạn có thể làm gì">
            {abilities.length ? (
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {abilities.map((g) => (
                  <div key={g.title}>
                    <h3 className="text-sm font-semibold text-stone-800">{g.title}</h3>
                    <ul className="mt-2 space-y-2 text-sm">
                      {g.items.map((i) => (
                        <li key={i.text} className="flex gap-2">
                          <span aria-hidden="true" className="mt-0.5 text-emerald-600">
                            ✓
                          </span>
                          <span className="text-stone-700">
                            {i.text} <span className="text-stone-500">({i.scope})</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-stone-600">Bạn chưa được cấp việc nào trong hệ thống.</p>
            )}
            <p className="mt-4 text-xs text-stone-500">Việc nào không có trong danh sách nghĩa là bạn chưa được phép làm. Cần thêm quyền, hãy nhờ người quản trị.</p>

            {user.permissions["audit.read"] && (
            <details className="mt-4 rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs text-stone-600">
              <summary className="cursor-pointer font-medium text-stone-700">Chi tiết kỹ thuật (dành cho người quản trị)</summary>
              <p className="mt-2">
                Vai trò (cũng là tên policy ở kho dữ liệu): <span className="font-mono">{user.roles.filter((r) => roleLabels[r]).join(", ") || "—"}</span>
              </p>
              <ul className="mt-2 space-y-0.5">
                {Object.entries(user.permissions).map(([code, scope]) => (
                  <li key={code} className="font-mono">
                    {code} = {scope}
                  </li>
                ))}
              </ul>
            </details>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
