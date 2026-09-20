"use client";
// ─────────────────────────────────────────────────────────────
//  MBTI — แบบทดสอบบุคลิกภาพ 16 ประเภท (Local-First)
//  โครงเดียวกับ Self-Check: ทำเอง เก็บเอง ไม่พึ่งเซิร์ฟเวอร์
//  ธีมบรรยากาศ: atmo-mind (ม่วงอเมทิสต์ — ห้องสะท้อนความคิด)
// ─────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from "react";
import Sidebar from "../components/layout/Sidebar";
import PageHeader from "../components/ui/PageHeader";
import Icon from "../components/ui/Icon";
import Link from "next/link";
import {
  MBTI_QUESTIONS, MBTI_TYPES, scoreMbti, typeInfo,
  type MbtiResult, type MbtiTypeInfo,
} from "../lib/mbtiData";

const STORE_KEY = "sovereign.mbti.results.v1";

const DIM_LABEL: Record<string, { first: string; second: string; hint: string }> = {
  EI: { first: "E — มุ่งออก (Extraversion)", second: "I — มุ่งเข้า (Introversion)", hint: "พลังงานมาจากไหน" },
  SN: { first: "S — จับต้องได้ (Sensing)", second: "N — นามธรรม (Intuition)", hint: "รับข้อมูลโลกแบบไหน" },
  TF: { first: "T — ตรรกะ (Thinking)", second: "F — ความรู้สึก (Feeling)", hint: "ตัดสินใจด้วยอะไร" },
  JP: { first: "J — จัดระเบียบ (Judging)", second: "P — ล่องลอย (Perceiving)", hint: "ใช้ชีวิตแบบไหน" },
};

type Screen = "intro" | "quiz" | "result" | "library";

interface StoredResult extends MbtiResult {}

function loadResults(): StoredResult[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || "[]"); } catch { return []; }
}

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" }); } catch { return iso.slice(0, 10); }
}

export default function MbtiPage() {
  const [screen, setScreen] = useState<Screen>("intro");
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [result, setResult] = useState<StoredResult | null>(null);
  const [history, setHistory] = useState<StoredResult[]>([]);
  const [libraryCode, setLibraryCode] = useState<string | null>(null);

  useEffect(() => { setHistory(loadResults()); }, []);

  const saveResult = useCallback((r: MbtiResult) => {
    const all = [r, ...loadResults()].slice(0, 30);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(all)); } catch {}
    setHistory(all);
  }, []);

  const start = () => { setAnswers({}); setIdx(0); setResult(null); setScreen("quiz"); };

  const pick = (v: number) => {
    const q = MBTI_QUESTIONS[idx];
    setAnswers((a) => ({ ...a, [q.id]: v }));
  };

  // ตอบด้วยคีย์บอร์ด A/B หรือ ลูกศรซ้ายขวา
  useEffect(() => {
    if (screen !== "quiz") return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "a" || e.key === "A" || e.key === "1") pick(0);
      else if (e.key === "b" || e.key === "B" || e.key === "2") pick(1);
      else if (e.key === "ArrowLeft") setIdx((i) => Math.max(0, i - 1));
      else if (e.key === "ArrowRight") setIdx((i) => Math.min(MBTI_QUESTIONS.length - 1, i + 1));
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [screen, idx]);

  const answered = Object.keys(answers).length;
  const progress = Math.round((answered / MBTI_QUESTIONS.length) * 100);
  const q = MBTI_QUESTIONS[idx];

  const finish = () => {
    if (answered < MBTI_QUESTIONS.length) return;
    const r = scoreMbti(answers);
    setResult(r);
    saveResult(r);
    setScreen("result");
  };

  const openLibrary = (code: string | null) => { setLibraryCode(code); setScreen("library"); };

  // ═══════════ หน้าแนะนำ ═══════════
  const introScreen = (
    <div className="space-y-5 max-w-3xl mx-auto w-full">
      <div className="card panel-glow p-8 text-center space-y-4">
        <div className="text-6xl">🧠</div>
        <h2 className="text-xl font-bold glow-text">แบบทดสอบบุคลิกภาพ 16 ประเภท</h2>
        <p className="text-sm text-gray-400 leading-relaxed">
          ชุดคำถาม <b className="text-fuchsia-300">93 ข้อ forced-choice</b> (เลือก A หรือ B — ไม่มีถูกผิด)
          ตามโครงสร้างมาตรฐาน: มุ่งออก–มุ่งเข้า 21 ข้อ · จับต้องได้–นามธรรม 26 ข้อ · ตรรกะ–ความรู้สึก 28 ข้อ · จัดระเบียบ–ล่องลอย 18 ข้อ
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
          {[
            { n: "21", t: "E–I", d: "พลังงาน" },
            { n: "26", t: "S–N", d: "การรับรู้" },
            { n: "28", t: "T–F", d: "การตัดสินใจ" },
            { n: "18", t: "J–P", d: "วิถีชีวิต" },
          ].map((x) => (
            <div key={x.t} className="inset p-3 rounded-lg text-center">
              <div className="text-2xl font-bold text-fuchsia-300">{x.n}</div>
              <div className="text-xs text-gray-300 mt-1">{x.t}</div>
              <div className="text-[10px] text-gray-500">{x.d}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 justify-center pt-2">
          <button onClick={start} className="btn-primary px-6 py-2.5 text-sm">เริ่มทำแบบทดสอบ (10–15 นาที)</button>
          <button onClick={() => openLibrary(null)} className="btn-secondary px-5 py-2.5 text-sm">ดูคลัง 16 ประเภท</button>
        </div>
        <p className="text-[11px] text-gray-500 pt-1">
          🕊️ เวอร์ชันอิงทฤษฎีจัดทำเอง เพื่อความเข้าใจตนเอง — ไม่ใช่เครื่องมือทางการ MBTI® และไม่ใช่การวินิจฉัยทางจิตวิทยา
        </p>
      </div>

      {history.length > 0 && (
        <div className="card p-5">
          <h3 className="text-sm font-bold text-fuchsia-300 mb-3 flex items-center gap-2">
            <Icon name="history" size={14} /> ผลครั้งก่อน ({history.length})
          </h3>
          <div className="space-y-2">
            {history.slice(0, 6).map((h, i) => {
              const info = typeInfo(h.code);
              return (
                <button key={i} onClick={() => { setResult(h); setScreen("result"); }}
                  className="w-full inset px-3 py-2.5 rounded-lg flex items-center gap-3 text-left hover:border-fuchsia-500/40 transition-colors">
                  <span className="text-xl">{info?.emoji ?? "🧩"}</span>
                  <span className="font-bold text-fuchsia-200 w-14">{h.code}</span>
                  <span className="text-sm text-gray-300 flex-1 truncate">{info?.name}</span>
                  <span className="text-xs text-gray-500">{fmtDate(h.date)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  // ═══════════ หน้าทำแบบทดสอบ ═══════════
  const quizScreen = (
    <div className="space-y-4 max-w-3xl mx-auto w-full">
      <div className="flex items-center justify-between text-xs text-gray-400">
        <span>ข้อ {idx + 1} / {MBTI_QUESTIONS.length} — ตอบแล้ว {answered} ข้อ</span>
        <span className="text-fuchsia-400">{progress}%</span>
      </div>
      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className="h-full bg-fuchsia-500 transition-all" style={{ width: `${progress}%` }} />
      </div>

      <div className="card panel-glow p-6 space-y-5">
        <div className="flex items-center gap-2 text-xs">
          <span className="px-2 py-1 rounded bg-gray-800 border border-gray-700 text-gray-300">{DIM_LABEL[q.d].hint}</span>
          <span className="text-gray-500">#{q.id}</span>
          {answers[q.id] != null && <span className="ml-auto text-fuchsia-400 flex items-center gap-1"><Icon name="check-circle" size={12} /> ตอบแล้ว</span>}
        </div>

        <h2 className="text-lg font-bold text-white leading-relaxed text-center py-2">เลือกข้อความที่ "ใช่" กับตัวคุณมากกว่า</h2>

        <div className="grid sm:grid-cols-2 gap-3">
          {[
            { v: 0, label: "A", text: q.a },
            { v: 1, label: "B", text: q.b },
          ].map((o) => (
            <button key={o.v} onClick={() => pick(o.v)}
              className={`p-4 rounded-xl border text-left transition-all ${
                answers[q.id] === o.v
                  ? "bg-fuchsia-600/25 border-fuchsia-500 text-white shadow-[0_0_18px_rgba(217,70,239,0.25)]"
                  : "bg-gray-800/60 border-gray-700 text-gray-200 hover:border-fuchsia-500/50"
              }`}>
              <span className="inline-flex w-6 h-6 rounded-full bg-gray-900 border border-gray-600 items-center justify-center text-xs font-bold mr-2 mb-1">{o.label}</span>
              <span className="text-sm leading-relaxed">{o.text}</span>
            </button>
          ))}
        </div>

        <div className="flex justify-between pt-3 border-t border-gray-800">
          <button onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0}
            className="px-4 py-2 bg-gray-800 disabled:opacity-40 rounded-lg text-sm">← ก่อนหน้า</button>
          {idx < MBTI_QUESTIONS.length - 1 ? (
            <button onClick={() => setIdx((i) => i + 1)} disabled={answers[q.id] == null}
              className="px-5 py-2 bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-40 rounded-lg text-sm text-white">ถัดไป →</button>
          ) : (
            <button onClick={finish} disabled={answered < MBTI_QUESTIONS.length}
              className="px-6 py-2 bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-40 rounded-lg text-sm font-bold text-white">
              {answered < MBTI_QUESTIONS.length ? `ตอบให้ครบอีก ${MBTI_QUESTIONS.length - answered} ข้อ` : "ดูผลลัพธ์ →"}
            </button>
          )}
        </div>
        <p className="text-[11px] text-gray-500 text-center">กด A/B หรือ 1/2 บนคีย์บอร์ดได้ • ลูกศร ← → เลื่อนข้อ • คำตอบเก็บในเบราว์เซอร์นี้เท่านั้น</p>
      </div>

      <div className="flex flex-wrap gap-1.5 justify-center">
        {MBTI_QUESTIONS.map((qq, i) => (
          <button key={qq.id} onClick={() => setIdx(i)}
            className={`w-7 h-7 rounded text-[10px] ${
              i === idx ? "bg-fuchsia-600 text-white"
              : answers[qq.id] != null ? "bg-fuchsia-900/60 text-fuchsia-300 border border-fuchsia-700"
              : "bg-gray-800 text-gray-500"
            }`} title={`ข้อ ${qq.id}`}>{qq.id}</button>
        ))}
      </div>
    </div>
  );

  // ═══════════ หน้าผลลัพธ์ ═══════════
  const resultScreen = () => {
    if (!result) return null;
    const info: MbtiTypeInfo | undefined = typeInfo(result.code);
    const prevSame = history.filter((h) => h.code === result.code).length;
    return (
      <div className="space-y-5 max-w-4xl mx-auto w-full">
        <div className="card panel-glow p-8 text-center space-y-3">
          <div className="text-6xl">{info?.emoji ?? "🧩"}</div>
          <div className="text-4xl font-bold text-fuchsia-300 tracking-widest glow-text">{result.code}</div>
          <div className="text-xl font-bold text-white">{info?.name} — {info?.nameEn}</div>
          <p className="text-sm text-fuchsia-200/80 italic">"{info?.tagline}"</p>
          <p className="text-sm text-gray-400 max-w-2xl mx-auto leading-relaxed">{info?.desc}</p>
          <div className="flex flex-wrap justify-center gap-2 pt-1 text-xs text-gray-500">
            <span className="inset px-2 py-1 rounded">ทำ {fmtDate(result.date)}</span>
            <span className="inset px-2 py-1 rounded">ประมาณ {info?.share}% ของประชากร</span>
            {prevSame > 1 && <span className="inset px-2 py-1 rounded">ได้ผลนี้แล้ว {prevSame} ครั้ง</span>}
          </div>
        </div>

        <div className="card p-5 space-y-4">
          <h3 className="text-sm font-bold text-fuchsia-300 flex items-center gap-2"><Icon name="predictive" size={14} /> คะแนนรายมิติ</h3>
          {result.dims.map((d) => {
            const L = DIM_LABEL[d.dim];
            return (
              <div key={d.dim}>
                <div className="flex justify-between text-xs mb-1">
                  <span className={d.letter === d.first ? "text-fuchsia-300 font-bold" : "text-gray-500"}>{L.first} · {d.firstCount}</span>
                  <span className={d.letter === d.second ? "text-fuchsia-300 font-bold" : "text-gray-500"}>{d.secondCount} · {L.second}</span>
                </div>
                <div className="h-2.5 rounded-full bg-gray-800 overflow-hidden flex" title={`ความชัด ${d.clarity}%`}>
                  <div className="h-full bg-gradient-to-r from-fuchsia-600 to-violet-500" style={{ width: `${d.firstPct}%` }} />
                  <div className="h-full bg-gray-700" style={{ width: `${100 - d.firstPct}%` }} />
                </div>
                <div className="text-[10px] text-gray-500 mt-0.5 text-right">ความชัดเจน {d.clarity}%{d.clarity < 15 ? " — ใกล้เคียงมาก ลองอ่านทั้งสองฝั่งประกอบ" : ""}</div>
              </div>
            );
          })}
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="card p-5">
            <h3 className="text-sm font-bold text-emerald-300 mb-3 flex items-center gap-2"><Icon name="check-circle" size={14} /> จุดแข็ง</h3>
            <ul className="space-y-1.5 text-sm text-gray-300">
              {info?.strengths.map((s) => <li key={s} className="flex gap-2"><span className="text-emerald-400">▸</span>{s}</li>)}
            </ul>
          </div>
          <div className="card p-5">
            <h3 className="text-sm font-bold text-rose-300 mb-3 flex items-center gap-2"><Icon name="alert-triangle" size={14} /> จุดที่ควรระวัง</h3>
            <ul className="space-y-1.5 text-sm text-gray-300">
              {info?.weaknesses.map((s) => <li key={s} className="flex gap-2"><span className="text-rose-400">▸</span>{s}</li>)}
            </ul>
          </div>
          <div className="card p-5">
            <h3 className="text-sm font-bold text-sky-300 mb-3 flex items-center gap-2"><Icon name="knowledge" size={14} /> เส้นทางอาชีพที่เข้ากัน</h3>
            <div className="flex flex-wrap gap-1.5">
              {info?.careers.map((c) => <span key={c} className="px-2.5 py-1 rounded-full bg-gray-800 border border-gray-700 text-xs text-gray-300">{c}</span>)}
            </div>
          </div>
          <div className="card p-5">
            <h3 className="text-sm font-bold text-amber-300 mb-3 flex items-center gap-2"><Icon name="dashboard" size={14} /> เข้ากับบ้านอัจฉริยะนี้อย่างไร</h3>
            <p className="text-sm text-gray-300 leading-relaxed">{info?.homeFit}</p>
            <p className="text-xs text-gray-500 mt-3">✨ คู่ที่มักเข้ากันดี: <b className="text-fuchsia-300">{info?.pair}</b> — ดูรายละเอียดที่คลังประเภท</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 justify-center">
          <button onClick={start} className="btn-secondary px-5 py-2 text-sm">ทำใหม่อีกครั้ง</button>
          <button onClick={() => openLibrary(result.code)} className="btn-secondary px-5 py-2 text-sm">เทียบกับ 16 ประเภท</button>
          <button onClick={() => setScreen("intro")} className="px-4 py-2 bg-gray-800 rounded-lg text-sm">← กลับหน้าหลัก MBTI</button>
        </div>
      </div>
    );
  };

  // ═══════════ คลัง 16 ประเภท ═══════════
  const libraryScreen = (
    <div className="space-y-4 w-full">
      {libraryCode && (
        <button onClick={() => setLibraryCode(null)} className="text-xs text-gray-400 hover:text-white flex items-center gap-1">
          ← ดูทั้ง 16 ประเภท
        </button>
      )}
      {!libraryCode ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[["นักวิเคราะห์ (NT)", ["INTJ", "INTP", "ENTJ", "ENTP"], "violet"],
              ["นักการทูต (NF)", ["INFJ", "INFP", "ENFJ", "ENFP"], "pink"],
              ["ผู้พิทักษ์ (SJ)", ["ISTJ", "ISFJ", "ESTJ", "ESFJ"], "sky"],
              ["นักสำรวจ (SP)", ["ISTP", "ISFP", "ESTP", "ESFP"], "amber"]].map(([group, codes, color]) => (
              <div key={group as string} className="card p-3">
                <div className="text-xs font-bold text-gray-300 mb-2">{group as string}</div>
                <div className="space-y-1.5">
                  {(codes as string[]).map((c) => {
                    const t = typeInfo(c)!;
                    return (
                      <button key={c} onClick={() => setLibraryCode(c)}
                        className="w-full inset px-2.5 py-2 rounded-lg flex items-center gap-2 text-left hover:border-fuchsia-500/40 transition-colors">
                        <span className="text-lg">{t.emoji}</span>
                        <span className="text-xs font-bold text-fuchsia-200 w-11">{c}</span>
                        <span className="text-xs text-gray-400 truncate">{t.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="card p-5">
            <h3 className="text-sm font-bold text-fuchsia-300 mb-3">เทียบความหายาก (% ประชากรโดยประมาณ)</h3>
            <div className="space-y-1.5">
              {[...MBTI_TYPES].sort((a, b) => a.share - b.share).map((t) => (
                <button key={t.code} onClick={() => setLibraryCode(t.code)} className="w-full flex items-center gap-2 text-left group">
                  <span className="text-xs w-12 text-gray-400 group-hover:text-white">{t.code}</span>
                  <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-violet-600 to-fuchsia-500" style={{ width: `${Math.min(100, (t.share / 14) * 100)}%` }} />
                  </div>
                  <span className="text-[10px] text-gray-500 w-10 text-right">{t.share}%</span>
                </button>
              ))}
            </div>
          </div>
        </>
      ) : (() => {
        const t = typeInfo(libraryCode)!;
        return (
          <div className="space-y-4">
            <div className="card panel-glow p-6 space-y-2">
              <div className="flex items-center gap-3">
                <span className="text-4xl">{t.emoji}</span>
                <div>
                  <div className="text-2xl font-bold text-fuchsia-300">{t.code} — {t.name}</div>
                  <div className="text-sm text-gray-400">{t.nameEn} · ~{t.share}% ของประชากร · คู่เข้ากัน: {t.pair}</div>
                </div>
              </div>
              <p className="text-sm text-fuchsia-200/80 italic">"{t.tagline}"</p>
              <p className="text-sm text-gray-300 leading-relaxed">{t.desc}</p>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="card p-5">
                <h3 className="text-sm font-bold text-emerald-300 mb-2">จุดแข็ง</h3>
                <ul className="space-y-1.5 text-sm text-gray-300">{t.strengths.map((s) => <li key={s} className="flex gap-2"><span className="text-emerald-400">▸</span>{s}</li>)}</ul>
              </div>
              <div className="card p-5">
                <h3 className="text-sm font-bold text-rose-300 mb-2">จุดที่ควรระวัง</h3>
                <ul className="space-y-1.5 text-sm text-gray-300">{t.weaknesses.map((s) => <li key={s} className="flex gap-2"><span className="text-rose-400">▸</span>{s}</li>)}</ul>
              </div>
              <div className="card p-5">
                <h3 className="text-sm font-bold text-sky-300 mb-2">อาชีพที่เข้ากัน</h3>
                <div className="flex flex-wrap gap-1.5">{t.careers.map((c) => <span key={c} className="px-2.5 py-1 rounded-full bg-gray-800 border border-gray-700 text-xs text-gray-300">{c}</span>)}</div>
              </div>
              <div className="card p-5">
                <h3 className="text-sm font-bold text-amber-300 mb-2">ในบ้านอัจฉริยะนี้</h3>
                <p className="text-sm text-gray-300 leading-relaxed">{t.homeFit}</p>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );

  const eyebrow = "ชีวิต & สุขภาพ";
  const titles: Record<Screen, string> = {
    intro: "MBTI — รู้จักตัวเอง 16 ประเภท",
    quiz: "แบบทดสอบ — 93 ข้อ",
    result: "ผลลัพธ์ของคุณ",
    library: "คลัง 16 ประเภท",
  };

  return (
    <div className="atmo-mind min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <PageHeader
          eyebrow={eyebrow}
          title={titles[screen]}
          subtitle="Local-First — ทำเอง เก็บเองในเบราว์เซอร์ ไม่ส่งข้อมูลออกนอกเครื่อง"
          icon={<Icon name="healing" size={18} />}
          actions={
            <div className="flex gap-2 text-sm">
              <button onClick={() => setScreen("intro")} className={screen === "intro" ? "text-fuchsia-300 font-bold" : "text-gray-400 hover:text-white"}>หน้าหลัก</button>
              <span className="text-gray-700">·</span>
              <button onClick={() => openLibrary(null)} className={screen === "library" ? "text-fuchsia-300 font-bold" : "text-gray-400 hover:text-white"}>คลัง 16 ประเภท</button>
            </div>
          }
        />
        <main className="flex-1 p-4 lg:p-6 w-full">
          {screen === "intro" && introScreen}
          {screen === "quiz" && quizScreen}
          {screen === "result" && resultScreen()}
          {screen === "library" && libraryScreen}
        </main>
      </div>
    </div>
  );
}
