"use client";
// ─────────────────────────────────────────────────────────────
//  QuizCard — คอมโพเนนต์ทำแบบทดสอบ MBTI (ใช้ร่วมกัน)
//  ใช้โดย: /mbti (ชุดเต็ม 93 / ควิซสั้น 32) และ /mbti/compare (โหมดให้อีกคนทำเอง)
//  เรียบง่าย: รับ questions + คืนผ่าน onDone(answers) — การให้คะแนนเป็นของผู้เรียก
// ─────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from "react";
import { MbtiQuestion } from "../../lib/mbtiData";

// โทนสีต้องเป็น literal (Tailwind JIT หยิบจากซอร์ส) — ห้ามประกอบ string ตอนรัน
const TONES = {
  fuchsia: {
    sel: "bg-fuchsia-600/25 border-fuchsia-500 text-white shadow-[0_0_18px_rgba(217,70,239,0.25)]",
    hov: "hover:border-fuchsia-500/50",
    done: "bg-fuchsia-600 text-white",
    answered: "bg-fuchsia-900/60 text-fuchsia-300 border border-fuchsia-700",
  },
  violet: {
    sel: "bg-violet-600/25 border-violet-500 text-white shadow-[0_0_18px_rgba(139,92,246,0.25)]",
    hov: "hover:border-violet-500/50",
    done: "bg-violet-600 text-white",
    answered: "bg-violet-900/60 text-violet-300 border border-violet-700",
  },
} as const;

interface QuizCardProps {
  questions: MbtiQuestion[];
  title: string;
  subtitle?: string;
  tone?: keyof typeof TONES;
  onDone: (answers: Record<number, number>) => void;
  onCancel?: () => void;
}

export default function QuizCard({ questions, title, subtitle, tone = "fuchsia", onDone, onCancel }: QuizCardProps) {
  const t = TONES[tone];
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [idx, setIdx] = useState(0);
  const q = questions[idx];
  const answered = useMemo(() => Object.keys(answers).length, [answers]);

  // ตอบด้วยคีย์บอร์ด A/B (1/2) หรือลูกศรซ้ายขวา
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "a" || e.key === "A" || e.key === "1") pick(0);
      if (e.key === "b" || e.key === "B" || e.key === "2") pick(1);
      if (e.key === "ArrowLeft") setIdx((i) => Math.max(0, i - 1));
      if (e.key === "ArrowRight" && answers[q.id] != null) setIdx((i) => Math.min(questions.length - 1, i + 1));
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, answers, q.id, questions.length]);

  const pick = (v: number) => setAnswers((a) => ({ ...a, [q.id]: v }));

  return (
    <div className="space-y-4 max-w-3xl mx-auto w-full">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-bold text-white">{title}</h3>
          {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">ตอบแล้ว {answered}/{questions.length}</span>
          {onCancel && <button onClick={onCancel} className="text-xs text-gray-500 hover:text-white underline">ยกเลิก</button>}
        </div>
      </div>

      {/* การ์ดคำถาม — forced-choice เลือกข้อความที่ตรงกับตัวเองกว่า */}
      <div className="card p-6 space-y-4">
        <span className="inset px-2 py-0.5 rounded text-xs text-gray-500">ข้อ {idx + 1} / {questions.length}</span>
        <div className="grid sm:grid-cols-2 gap-3">
          {[
            { v: 0, label: "A", text: q.a },
            { v: 1, label: "B", text: q.b },
          ].map((o) => (
            <button key={o.v} onClick={() => pick(o.v)}
              className={`p-4 rounded-xl border text-left transition-all ${
                answers[q.id] === o.v ? t.sel : `bg-gray-800/60 border-gray-700 text-gray-200 ${t.hov}`
              }`}>
              <span className="inline-flex w-6 h-6 rounded-full bg-gray-900 border border-gray-600 items-center justify-center text-xs font-bold mr-2 mb-1">{o.label}</span>
              {o.text}
            </button>
          ))}
        </div>
        <div className="flex justify-between items-center gap-3">
          <button onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0}
            className="text-sm text-gray-400 hover:text-white disabled:opacity-30">← ก่อนหน้า</button>
          <button onClick={() => onDone(answers)} disabled={answered < questions.length}
            className="btn-primary px-5 py-2 text-sm disabled:opacity-40">
            เสร็จสิ้น ✓
          </button>
          <button onClick={() => setIdx((i) => Math.min(questions.length - 1, i + 1))} disabled={idx === questions.length - 1 || answers[q.id] == null}
            className="text-sm text-gray-400 hover:text-white disabled:opacity-30">ถัดไป →</button>
        </div>
      </div>

      {/* ไทม์ไลน์กระโดดข้อ */}
      <div className="flex flex-wrap gap-1.5 justify-center">
        {questions.map((qq, i) => (
          <button key={qq.id} onClick={() => setIdx(i)}
            className={`w-7 h-7 rounded text-[10px] ${
              i === idx ? `${t.done}`
              : answers[qq.id] != null ? t.answered
              : "bg-gray-800 text-gray-500"
            }`} title={`ข้อ ${qq.id}`}>{i + 1}</button>
        ))}
      </div>
    </div>
  );
}
