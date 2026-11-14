// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use client";

import Link from "next/link";
import { PageTitle } from "@/components/Card";
import StageIcon from "@/components/StageIcon";
import { useSectors, type Sector } from "@/lib/sectors";

function Chain({ sector }: { sector: Sector }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-1.5 text-xs">
      {sector.stages.map((st, i) => (
        <li key={st.key} className="flex items-center gap-1">
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-brand-800">
            <StageIcon stage={st.key} className="h-3 w-3" />
            {st.label}
          </span>
          {i < sector.stages.length - 1 && <span aria-hidden="true" className="text-stone-300">›</span>}
        </li>
      ))}
    </ol>
  );
}

function Cell({ title, children, tone = "bg-white" }: { title: string; children: React.ReactNode; tone?: string }) {
  return (
    <div className={`rounded-xl border border-stone-200 p-4 ${tone}`}>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">{title}</p>
      <div className="text-sm leading-relaxed text-stone-700">{children}</div>
    </div>
  );
}

function Tag({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return <span className={`mb-1.5 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${ok ? "bg-emerald-50 text-emerald-700" : "bg-stone-100 text-stone-600"}`}>{children}</span>;
}

export default function PlatformPage() {
  const sectors = useSectors();
  const gom = sectors?.find((s) => s.key === "gom");
  const lua = sectors?.find((s) => s.key === "lua");

  const tiers = [
    {
      letter: "H",
      title: "Human: con người và vai trò",
      common: "Một lần đăng nhập cho mọi trang. Mỗi người có vai trò (người sản xuất, cán bộ hợp tác xã, cán bộ OCOP, người xem) và chỉ thấy, chỉ làm đúng việc của mình, theo từng hợp tác xã.",
      a: "Nghệ nhân gốm lập sản phẩm và hồ sơ của mình; cán bộ hợp tác xã sơ duyệt.",
      b: "Hợp tác xã lụa dùng đúng các vai trò đó, không cần thiết lập lại.",
      link: { href: "/human", label: "Xem tài khoản và quyền của tôi" },
    },
    {
      letter: "P",
      title: "Process: quy trình xử lý",
      common: "Hồ sơ OCOP đi qua ba chặng: người sản xuất lập hồ sơ, hợp tác xã sơ duyệt, cán bộ đầu mối ghi kết quả chính thức. Hệ thống nhắc việc khi sắp quá hạn.",
      a: "Hồ sơ nhóm \"Hàng thủ công mỹ nghệ\" đi trọn quy trình.",
      b: "Cùng một quy trình, chỉ khác nhóm sản phẩm khi lập hồ sơ.",
      link: { href: "/process", label: "Xem hồ sơ đang ở chặng nào" },
    },
    {
      letter: "D",
      title: "Data: dữ liệu và truy xuất",
      common: "Mỗi sản phẩm có hành trình bảy công đoạn, lưu bền vững, có kho lưu trữ lâu dài và kho khóa chống sửa. Người mua quét mã QR là xem được. Điểm khác giữa các ngành nằm ở chuỗi công đoạn:",
      a: gom ? <Chain sector={gom} /> : null,
      b: lua ? <Chain sector={lua} /> : null,
      link: { href: "/trace", label: "Xem sản phẩm theo ngành" },
    },
    {
      letter: "I",
      title: "Intelligence: phân tích và trợ lý",
      common: "Trợ lý hỏi đáp trả lời kèm nguồn, dùng cho mọi ngành. Phân tích theo bộ luật có giải thích được gắn riêng cho từng ngành khi có dữ liệu cảm biến.",
      a: (
        <>
          <Tag ok>Đã có</Tag>
          <p>Phân tích từng mẻ nung từ cảm biến lò: nhiệt độ đỉnh, thời gian giữ, tốc độ lên nhiệt, kèm lý do bằng lời.</p>
        </>
      ),
      b: (
        <>
          <Tag ok>Đã có</Tag>
          <p>Phân tích từng mẻ nhuộm từ cảm biến bể nhuộm: nhiệt độ đỉnh, thời gian giữ, tốc độ nâng nhiệt, cảnh báo khi để sôi, kèm lý do bằng lời. Ngưỡng là tham khảo, chưa được nghệ nhân xác nhận.</p>
        </>
      ),
      link: { href: "/intelligence", label: "Xem phân tích và trợ lý" },
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <PageTitle title="Cấu trúc nền tảng" desc="Gốm và lụa dùng chung một nền tảng bốn tầng. Mỗi ngành chỉ khác ở chuỗi công đoạn và phân tích riêng." />

      <ol className="space-y-5">
        {tiers.map((t) => (
          <li key={t.letter} className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600 text-lg font-bold text-white">{t.letter}</span>
              <h2 className="text-lg font-semibold text-stone-900">{t.title}</h2>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-[1.2fr_1fr_1fr]">
              <Cell title="Dùng chung" tone="bg-brand-50">{t.common}</Cell>
              <Cell title={gom?.label ?? "Gốm sứ"}>{t.a}</Cell>
              <Cell title={lua?.label ?? "Lụa và dệt"}>{t.b}</Cell>
            </div>
            <Link href={t.link.href} className="mt-3 inline-block text-sm font-medium text-brand-700 hover:underline">
              {t.link.label} ›
            </Link>
          </li>
        ))}
      </ol>

      <p className="mt-6 rounded-xl bg-stone-100 p-4 text-sm leading-relaxed text-stone-700">
        Thêm một ngành mới (ví dụ mây tre đan) chỉ cần khai báo tên và chuỗi công đoạn trong một tệp cấu hình, không phải viết lại hệ thống. Phần phân tích riêng của ngành đó là việc làm thêm.
      </p>
    </div>
  );
}
