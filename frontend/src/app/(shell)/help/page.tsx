// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use client";

import Link from "next/link";
import { PageTitle } from "@/components/Card";
import Photo from "@/components/Photo";
import { useAuth } from "@/components/AuthProvider";
import ContactList from "@/components/ContactList";
import { contactChannels } from "@/lib/contact";
import { canSee } from "@/lib/pages";

const guides = [
  {
    title: "Lập và nộp hồ sơ OCOP",
    steps: [
      "Vào Hồ sơ OCOP, bấm \"+ Lập hồ sơ mới\".",
      "Nhập tên sản phẩm, chọn nhóm, tự chấm điểm dự kiến và tick những giấy tờ bạn đã có.",
      "Mở hồ sơ vừa tạo, tải ảnh và giấy tờ lên (ảnh JPG, PNG, WEBP hoặc PDF, tối đa 5 MB mỗi tệp).",
      "Bấm \"Nộp hồ sơ\". Hợp tác xã sẽ nhận được thông báo để sơ duyệt.",
    ],
  },
  {
    title: "Khi hồ sơ được yêu cầu bổ sung",
    steps: [
      "Chuông thông báo ở góc trên sẽ báo cho bạn, hồ sơ cũng hiện ở \"Việc của bạn\" trên Trang chủ.",
      "Mở hồ sơ, đọc lý do hợp tác xã ghi, bổ sung giấy tờ còn thiếu.",
      "Bấm nộp lại. Hồ sơ quay về bước sơ duyệt.",
    ],
  },
  {
    title: "Tra cứu nguồn gốc và quét mã QR",
    steps: [
      "Người mua mở camera điện thoại, quét mã QR trên sản phẩm hoặc tem. Không cần đăng nhập.",
      "Trang hiện người làm ra, mẻ nung (kèm đường cong nhiệt độ), kiểm định và kết quả OCOP.",
      "Kết quả OCOP chính thức và xác nhận của nền tảng được ghi riêng, tránh nhầm lẫn.",
    ],
  },
];

const faqs = [
  ["Hệ thống có cấp giấy chứng nhận OCOP không?", "Không. Hệ thống chỉ giúp bạn chuẩn bị hồ sơ và theo dõi tiến độ. Kết quả chính thức do cơ quan có thẩm quyền quyết định."],
  ["Tôi không thấy một mục trên menu?", "Mỗi vai trò chỉ thấy những mục phù hợp với công việc của mình. Nếu cần thêm quyền, hãy nhờ quản trị viên."],
  ["Tải tệp lên bị báo lỗi?", "Kiểm tra tệp là ảnh JPG, PNG, WEBP hoặc PDF và không quá 5 MB. Nếu báo bộ quét chưa sẵn sàng, đợi vài phút rồi thử lại."],
  ["Quên mật khẩu thì sao?", "Hãy nhờ quản trị viên đặt lại mật khẩu cho bạn. Lần đăng nhập sau, bạn nên đổi sang mật khẩu mới của riêng mình."],
];

export default function HelpPage() {
  const { user } = useAuth();
  const hasContact = contactChannels().length > 0;
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageTitle title="Trợ giúp" desc="Hướng dẫn nhanh, câu hỏi thường gặp và cách liên hệ khi cần." />

      <figure className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/photos/help-yard.jpg" alt="Thợ gốm nặn sản phẩm trong sân xưởng" onError={(e) => { e.currentTarget.closest("figure")?.setAttribute("hidden", ""); }} className="h-40 w-full object-cover object-center sm:h-56" />
      </figure>

      <section aria-labelledby="g-h">
        <h2 id="g-h" className="mb-3 text-lg font-semibold text-stone-800">Hướng dẫn từng việc</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {guides.map((g, i) => (
            <article key={g.title} className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-800">{i + 1}</span>
              <h3 className="mt-3 text-base font-semibold text-stone-900">{g.title}</h3>
              <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-stone-600">
                {g.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </article>
          ))}
        </div>
        {canSee(user, "/intelligence") && (
          <p className="mt-4 rounded-xl bg-brand-50 p-4 text-sm text-stone-700">
            Muốn hỏi nhanh một quy định? Mở{" "}
            <Link href="/intelligence" className="font-semibold text-brand-700 hover:underline">
              trợ lý hỏi đáp
            </Link>
            : trợ lý trả lời kèm nguồn, và nói thẳng khi không biết.
          </p>
        )}
      </section>

      <section aria-labelledby="f-h">
        <h2 id="f-h" className="mb-3 text-lg font-semibold text-stone-800">Câu hỏi thường gặp</h2>
        <div className="divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white shadow-sm">
          {faqs.map(([q, a]) => (
            <details key={q} className="group p-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-stone-800">
                {q}
                <span aria-hidden="true" className="text-stone-400 transition group-open:rotate-90">›</span>
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-stone-600">{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section id="lien-he" aria-labelledby="c-h" className="scroll-mt-6">
        <h2 id="c-h" className="mb-3 text-lg font-semibold text-stone-800">Liên hệ hỗ trợ</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
            <Photo src="/illustrations/support.svg" className="mb-3 h-28 w-full rounded-lg object-cover object-top" />
            <h3 className="text-base font-semibold text-stone-900">Nhờ người gần nhất</h3>
            <p className="mt-2 text-sm leading-relaxed text-stone-600">
              Với việc về hồ sơ của bạn, hãy hỏi <strong>cán bộ hợp tác xã</strong> trước. Với việc về tài khoản và quyền, hãy nhờ <strong>quản trị viên</strong>.
            </p>
          </div>
          <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
            <h3 className="text-base font-semibold text-stone-900">Đầu mối hỗ trợ của hệ thống</h3>
            {hasContact ? (
              <ContactList />
            ) : (
              <p className="mt-2 text-sm leading-relaxed text-stone-600">
                Hãy liên hệ người đã cấp tài khoản cho bạn, hoặc cán bộ hợp tác xã nơi bạn thuộc về.
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
