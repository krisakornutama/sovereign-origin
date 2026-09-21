"use client";
// ─────────────────────────────────────────────────────────────
//  QuizCard — คอมโพเนนต์ทำแบบทดสอบ MBTI (ตัวเดียว สองโหมด)
//  · variant="inline" — ในหน้า /mbti/compare (แบบทดสอบของอีกคน)
//  · variant="page"   — ในหน้า /mbti (แถบ progress + ชิปมิติ + CTA ชุดสั้น)
//  เรียบง่าย: รับ questions + คืนผ่าน onDone(answers) — การให้คะแนนเป็นของผู้เรียก
// ─────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from "react";
import { MbtiQuestion, MBTI_DIM_INFO } from "../../lib/mbtiData";

// โทนสีต้องเป็น literal (Tailwind JIT หยิบจากซอร์ส) — ห้ามประกอบ string ตอนรัน
const TONES = {
  fuchsia: {
    sel: "bg-fuchsia-600/25 border-fuchsia-500 text-white shadow-[0_0_18px_rgba(217,70,239,0.25)]",
    hov: "hover:border-fuchsia-500/50",
    done: "bg-fuchsia-600 text-white",
    answered: "bg-fuchsia-900/60 text-fuchsia-300 border border-fuchsia-700",
    bar: "bg-fuchsia-500",
    accent: "text-fuchsia-400",
    btn: "bg-fuchsia-600 hover:bg-fuchsia-500",
  },
  violet: {
    sel: "bg-violet-600/25 border-violet-500 text-white shadow-[0_0_18px_rgba(139,92,246,0.25)]",
    hov: "hover:border-violet-500/50",
    done: "bg-violet-600 text-white",
    answered: "bg-violet-900/60 text-violet-300 border border-violet-700",
    bar: "bg-violet-500",
    accent: "text-violet-400",
    btn: "bg-violet-600 hover:bg-violet-500",
  },
} as const;

interface QuizCardProps {
  questions: MbtiQuestion[];
  onDone: (answers: Record<number, number>) => void;
  /** inline (default): ใช้ใน compare · page: ใช้ในหน้า /mbti */
  variant?: "inline" | "page";
  tone?: keyof typeof TONES;
  // ── inline ──
  title?: string;
  subtitle?: string;
  onCancel?: () => void;
  // ── page ──
  modeLabel?: string; // "ชุดเต็ม" | "ควิซสั้น" แสดงในแถว progress
  onSwitchFull?: () => void; // CTA ชวนทำชุดเต็ม (แสดงเมื่อส่งมา — โหมดชุดสั้น)
}

export default function QuizCard({
  questions, onDone, variant = "inline", tone = "fuchsia",
  title, subtitle, onCancel, modeLabel, onSwitchFull,
}: QuizCardProps) {
  const t = TONES[tone];
  const page = variant === "page";
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [idx, setIdx] = useState(0);
  const q = questions[idx];
  const answered = useMemo(() => Object.keys(answers).length, [answers]);
  const progress = Math.round((answered / questions.length) * 100);
  const last = idx === questions.length - 1;

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
      {/* ── หัว: page = แถบ progress · inline = หัวเรื่อง + ยกเลิก ── */}
      {page ? (
        <>
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>ข้อ {idx + 1} / {questions.length} — ตอบแล้ว {answered} ข้อ <span className={t.accent}>({modeLabel})</span></span>
            <span className={t.accent}>{progress}%</span>
          </div>
          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div className={`h-full ${t.bar} transition-all`} style={{ width: `${progress}%` }} />
          </div>
        </>
      ) : (
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
      )}

      {/* ── การ์ดคำถาม — forced-choice เลือกข้อความที่ตรงกับตัวเองกว่า ── */}
      <div className={`card ${page ? "panel-glow p-6 space-y-5" : "p-6 space-y-4"}`}>
        {page && (
          <>
            <div className="flex items-center gap-2 text-xs">
              <span className="px-2 py-1 rounded bg-gray-800 border border-gray-700 text-gray-300">{MBTI_DIM_INFO[q.d].hint}</span>
              <span className="text-gray-500">#{q.id}</span>
              {answers[q.id] != null && <span className={`ml-auto ${t.accent} flex items-center gap-1`}>✓ ตอบแล้ว</span>}
            </div>
            <h2 className="text-lg font-bold text-white leading-relaxed text-center py-2">เลือกข้อความที่ &quot;ใช่&quot; กับตัวคุณมากกว่า</h2>
          </>
        )}

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
              <span className="text-sm leading-relaxed">{o.text}</span>
            </button>
          ))}
        </div>

        <div className={`flex justify-between items-center gap-3 ${page ? "pt-3 border-t border-gray-800" : ""}`}>
          <button onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0}
            className={page ? "px-4 py-2 bg-gray-800 disabled:opacity-40 rounded-lg text-sm" : "text-sm text-gray-400 hover:text-white disabled:opacity-30"}>← ก่อนหน้า</button>

          {page ? (
            last ? (
              <button onClick={() => onDone(answers)} disabled={answered < questions.length}
                className={`px-6 py-2 ${t.btn} disabled:opacity-40 rounded-lg text-sm font-bold text-white`}>
                {answered < questions.length ? `ตอบให้ครบอีก ${questions.length - answered} ข้อ` : "ดูผลลัพธ์ →"}
              </button>
            ) : (
              <button onClick={() => setIdx((i) => i + 1)} disabled={answers[q.id] == null}
                className={`px-5 py-2 ${t.btn} disabled:opacity-40 rounded-lg text-sm text-white`}>ถัดไป →</button>
            )
          ) : (
            <>
              <button onClick={() => onDone(answers)} disabled={answered < questions.length}
                className="btn-primary px-5 py-2 text-sm disabled:opacity-40">เสร็จสิ้น ✓</button>
              <button onClick={() => setIdx((i) => Math.min(questions.length - 1, i + 1))} disabled={last || answers[q.id] == null}
                className="text-sm text-gray-400 hover:text-white disabled:opacity-30">ถัดไป →</button>
            </>
          )}
        </div>

        {page && (
          <p className="text-[11px] text-gray-500 text-center">กด A/B หรือ 1/2 บนคีย์บอร์ดได้ • ลูกศร ← → เลื่อนข้อ • คำตอบเก็บในเบราว์เซอร์นี้เท่านั้น</p>
        )}
      </div>

      {/* ── ไทม์ไลน์กระโดดข้อ ── */}
      <div className="flex flex-wrap gap-1.5 justify-center">
        {questions.map((qq, i) => (
          <button key={qq.id} onClick={() => setIdx(i)}
            className={`w-7 h-7 rounded text-[10px] ${
              i === idx ? t.done
              : answers[qq.id] != null ? t.answered
              : "bg-gray-800 text-gray-500"
            }`} title={`ข้อ ${qq.id}`}>{i + 1}</button>
        ))}
      </div>

      {page && onSwitchFull && (
        <p className="text-[11px] text-center text-gray-500">
          💡 ผลจากชุดสั้นเป็นการประเมินเบื้องต้น — เมื่อมีเวลา แนะนำ <button onClick={onSwitchFull} className={`${t.accent} underline`}>ทำชุดเต็ม 93 ข้อ</button> เพื่อความแม่นยำที่สูงขึ้น
        </p>
      )}
    </div>
  );
}
