// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Làng Nghề Số contributors
"use client";

import Link from "next/link";
import { useState } from "react";
import Card from "./Card";
import { useAuth } from "./AuthProvider";
import ContactList from "./ContactList";
import { contactChannels } from "@/lib/contact";

interface Answer {
  matched: boolean;
  referral?: boolean; // không tìm thấy: chỉ đường tới người có thẩm quyền
  answer: string;
  related?: { title: string; text: string }[];
  sources: { title: string; ref: string }[];
}

const EXAMPLES = ["Hồ sơ OCOP nhóm hàng thủ công cần giấy tờ gì?", "Bao nhiêu điểm thì được 4 sao?", "Kết quả OCOP có hiệu lực bao lâu?", "Kết luận Cảnh báo của mẻ nung nghĩa là gì?"];

/** Chỉ đường khi trợ lý không biết: hỏi đúng người theo việc của họ. */
function Referral() {
  const { user } = useAuth();
  const reviewer = Boolean(user.permissions["application.review"]);
  const targets = reviewer
    ? [
        { who: "Đơn vị đầu mối OCOP hoặc cơ quan có thẩm quyền", why: "Quy định, cách chấm điểm, kết quả chính thức và hiệu lực." },
        { who: "Quản trị viên hệ thống", why: "Tài khoản, quyền truy cập và lỗi của phần mềm." },
      ]
    : [
        { who: user.coop ? `Cán bộ hợp tác xã ${user.coop}` : "Cán bộ hợp tác xã của bạn", why: "Việc liên quan hồ sơ và sản phẩm của bạn." },
        { who: "Cơ quan có thẩm quyền về OCOP", why: "Quy định, điều kiện và kết quả chính thức." },
      ];
  return (
    <div className="mt-4 rounded-lg border border-brand-200 bg-brand-50 p-4">
      <p className="text-sm font-semibold text-stone-900">Bạn có thể hỏi trực tiếp</p>
      <ul className="mt-2 space-y-2">
        {targets.map((t) => (
          <li key={t.who} className="text-sm text-stone-700">
            <span className="font-medium text-stone-900">{t.who}</span>
            <span className="block text-xs text-stone-600">{t.why}</span>
          </li>
        ))}
      </ul>
      {contactChannels().length > 0 && (
        <div className="mt-3">
          <ContactList />
        </div>
      )}
      <Link href="/help#lien-he" className="mt-3 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
        Xem cách liên hệ
      </Link>
    </div>
  );
}

/** Hỏi đáp: tra cứu trong quy định và hướng dẫn của hệ thống, trả lời bằng cách trích lại đoạn phù hợp kèm nguồn. */
export default function AssistantPanel() {
  const { apiFetch } = useAuth();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Answer | null>(null);
  const [asked, setAsked] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function ask(question: string) {
    const text = question.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    setAsked(text);
    try {
      const r = await apiFetch("/api/trace/assistant/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: text }) });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? `Hệ thống báo lỗi (mã ${r.status})`);
      setRes(body as Answer);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi không xác định");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Hỏi đáp về hồ sơ OCOP và hệ thống">
      <p className="text-sm text-stone-600">Trợ lý tra cứu trong quy định và hướng dẫn của hệ thống rồi trích lại đoạn phù hợp nhất, luôn kèm nguồn. Trợ lý không tự suy đoán và không thay thế văn bản pháp luật hay quyết định của cơ quan có thẩm quyền.</p>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(q);
        }}
      >
        <label className="sr-only" htmlFor="assistant-q">
          Câu hỏi
        </label>
        <input
          id="assistant-q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={300}
          placeholder="Ví dụ: hồ sơ OCOP cần giấy tờ gì?"
          className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        />
        <button type="submit" disabled={busy || !q.trim()} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
          {busy ? "Đang tìm…" : "Hỏi"}
        </button>
      </form>
      <div className="mt-2 flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => {
              setQ(ex);
              void ask(ex);
            }}
            className="rounded-full border border-stone-300 px-3 py-1 text-xs text-stone-700 hover:bg-stone-50"
          >
            {ex}
          </button>
        ))}
      </div>
      {error && (
        <p className="mt-3 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      {res && (
        <div className="mt-4 rounded-lg border border-stone-200 bg-stone-50 p-4" role="status">
          <p className="text-xs text-stone-500">Câu hỏi: {asked}</p>
          <p className={`mt-1 text-sm leading-relaxed ${res.matched ? "text-stone-900" : "text-stone-600"}`}>{res.answer}</p>
          {res.referral && <Referral />}
          {res.sources.length > 0 && (
            <p className="mt-3 text-xs text-stone-500">
              Nguồn: {res.sources.map((s) => `${s.title} (${s.ref})`).join("; ")}
            </p>
          )}
          {res.related && res.related.length > 0 && (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-xs font-medium text-brand-700">Xem thêm các đoạn liên quan</summary>
              {res.related.map((r) => (
                <div key={r.title} className="mt-2">
                  <p className="text-xs font-semibold text-stone-700">{r.title}</p>
                  <p className="text-sm text-stone-700">{r.text}</p>
                </div>
              ))}
            </details>
          )}
        </div>
      )}
    </Card>
  );
}
