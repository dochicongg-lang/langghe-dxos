// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
import type { Metadata } from "next";
import Link from "next/link";
import CodeLookup from "@/components/CodeLookup";
import Photo from "@/components/Photo";
import StageIcon from "@/components/StageIcon";

export const metadata: Metadata = {
  title: "Giới thiệu · Làng Nghề Số",
  description: "Làng Nghề Số giúp làng nghề ghi lại hành trình sản phẩm, chuẩn bị hồ sơ OCOP và để người mua tự kiểm chứng nguồn gốc bằng mã QR.",
};

const values = [
  { img: "qr", title: "Hành trình sản phẩm rõ ràng", text: "Ghi lại từng công đoạn của nghề, từ nguyên liệu đến phân phối. Người mua quét mã QR là thấy toàn bộ, không cần đăng nhập." },
  { img: "ocop", title: "Hồ sơ OCOP gọn gàng", text: "Lập hồ sơ, tải giấy tờ, tự chấm điểm dự kiến. Hợp tác xã sơ duyệt ngay trên hệ thống và nhắc việc khi sắp quá hạn." },
  { img: "kiln", title: "Số liệu cảm biến đáng tin", text: "Với công đoạn cần kiểm soát nhiệt, như nung gốm hay nhuộm lụa, nhiệt độ do cảm biến ghi và được khóa không cho sửa. Hệ thống tự đối chiếu và giải thích từng mẻ bằng lời dễ hiểu." },
];

const steps = [
  { stage: "nguyen-lieu", title: "Ghi từng công đoạn", text: "Nghệ nhân hoặc hợp tác xã ghi từng bước theo quy trình của nghề mình, rồi kiểm định, đóng gói, phân phối. Mỗi nghề có chuỗi công đoạn riêng." },
  { stage: "nung-hoan-thien", title: "Cảm biến ghi số liệu", text: "Ở công đoạn cần đo (nhiệt độ lò nung, bể nhuộm...), số liệu được ghi tự động và bảo vệ khỏi việc sửa hay xóa về sau." },
  { stage: "kiem-dinh", title: "Duyệt hồ sơ OCOP", text: "Hợp tác xã sơ duyệt, cán bộ đầu mối ghi kết quả chính thức do cơ quan có thẩm quyền quyết định." },
  { stage: "dong-goi", title: "Mã QR cho người mua", text: "In mã QR lên sản phẩm. Người mua quét để xem câu chuyện, số liệu cảm biến (nếu có) và chứng nhận." },
];

const trades = [
  { name: "Gốm sứ", chain: "Nguyên liệu → Sơ chế → Tạo hình → Nung → Kiểm định → Đóng gói → Phân phối", note: "Có cảm biến lò nung và phân tích từng mẻ nung." },
  { name: "Lụa và dệt", chain: "Nguyên liệu tơ → Chuẩn bị sợi → Dệt → Chuội nhuộm → Kiểm định → Đóng gói → Phân phối", note: "Có cảm biến bể nhuộm và phân tích từng mẻ nhuộm." },
  { name: "Nghề khác", chain: "Ví dụ: mây tre đan, thêu, đúc đồng, sơn mài...", note: "Thêm một nghề chỉ cần khai báo chuỗi công đoạn của nghề đó; phần phân tích riêng là việc làm thêm." },
];

const audiences = [
  { who: "Nghệ nhân, hộ sản xuất", does: "Ghi công đoạn, lập và nộp hồ sơ OCOP, theo dõi tiến độ." },
  { who: "Hợp tác xã", does: "Sơ duyệt hồ sơ của thành viên, nhận nhắc việc, xem tình hình chung." },
  { who: "Cán bộ đầu mối OCOP", does: "Xem hồ sơ đã sơ duyệt, ghi kết quả chính thức và hiệu lực." },
  { who: "Người mua", does: "Quét mã QR để biết sản phẩm do ai làm, làm thế nào, đã được chứng nhận gì." },
];

const promises = [
  "Kết quả OCOP chính thức luôn do cơ quan có thẩm quyền quyết định. Hệ thống chỉ hỗ trợ chuẩn bị hồ sơ và theo dõi.",
  "Trang tra cứu hiển thị tách bạch: kết quả chính thức của cơ quan và xác nhận của nền tảng.",
  "Mọi thao tác đều được ghi vào nhật ký, không thể sửa lén. Dữ liệu cảm biến không thể ghi đè hay xóa.",
  "Mỗi người chỉ thấy và làm đúng việc của mình, theo vai trò được cấp.",
];

export default function IntroPage() {
  return (
    <div className="min-h-screen bg-canvas text-stone-800">
      <header className="sticky top-0 z-30 border-b border-stone-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/gioi-thieu" className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 font-bold text-white">LN</span>
            <span className="font-semibold text-stone-900">Làng Nghề Số</span>
          </Link>
          <nav aria-label="Các mục trang giới thiệu" className="hidden items-center gap-6 text-sm text-stone-600 md:flex">
            <a href="#gia-tri" className="hover:text-stone-900">Giá trị</a>
            <a href="#cach-hoat-dong" className="hover:text-stone-900">Cách hoạt động</a>
            <a href="#nghe" className="hover:text-stone-900">Các nghề</a>
            <a href="#danh-cho-ai" className="hover:text-stone-900">Dành cho ai</a>
            <a href="#cam-ket" className="hover:text-stone-900">Cam kết</a>
          </nav>
          <Link href="/" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
            Đăng nhập
          </Link>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden bg-stone-900 text-white">
          <Photo src="/photos/hero-painter.jpg" className="absolute inset-0 h-full w-full object-cover object-right opacity-90" />
          <div aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(90deg,rgba(28,16,10,0.94)_0%,rgba(28,16,10,0.72)_42%,rgba(28,16,10,0.08)_100%)]" />
          <div className="relative mx-auto max-w-6xl px-4 py-16 sm:py-24">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-300">Dành cho làng nghề Việt Nam</p>
            <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">Từ đôi tay nghệ nhân đến tay người mua, minh bạch từng công đoạn</h1>
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-stone-200">
              Làng Nghề Số giúp bạn ghi lại hành trình sản phẩm, chuẩn bị hồ sơ OCOP và để người mua tự kiểm chứng nguồn gốc chỉ bằng một lần quét mã QR.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/" className="rounded-lg bg-white px-6 py-3 text-sm font-semibold text-brand-800 shadow hover:bg-brand-50">
                Đăng nhập để bắt đầu
              </Link>
              <a href="#tra-cuu" className="rounded-lg border border-white/50 px-6 py-3 text-sm font-semibold text-white hover:bg-white/10">
                Tôi là người mua, muốn tra cứu
              </a>
            </div>
          </div>
        </section>

        <section id="tra-cuu" aria-labelledby="tc-h" className="scroll-mt-16 border-b border-stone-200 bg-white">
          <div className="mx-auto flex max-w-6xl flex-col items-start gap-4 px-4 py-8 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 id="tc-h" className="text-lg font-semibold text-stone-900">Tra cứu nguồn gốc một sản phẩm</h2>
              <p className="text-sm text-stone-600">Nhập mã in trên tem, hoặc quét mã QR bằng camera điện thoại. Không cần đăng nhập.</p>
            </div>
            <CodeLookup />
          </div>
        </section>

        <section id="gia-tri" aria-labelledby="gt-h" className="mx-auto max-w-6xl scroll-mt-16 px-4 py-14">
          <h2 id="gt-h" className="text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">Ba việc hệ thống làm giúp bạn</h2>
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {values.map((v) => (
              <article key={v.title} className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
                <Photo src={`/illustrations/${v.img}.svg`} className="h-40 w-full object-cover" />
                <div className="p-6">
                  <h3 className="text-lg font-semibold text-stone-900">{v.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-stone-600">{v.text}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section id="cach-hoat-dong" aria-labelledby="ch-h" className="scroll-mt-16 bg-white py-14">
          <div className="mx-auto max-w-6xl px-4">
            <h2 id="ch-h" className="text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">Cách hoạt động, từ xưởng đến người mua</h2>
            <ol className="mt-8 grid gap-5 md:grid-cols-4">
              {steps.map((s, i) => (
                <li key={s.title} className="relative rounded-2xl border border-stone-200 bg-canvas p-5">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">{i + 1}</span>
                    <span className="text-brand-700">
                      <StageIcon stage={s.stage} className="h-5 w-5" />
                    </span>
                  </div>
                  <h3 className="mt-3 text-base font-semibold text-stone-900">{s.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-stone-600">{s.text}</p>
                  {i < steps.length - 1 && (
                    <span aria-hidden="true" className="absolute -right-3 top-1/2 z-10 hidden -translate-y-1/2 text-stone-400 md:block">
                      →
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="nghe" aria-labelledby="ng-h" className="mx-auto max-w-6xl scroll-mt-16 px-4 py-14">
          <h2 id="ng-h" className="text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">Cho nhiều làng nghề trên một nền tảng</h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-stone-600">Mỗi nghề có chuỗi công đoạn riêng, còn tài khoản, hồ sơ OCOP, mã QR và nhật ký dùng chung. Mỗi hợp tác xã chỉ thấy dữ liệu của mình.</p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {trades.map((t) => (
              <article key={t.name} className="rounded-2xl border border-stone-200 bg-white p-5">
                <h3 className="text-base font-semibold text-stone-900">{t.name}</h3>
                <p className="mt-2 text-sm leading-relaxed text-stone-700">{t.chain}</p>
                <p className="mt-2 text-sm leading-relaxed text-stone-500">{t.note}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="danh-cho-ai" aria-labelledby="dc-h" className="mx-auto max-w-6xl scroll-mt-16 px-4 py-14">
          <h2 id="dc-h" className="text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">Dành cho ai</h2>
          <dl className="mt-8 grid gap-4 sm:grid-cols-2">
            {audiences.map((a) => (
              <div key={a.who} className="rounded-2xl border border-stone-200 bg-white p-5">
                <dt className="text-base font-semibold text-stone-900">{a.who}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-stone-600">{a.does}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section id="cam-ket" aria-labelledby="ck-h" className="scroll-mt-16 bg-brand-50 py-14">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 md:grid-cols-[1fr_1.2fr] md:items-center">
            <div>
              <h2 id="ck-h" className="text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">Cam kết minh bạch</h2>
              <p className="mt-3 text-sm leading-relaxed text-stone-600">Chúng tôi nói rõ hệ thống làm được gì và không làm gì, để người mua và cơ quan quản lý đều có thể tin vào những gì họ thấy.</p>
            </div>
            <ul className="space-y-3">
              {promises.map((p) => (
                <li key={p} className="flex gap-3 rounded-xl bg-white p-4 text-sm leading-relaxed text-stone-700 shadow-sm">
                  <span aria-hidden="true" className="mt-0.5 font-bold text-emerald-600">✓</span>
                  {p}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="cta-h" className="bg-stone-900 py-14 text-white">
          <div className="mx-auto flex max-w-6xl flex-col items-start gap-5 px-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 id="cta-h" className="text-2xl font-semibold tracking-tight">Sẵn sàng bắt đầu?</h2>
              <p className="mt-1 text-sm text-stone-300">Đăng nhập bằng tài khoản được cấp. Chưa có tài khoản, hãy nhờ cán bộ hợp tác xã.</p>
            </div>
            <Link href="/" className="rounded-lg bg-brand-500 px-6 py-3 text-sm font-semibold text-white hover:bg-brand-600">
              Đăng nhập
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-stone-200 bg-white px-4 py-6 text-xs text-stone-500">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
          <p>Làng Nghề Số · Hỗ trợ lập hồ sơ OCOP và truy xuất nguồn gốc cho nhiều làng nghề.</p>
          <p>Kết quả OCOP chính thức do cơ quan có thẩm quyền quyết định.</p>
        </div>
      </footer>
    </div>
  );
}
