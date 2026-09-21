"use client";
// ─────────────────────────────────────────────────────────────
//  MBTI — แบบทดสอบบุคลิกภาพ 16 ประเภท (Local-First)
//  โครงเดียวกับ Self-Check: ทำเอง เก็บเอง ไม่พึ่งเซิร์ฟเวอร์
//  ธีมบรรยากาศ: atmo-mind (ม่วงอเมทิสต์ — ห้องสะท้อนความคิด)
//  โหมด: หน้าหลัก · ชุดเต็ม 93 · ควิซสั้น 32 · ผลลัพธ์ · คลัง 16 · เทียบสองคน · วิวัฒนาการ
// ─────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from "react";
import Sidebar from "../components/layout/Sidebar";
import PageHeader from "../components/ui/PageHeader";
import Icon from "../components/ui/Icon";
import Link from "next/link";
import {
  MBTI_QUESTIONS, MBTI_SHORT_QUESTIONS, MBTI_TYPES, MBTI_STORE_KEY,
  scoreMbti, typeInfo, familyOf, FAM_RGB, MBTI_DIM_INFO, careToneFor,
  type MbtiResult, type MbtiTypeInfo, type MbtiQuestion,
} from "../lib/mbtiData";
import { authFetch } from "../lib/apiFetch";
import { useLanguageStore } from "../stores/useLanguageStore";
import Seal from "../components/mbti/Seal";
import QuizCard from "../components/mbti/QuizCard";

const DIM_LABEL: Record<string, { first: string; second: string; hint: string }> = {
  EI: { first: "E — มุ่งออก (Extraversion)", second: "I — มุ่งเข้า (Introversion)", hint: "พลังงานมาจากไหน" },
  SN: { first: "S — จับต้องได้ (Sensing)", second: "N — นามธรรม (Intuition)", hint: "รับข้อมูลโลกแบบไหน" },
  TF: { first: "T — ตรรกะ (Thinking)", second: "F — ความรู้สึก (Feeling)", hint: "ตัดสินใจด้วยอะไร" },
  JP: { first: "J — จัดระเบียบ (Judging)", second: "P — ล่องลอย (Perceiving)", hint: "ใช้ชีวิตแบบไหน" },
};

type Screen = "intro" | "quiz" | "result" | "library" | "evolution";

function loadResults(): MbtiResult[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(MBTI_STORE_KEY) || "[]"); } catch { return []; }
}

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" }); } catch { return iso.slice(0, 10); }
}

/** ชื่อโหมดชุดคำถามที่ใช้ — จากจำนวนข้อที่ตอบ */
function quizModeOf(r: MbtiResult): "เต็ม 93" | "สั้น 32" {
  return r.answered <= 32 ? "สั้น 32" : "เต็ม 93";
}

export default function MbtiPage() {
  const t = useLanguageStore((s) => s.t);
  const [screen, setScreen] = useState<Screen>("intro");
  const [mode, setMode] = useState<"full" | "short">("full");
  const [result, setResult] = useState<MbtiResult | null>(null);
  const [history, setHistory] = useState<MbtiResult[]>([]);
  const [libraryCode, setLibraryCode] = useState<string | null>(null);

  useEffect(() => { setHistory(loadResults()); }, []);

  const saveResult = useCallback((r: MbtiResult) => {
    const all = [r, ...loadResults()].slice(0, 30);
    try { localStorage.setItem(MBTI_STORE_KEY, JSON.stringify(all)); } catch {}
    setHistory(all);
  }, []);

  const questions: MbtiQuestion[] = mode === "short" ? MBTI_SHORT_QUESTIONS : MBTI_QUESTIONS;

  const start = (m: "full" | "short") => {
    setMode(m); setResult(null); setScreen("quiz");
  };

  const finish = (answers: Record<number, number>) => {
    const r = scoreMbti(answers, questions);
    setResult(r);
    saveResult(r);
    setScreen("result");
  };

  const openLibrary = (code: string | null) => { setLibraryCode(code); setScreen("library"); };

  // 🙏 ให้หลวงพี่อธิบายผล — เรียก companion พร้อมโค้ดประเภทจริง (backend ปรับโทนตามประเภท 16 แบบ)
  const [monkReply, setMonkReply] = useState<string | null>(null);
  const [monkBusy, setMonkBusy] = useState(false);
  const [monkError, setMonkError] = useState<string | null>(null);
  useEffect(() => { setMonkReply(null); setMonkError(null); }, [result]);

  const askMonk = async () => {
    if (!result || monkBusy) return;
    setMonkBusy(true); setMonkError(null); setMonkReply(null);
    try {
      const r = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/healing/companion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `ช่วยอธิบายผลแบบทดสอบบุคลิกภาพของฉัน (${result.code}) หน่อย — คนแบบนี้ควรดูแลใจตัวเองอย่างไรดี`,
          mbti: result.code,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.reply) {
        setMonkError(j.error || t('mbti.monk.errorOffline', 'หลวงพี่ตอบไม่ได้ตอนนี้ — ตรวจว่า AI (Ollama) เปิดอยู่'));
        return;
      }
      setMonkReply(j.teaching?.title ? `${j.reply}\n\n📿 ${j.teaching.title}` : j.reply);
    } catch {
      setMonkError(t('mbti.monk.errorConn', 'เชื่อมต่อ Core API ไม่ได้'));
    } finally {
      setMonkBusy(false);
    }
  };

  // ═══════════ หน้าแนะนำ ═══════════
  const introScreen = (
    <div className="space-y-5 max-w-3xl mx-auto w-full">
      <div className="card panel-glow p-8 text-center space-y-4">
        <div className="text-6xl">🧠</div>
        <h2 className="text-xl font-bold glow-text">{t('mbti.page.introTitle', 'แบบทดสอบบุคลิกภาพ 16 ประเภท')}</h2>
        <p className="text-sm text-gray-400 leading-relaxed">
          {t('mbti.page.introDesc', 'forced-choice เลือก A หรือ B — ไม่มีถูกผิด · ครบ 4 มิติ: มุ่งออก–มุ่งเข้า · จับต้องได้–นามธรรม · ตรรกะ–ความรู้สึก · จัดระเบียบ–ล่องลอย')}
        </p>
        <div className="grid sm:grid-cols-2 gap-3 pt-2">
          <button onClick={() => start("short")} className="inset rounded-xl p-4 text-left hover:border-fuchsia-500/40 transition-colors">
            <div className="text-sm font-bold text-fuchsia-300 flex items-center gap-2">{t('mbti.page.shortTitle', '📱 ควิซสั้น 32 ข้อ')} <span className="text-[10px] px-1.5 py-0.5 rounded bg-fuchsia-900/60 text-fuchsia-200">{t('mbti.page.shortBadge', '5–7 นาที')}</span></div>
            <div className="text-xs text-gray-400 mt-1">{t('mbti.page.shortHint', 'เหมาะกับมือถือและมือใหม่ — ได้ผลตัวอักษร 4 ตัวเหมือนกัน')}</div>
          </button>
          <button onClick={() => start("full")} className="inset rounded-xl p-4 text-left hover:border-fuchsia-500/40 transition-colors">
            <div className="text-sm font-bold text-fuchsia-300 flex items-center gap-2">{t('mbti.page.fullTitle', '📋 ชุดเต็ม 93 ข้อ')} <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">{t('mbti.page.fullBadge', '10–15 นาที')}</span></div>
            <div className="text-xs text-gray-400 mt-1">{t('mbti.page.fullHint', 'แม่นยำตามโครงมาตรฐาน (21·26·28·18) — ควรทำเมื่อมีเวลา')}</div>
          </button>
        </div>
        <div className="flex flex-wrap gap-2 justify-center pt-1">
          <button onClick={() => openLibrary(null)} className="btn-secondary px-5 py-2.5 text-sm">{t('mbti.page.openLibrary', 'ดูคลัง 16 ประเภท')}</button>
          <Link href="/mbti/compare" className="btn-secondary px-5 py-2.5 text-sm inline-flex items-center gap-1.5">⚖️ เทียบผลกับคนรัก/ครอบครัว</Link>
          {history.length >= 2 && (
            <button onClick={() => setScreen("evolution")} className="btn-secondary px-5 py-2.5 text-sm">📈 วิวัฒนาการของฉัน</button>
          )}
        </div>
        <p className="text-[11px] text-gray-500 pt-1">
          🕊️ เวอร์ชันอิงทฤษฎีจัดทำเอง เพื่อความเข้าใจตนเอง — ไม่ใช่เครื่องมือทางการ MBTI® และไม่ใช่การวินิจฉัยทางจิตวิทยา
        </p>
      </div>

      {history.length > 0 && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-fuchsia-300 flex items-center gap-2"><Icon name="history" size={14} /> ผลครั้งก่อน ({history.length})</h3>
            {history.length >= 2 && (
              <button onClick={() => setScreen("evolution")} className="text-xs text-fuchsia-300 hover:underline">{t('mbti.page.viewEvolution', 'ดูกราฟย้อนหลัง →')}</button>
            )}
          </div>
          <div className="space-y-2">
            {history.slice(0, 6).map((h, i) => {
              const info = typeInfo(h.code);
              return (
                <button key={i} onClick={() => { setResult(h); setScreen("result"); }}
                  className="w-full inset px-3 py-2.5 rounded-lg flex items-center gap-3 text-left hover:border-fuchsia-500/40 transition-colors">
                  <span className="text-xl">{info?.emoji ?? "🧩"}</span>
                  <span className="font-bold text-fuchsia-200 w-14">{h.code}</span>
                  <span className="text-sm text-gray-300 flex-1 truncate">{info?.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">{quizModeOf(h)}</span>
                  <span className="text-xs text-gray-500">{fmtDate(h.date)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  // ═══════════ หน้าทำแบบทดสอบ (ใช้ได้ทั้งชุดเต็ม/ชุดสั้น) ═══════════
  const quizScreen = (
    <QuizCard
      key={mode}
      variant="page"
      questions={questions}
      modeLabel={mode === "short" ? "ควิซสั้น" : "ชุดเต็ม"}
      onDone={finish}
      onSwitchFull={mode === "short" ? () => start("full") : undefined}
    />
  );

  // ═══════════ หน้าผลลัพธ์ ═══════════
  const resultScreen = () => {
    if (!result) return null;
    const info: MbtiTypeInfo | undefined = typeInfo(result.code);
    const isShort = quizModeOf(result) === "สั้น 32";
    const prevSame = history.filter((h) => h.code === result.code).length;
    return (
      <div className="space-y-5 max-w-4xl mx-auto w-full">
        <div className="card panel-glow p-8 space-y-3">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-6 sm:gap-10">
            <div className="text-center space-y-2 order-2 sm:order-1">
              <div className="text-6xl">{info?.emoji ?? "🧩"}</div>
              <div className="text-4xl mbti-serif font-bold text-fuchsia-300 tracking-widest glow-text">{result.code}</div>
              <div className="text-xl font-bold text-white">{info?.name} — {info?.nameEn}</div>
              <p className="text-sm text-fuchsia-200/80 italic">&quot;{info?.tagline}&quot;</p>
            </div>
            <div className="order-1 sm:order-2">
              <Seal letters={result.code} dims={result.dims} famRgb={FAM_RGB[familyOf(result.code) ?? "nt"]} />
            </div>
          </div>
          <p className="text-sm text-gray-400 max-w-2xl mx-auto leading-relaxed">{info?.desc}</p>
          <div className="flex flex-wrap justify-center gap-2 pt-1 text-xs text-gray-500">
            <span className="inset px-2 py-1 rounded">{t('mbti.result.taken', 'ทำ {date}', { date: fmtDate(result.date) })}</span>
            <span className="inset px-2 py-1 rounded">{quizModeOf(result)}</span>
            <span className="inset px-2 py-1 rounded">{t('mbti.result.rarity', 'ประมาณ {share}% ของประชากร', { share: info?.share })}</span>
            {prevSame > 1 && <span className="inset px-2 py-1 rounded">{t('mbti.result.timesBefore', 'ได้ผลนี้แล้ว {n} ครั้ง', { n: prevSame })}</span>}
          </div>
          {isShort && (
            <div className="inset rounded-lg p-3 text-xs text-amber-200/90 max-w-xl mx-auto">
              📱 นี่คือผลจากควิซสั้น 32 ข้อ (ประเมินเบื้องต้น) —{" "}
              <button onClick={() => start("full")} className="text-fuchsia-300 underline">{t('mbti.result.retakeFull', 'ทำชุดเต็ม 93 ข้อ')}</button>{t('mbti.result.retakeFullSuffix', ' เพื่อยืนยันความแม่นยำ')}
            </div>
          )}
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
                <div className="text-[10px] text-gray-500 mt-0.5 text-right">{t('mbti.result.clarity', 'ความชัดเจน {pct}%', { pct: d.clarity })}{d.clarity < 15 ? t('mbti.result.clarityNear', ' — ใกล้เคียงมาก ลองอ่านทั้งสองฝั่งประกอบ') : ""}</div>
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
            <p className="text-xs text-gray-500 mt-3">{t('mbti.result.goodPair', '✨ คู่ที่มักเข้ากันดี')}: <b className="text-fuchsia-300">{info?.pair}</b> — <Link href="/mbti/compare" className="underline">{t('mbti.result.compareImportant', 'เทียบกับคนสำคัญ')}</Link></p>
          </div>
        </div>

        {(monkBusy || monkReply || monkError) && (
          <div className="card p-5 space-y-2">
            <h3 className="text-sm font-bold text-amber-300 flex items-center gap-2">
              🙏 {careToneFor(result.code)?.yakLabel ?? "หลวงพี่"} อธิบายผล {result.code}
            </h3>
            {monkBusy && <p className="text-xs text-gray-500">{t('mbti.monk.busy', 'หลวงพี่กำลังพิจารณา... (อาจใช้เวลานานในเครื่อง CPU)')}</p>}
            {monkError && <p className="text-xs text-rose-300">{monkError}</p>}
            {monkReply && (
              <div className="inset rounded-lg p-3 text-sm leading-relaxed whitespace-pre-wrap text-gray-200 border-l-2 border-l-amber-400/70">
                {monkReply}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2 justify-center">
          <button onClick={askMonk} disabled={monkBusy} className="btn-secondary px-5 py-2 text-sm">
            {monkBusy ? "หลวงพี่กำลังพิจารณา..." : "🙏 ให้หลวงพี่อธิบายผลของคุณ"}
          </button>
          <button onClick={() => start(mode)} className="btn-secondary px-5 py-2 text-sm">{t('mbti.result.retake', 'ทำใหม่อีกครั้ง')}</button>
          <button onClick={() => openLibrary(result.code)} className="btn-secondary px-5 py-2 text-sm">{t('mbti.result.compare16', 'เทียบกับ 16 ประเภท')}</button>
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
            {[["นักวิเคราะห์ (NT)", ["INTJ", "INTP", "ENTJ", "ENTP"]],
              ["นักการทูต (NF)", ["INFJ", "INFP", "ENFJ", "ENFP"]],
              ["ผู้พิทักษ์ (SJ)", ["ISTJ", "ISFJ", "ESTJ", "ESFJ"]],
              ["นักสำรวจ (SP)", ["ISTP", "ISFP", "ESTP", "ESFP"]]].map(([group, codes]) => (
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
            <h3 className="text-sm font-bold text-fuchsia-300 mb-3">{t('mbti.result.rarityCompare', 'เทียบความหายาก (% ประชากรโดยประมาณ)')}</h3>
            <div className="space-y-1.5">
              {[...MBTI_TYPES].sort((a, b) => a.share - b.share).map((t) => (
                <button key={t.code} onClick={() => setLibraryCode(t.code)} className="w-full flex items-center gap-2 text-left group">
                  <span className="text-xs w-12 text-gray-400 group-hover:text-white" style={{ borderBottom: `2px solid rgb(${FAM_RGB[familyOf(t.code) ?? "nt"]})` }}>{t.code}</span>
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
        const info = typeInfo(libraryCode)!;
        return (
          <div className="space-y-4">
            <div className="card panel-glow p-6 space-y-2">
              <div className="flex items-center gap-3">
                <span className="text-4xl">{info.emoji}</span>
                <div>
                  <div className="text-2xl mbti-serif font-bold" style={{ color: `rgb(${FAM_RGB[familyOf(info.code) ?? "nt"]})` }}>{info.code} — {info.name}</div>
                  <div className="text-sm text-gray-400">{info.nameEn} · ~{info.share}% ของประชากร · คู่เข้ากัน: {info.pair}</div>
                </div>
              </div>
              <p className="text-sm text-fuchsia-200/80 italic">&quot;{info.tagline}&quot;</p>
              <p className="text-sm text-gray-300 leading-relaxed">{info.desc}</p>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="card p-5">
                <h3 className="text-sm font-bold text-emerald-300 mb-2">{t('mbti.result.strengths', 'จุดแข็ง')}</h3>
                <ul className="space-y-1.5 text-sm text-gray-300">{info.strengths.map((s) => <li key={s} className="flex gap-2"><span className="text-emerald-400">▸</span>{s}</li>)}</ul>
              </div>
              <div className="card p-5">
                <h3 className="text-sm font-bold text-rose-300 mb-2">{t('mbti.result.watchouts', 'จุดที่ควรระวัง')}</h3>
                <ul className="space-y-1.5 text-sm text-gray-300">{info.weaknesses.map((s) => <li key={s} className="flex gap-2"><span className="text-rose-400">▸</span>{s}</li>)}</ul>
              </div>
              <div className="card p-5">
                <h3 className="text-sm font-bold text-sky-300 mb-2">{t('mbti.result.careers', 'อาชีพที่เข้ากัน')}</h3>
                <div className="flex flex-wrap gap-1.5">{info.careers.map((c) => <span key={c} className="px-2.5 py-1 rounded-full bg-gray-800 border border-gray-700 text-xs text-gray-300">{c}</span>)}</div>
              </div>
              <div className="card p-5">
                <h3 className="text-sm font-bold text-amber-300 mb-2">{t('mbti.result.homeFitTitle', 'ในบ้านอัจฉริยะนี้')}</h3>
                <p className="text-sm text-gray-300 leading-relaxed">{info.homeFit}</p>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );

  // ═══════════ วิวัฒนาการ (กราฟย้อนหลัง) ═══════════
  const evolutionScreen = (() => {
    // เรียงเก่า → ใหม่ (ใหม่อยู่ขวาสุด) — แยกชุดเต็มกับชุดสั้นออกจากกัน
    const all = [...history].reverse();
    const full = all.filter((r) => quizModeOf(r) === "เต็ม 93");
    const short = all.filter((r) => quizModeOf(r) === "สั้น 32");
    if (all.length < 2) {
      return (
        <div className="card p-8 text-center max-w-xl mx-auto">
          <div className="text-5xl mb-3">📈</div>
          <h3 className="text-lg font-bold mb-2">{t('mbti.evolution.needTwo', 'ต้องมีผลอย่างน้อย 2 ครั้ง')}</h3>
          <p className="text-sm text-gray-400 mb-4">{t('mbti.evolution.needTwoHint', 'ทำแบบทดสอบซ้ำในวันต่างกัน (แนะนำเว้น 2–4 สัปดาห์ หลังเหตุการณ์สำคัญในชีวิต) แล้วกราฟนี้จะแสดงการเปลี่ยนแปลงรายมิติ')}</p>
          <button onClick={() => start("short")} className="btn-primary px-5 py-2 text-sm">{t('mbti.evolution.startShort', 'เริ่มควิซสั้น 32 ข้อ')}</button>
        </div>
      );
    }
    const W = 640, H = 200, PAD_L = 46, PAD_R = 16, PAD_T = 14, PAD_B = 30;
    const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
    // ความหมายแกน: 0% = ตัวอักษรแรก (E/S/T/J) เต็มขวา, 100% = ตัวอักษรที่สอง (I/N/F/P)
    const dims = ["EI", "SN", "TF", "JP"] as const;
    const dimColors: Record<string, string> = { EI: "#fbbf24", SN: "#38bdf8", TF: "#34d399", JP: "#c084fc" };
    const series = (list: MbtiResult[]) => dims.map((dim) => {
      const pts = list.map((r, i) => {
        const d = r.dims.find((x) => x.dim === dim);
        const secondPct = d ? 100 - d.firstPct : 50; // 0=ฝั่งแรก 100=ฝั่งสอง
        return { x: PAD_L + (list.length === 1 ? plotW / 2 : (i / (list.length - 1)) * plotW), y: PAD_T + (1 - secondPct / 100) * plotH, pct: secondPct, code: r.code };
      });
      return { dim, pts };
    });
    const seriesList = [
      ...(full.length >= 1 ? [{ label: "ชุดเต็ม 93", list: full, dash: "" }] : []),
      ...(short.length >= 1 ? [{ label: "ควิซสั้น 32", list: short, dash: "4 4" }] : []),
    ];
    return (
      <div className="space-y-4 max-w-4xl mx-auto w-full">
        <div className="card panel-glow p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-fuchsia-300 flex items-center gap-2"><Icon name="predictive" size={14} /> วิวัฒนาการรายมิติ ({all.length} ครั้ง)</h3>
            <div className="flex gap-3 text-[11px] text-gray-400">
              {full.length >= 1 && <span><span className="inline-block w-4 border-t-2 border-fuchsia-400 align-middle mr-1" />{t('mbti.evolution.legendFull93', 'ชุดเต็ม 93')}</span>}
              {short.length >= 1 && <span><span className="inline-block w-4 border-t-2 border-dashed border-sky-400 align-middle mr-1" />{t('mbti.evolution.legendShort32', 'ควิซสั้น 32')}</span>}
            </div>
          </div>
          <div className="overflow-x-auto">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[520px]" role="img" aria-label="กราฟวิวัฒนาการ MBTI รายมิติ">
              {/* กริด + ป้ายแกนซ้าย/ขวา */}
              {[0, 0.5, 1].map((f) => (
                <line key={f} x1={PAD_L} x2={W - PAD_R} y1={PAD_T + f * plotH} y2={PAD_T + f * plotH} stroke="#374151" strokeDasharray={f === 0.5 ? "3 4" : ""} strokeWidth="1" />
              ))}
              {/* เส้นข้อมูล */}
              {seriesList.map((s) => series(s.list).map(({ dim, pts }) => (
                <g key={s.label + dim}>
                  <polyline
                    points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill="none"
                    stroke={dimColors[dim]}
                    strokeWidth={s.dash ? 1.6 : 2.4}
                    strokeDasharray={s.dash || undefined}
                    opacity={s.dash ? 0.65 : 0.95}
                  />
                  {pts.map((p, i) => (
                    <g key={i}>
                      <circle cx={p.x} cy={p.y} r={4.5} fill={dimColors[dim]} opacity={s.dash ? 0.5 : 0.95}>
                        <title>{`${MBTI_DIM_INFO[dim].hint}: ${p.pct}% ฝั่ง${MBTI_DIM_INFO[dim].secondShort} (${p.code}, ${fmtDate(s.list[i].date)})`}</title>
                      </circle>
                      {i === pts.length - 1 && (
                        <text x={p.x + 7} y={p.y + 3} fontSize="9" fill={dimColors[dim]} opacity="0.9">{s.label}</text>
                      )}
                    </g>
                  ))}
                </g>
              )))}
              {/* ป้ายวันที่ใต้แกน (อิงชุดที่มีจุดมากที่สุด) */}
              {(() => {
                const ref = full.length >= short.length ? full : short;
                return ref.map((r, i) => (
                  <text key={i} x={PAD_L + (ref.length === 1 ? plotW / 2 : (i / (ref.length - 1)) * plotW)} y={H - 8} fontSize="8.5" fill="#9ca3af" textAnchor={i === 0 ? "start" : i === ref.length - 1 ? "end" : "middle"}>
                    {new Date(r.date).toLocaleDateString("th-TH", { month: "short", day: "numeric" })}·{r.code}
                  </text>
                ));
              })()}
            </svg>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-400">
            {dims.map((dim) => (
              <span key={dim} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: dimColors[dim] }} />
                <b className="text-gray-300">{MBTI_DIM_INFO[dim].hint}</b> — ล่าง = {MBTI_DIM_INFO[dim].firstShort} · บน = {MBTI_DIM_INFO[dim].secondShort}
              </span>
            ))}
          </div>
        </div>

        {/* ตราซ้อน: เงา (เก่าสุด) → เต็ม (ใหม่สุด) — ส่วนสีเลื่อนข้ามมิติเมื่อเวลาผ่านไป */}
        {all.length >= 2 && (() => {
          const oldest = all[0], newest = all[all.length - 1];
          const famOf = (code: string) => FAM_RGB[familyOf(code) ?? "nt"];
          return (
            <div className="card p-5">
              <h3 className="text-sm font-bold text-fuchsia-300 mb-3">{t('mbti.evolution.overlayTitle', 'ตราซ้อน — จาก {oldest} → {newest}', { oldest: oldest.code, newest: newest.code })}</h3>
              <div className="flex flex-wrap items-center justify-center gap-6">
                <div className="relative">
                  <Seal letters={oldest.code} dims={oldest.dims} famRgb={famOf(oldest.code)} ghost />
                  <Seal letters={newest.code} dims={newest.dims} famRgb={famOf(newest.code)}
                    className="absolute inset-0" />
                </div>
                <div className="space-y-1.5 text-xs">
                  <div><span className="inline-block w-3 h-3 rounded-full border-2 border-fuchsia-400 align-middle mr-1.5" />{t('mbti.evolution.shadowLegend', 'เงา = {date} ({code})', { date: fmtDate(oldest.date), code: oldest.code })}</div>
                  <div><span className="inline-block w-3 h-3 rounded-full align-middle mr-1.5" style={{ background: `rgb(${famOf(newest.code)})` }} />{t('mbti.evolution.solidLegend', 'เต็ม = {date} ({code})', { date: fmtDate(newest.date), code: newest.code })}</div>
                  {oldest.code !== newest.code && <div className="text-gray-500">{t('mbti.evolution.overlapHint', 'ส่วนที่สีทับเงา = มิติที่เลื่อนข้ามตัวอักษร')}</div>}
                </div>
              </div>
            </div>
          );
        })()}

        {/* สรุปการเปลี่ยนแปลง */}
        {all.length >= 2 && (() => {
          const oldest = all[0], newest = all[all.length - 1];
          const changes = dims.map((dim) => {
            const d1 = oldest.dims.find((x) => x.dim === dim);
            const d2 = newest.dims.find((x) => x.dim === dim);
            const letter1 = d1?.letter ?? "?", letter2 = d2?.letter ?? "?";
            const shift = d1 && d2 ? d2.firstPct - d1.firstPct : 0;
            return { dim, letter1, letter2, changed: letter1 !== letter2, shift };
          });
          const changed = changes.filter((c) => c.changed);
          return (
            <div className="card p-5 space-y-2">
              <h3 className="text-sm font-bold text-fuchsia-300">{t('mbti.evolution.changeSummary', 'สรุปการเปลี่ยนแปลง')}</h3>
              <p className="text-sm text-gray-300">
                {fmtDate(oldest.date)} คุณเป็น <b className="text-fuchsia-300">{oldest.code}</b> → ล่าสุด ({fmtDate(newest.date)}) เป็น <b className="text-fuchsia-300">{newest.code}</b>
              </p>
              {changed.length === 0 ? (
                <p className="text-sm text-emerald-300">✅ ตัวอักษรทั้ง 4 ตัวมั่นคง — บุคลิกภาพของคุณสอดคล้องกันดีระหว่างสองช่วงเวลา</p>
              ) : (
                <div className="space-y-1.5">
                  {changed.map((c) => (
                    <div key={c.dim} className="inset rounded-lg px-3 py-2 text-sm">
                      <b className="text-amber-300">{DIM_LABEL[c.dim].hint}</b> เปลี่ยนจาก {c.letter1} → {c.letter2}
                      <span className="text-xs text-gray-500 ml-2">(คะแนนเลื่อน {Math.abs(c.shift)}%)</span>
                    </div>
                  ))}
                  <p className="text-xs text-gray-500 pt-1">💡 มิติที่เปลี่ยนบ่อยคือมิติที่คุณ &quot;ยืดหยุ่น&quot; มากที่สุด — ไม่ใช่ความผิดพลาด แต่คือบริบทชีวิตที่เปลี่ยนไป</p>
                </div>
              )}
              {(() => {
                const avg = dims.map((dim) => {
                  const cl = all.map((r) => r.dims.find((x) => x.dim === dim)?.clarity ?? 0);
                  return Math.round(cl.reduce((a, b) => a + b, 0) / cl.length);
                });
                return (
                  <p className="text-xs text-gray-500">
                    ความชัดเจนเฉลี่ยรายมิติ: {dims.map((d, i) => `${DIM_LABEL[d].hint} ${avg[i]}%`).join(" · ")}
                  </p>
                );
              })()}
            </div>
          );
        })()}
      </div>
    );
  })();

  const titles: Record<Screen, string> = {
    intro: t("mbti.page.introTitle", "แบบทดสอบบุคลิกภาพ 16 ประเภท"),
    quiz: mode === "short" ? t("mbti.page.shortTitle", "📱 ควิซสั้น 32 ข้อ") : t("mbti.page.fullTitle", "📋 ชุดเต็ม 93 ข้อ"),
    result: t("mbti.result.title", "ผลลัพธ์ของคุณ"),
    library: t("mbti.page.openLibrary", "ดูคลัง 16 ประเภท"),
    evolution: t("mbti.evolution.title", "วิวัฒนาการของฉัน"),
  };

  const navBtn = (key: Screen, label: string) => (
    <button onClick={() => setScreen(key)} className={screen === key ? "text-fuchsia-300 font-bold" : "text-gray-400 hover:text-white"}>{label}</button>
  );

  return (
    <div className="atmo-mind min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <PageHeader
          eyebrow={t("mbti.page.eyebrow", "ชีวิต & สุขภาพ")}
          title={titles[screen]}
          subtitle={t("mbti.page.localFirst", "Local-First — ทำเอง เก็บเองในเบราว์เซอร์ ไม่ส่งข้อมูลออกนอกเครื่อง")}
          icon={<Icon name="healing" size={18} />}
          actions={
            <div className="flex gap-2 text-sm flex-wrap items-center">
              {navBtn("intro", t("common.nav.dashboard", "หน้าหลัก"))}
              <span className="text-gray-700">·</span>
              {navBtn("library", t("mbti.page.openLibrary", "ดูคลัง 16 ประเภท"))}
              {history.length >= 2 && <>
                <span className="text-gray-700">·</span>
                {navBtn("evolution", t("mbti.page.viewEvolution", "ดูกราฟย้อนหลัง →"))}
              </>}
              <span className="text-gray-700">·</span>
              <Link href="/mbti/compare" className="text-gray-400 hover:text-white">{t("mbti.page.compareLink", "⚖️ เทียบผลกับคนรัก/ครอบครัว")}</Link>
            </div>
          }
        />
        <main className="flex-1 p-4 lg:p-6 w-full">
          {screen === "intro" && introScreen}
          {screen === "quiz" && quizScreen}
          {screen === "result" && resultScreen()}
          {screen === "library" && libraryScreen}
          {screen === "evolution" && evolutionScreen}
        </main>
      </div>
    </div>
  );
}
