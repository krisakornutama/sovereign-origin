"use client";
import { useState, useRef, useEffect } from "react";
import { useAuthStore } from "../../stores/useAuthStore";
import { authFetch } from "../../lib/apiFetch";
import Sidebar from "../../components/layout/Sidebar";
import PageHeader from "../../components/ui/PageHeader";
import Icon from "../../components/ui/Icon";
import { useLanguageStore } from "../../stores/useLanguageStore";
import Link from "next/link";

type HealthCategory = "SLEEP" | "URINATION" | "APPETITE" | "DIGESTION" | "FATIGUE" | "FEVER" | "MOOD" | "OTHER";

interface Question {
  id: number;
  category: HealthCategory;
  text: string;
  hint: string;
}

const QUESTIONS: Question[] = [
  // SLEEP 1-4
  { id: 1, category: "SLEEP", text: "นอนหลับยาก ใช้เวลาเกิน 30 นาที กว่าจะหลับ", hint: "นอนกลิ้งไปมา" },
  { id: 2, category: "SLEEP", text: "ตื่นกลางดึกแล้วหลับต่อยาก", hint: "ตื่นมาตี 2-3 แล้วไม่หลับ" },
  { id: 3, category: "SLEEP", text: "ตื่นเช้าแล้วยังเพลีย ไม่สดชื่น", hint: "เหมือนไม่ได้นอน" },
  { id: 4, category: "SLEEP", text: "ง่วงกลางวัน สมาธิหลุด ต้องงีบ", hint: "บ่ายง่วงมาก" },
  // URINATION 5-8
  { id: 5, category: "URINATION", text: "ปัสสาวะบ่อยกลางวัน เกิน 8 ครั้ง", hint: "เข้าห้องน้ำถี่" },
  { id: 6, category: "URINATION", text: "ตื่นมาปัสสาวะกลางคืน 2 ครั้งขึ้นไป", hint: "กลางคืนลุกฉี่" },
  { id: 7, category: "URINATION", text: "แสบขัด สีเข้ม มีฟองมาก", hint: "ปัสสาวะผิดปกติ" },
  { id: 8, category: "URINATION", text: "กลั้นไม่อยู่ ต้องรีบเข้าทันที", hint: "กลั้นไม่ได้" },
  // APPETITE 9-10 + DIGESTION 11-14
  { id: 9, category: "APPETITE", text: "เบื่ออาหาร กินน้อยลง", hint: "ไม่อยากกิน" },
  { id: 10, category: "APPETITE", text: "หิวบ่อย กินจุ น้ำหนักขึ้น", hint: "หิวตลอด" },
  { id: 11, category: "DIGESTION", text: "คลื่นไส้ แน่นท้องหลังกิน", hint: "จุกแน่น" },
  { id: 12, category: "DIGESTION", text: "ท้องอืด มีลม แน่นท้อง", hint: "ท้องอืด" },
  { id: 13, category: "DIGESTION", text: "ท้องผูกหรือท้องเสียสลับกัน", hint: "ขับถ่ายผิดปกติ" },
  { id: 14, category: "DIGESTION", text: "แสบร้อนกลางอก เรอเปรี้ยว", hint: "กรดไหลย้อน" },
  // FATIGUE 15-18
  { id: 15, category: "FATIGUE", text: "เหนื่อยง่าย เดินนิดก็หอบ", hint: "เหนื่อยเร็ว" },
  { id: 16, category: "FATIGUE", text: "อ่อนเพลียทั้งที่พักพอ", hint: "เพลียตลอด" },
  { id: 17, category: "FATIGUE", text: "มึนหัว บ้านหมุน ยืนแล้วหน้ามืด", hint: "เวียนหัว" },
  { id: 18, category: "FATIGUE", text: "ปวดเมื่อยกล้ามเนื้อ/ข้อโดยไม่มีเหตุ", hint: "ปวดเมื่อย" },
  // FEVER 19-21
  { id: 19, category: "FEVER", text: "มีไข้ หนาวสั่น เหงื่อออกกลางคืน", hint: "ตัวร้อน" },
  { id: 20, category: "FEVER", text: "เจ็บคอ ไอ มีเสมหะ/น้ำมูกบ่อย", hint: "หวัดบ่อย" },
  { id: 21, category: "FEVER", text: "แผลหายช้า ติดเชื้อง่าย", hint: "ภูมิคุ้มกัน" },
  // MOOD 22-26
  { id: 22, category: "MOOD", text: "เครียด กังวล ใจสั่น", hint: "กังวล" },
  { id: 23, category: "MOOD", text: "เศร้า หดหู่ ไม่อยากทำอะไร", hint: "ซึมเศร้า" },
  { id: 24, category: "MOOD", text: "หงุดหงิดง่าย โมโหเร็ว", hint: "อารมณ์ร้อน" },
  { id: 25, category: "MOOD", text: "สมาธิสั้น หลงลืมบ่อย", hint: "ลืมง่าย" },
  { id: 26, category: "MOOD", text: "รู้สึกโดดเดี่ยว ไม่อยากเจอใคร", hint: "แยกตัว" },
  // OTHER 27-32
  { id: 27, category: "OTHER", text: "ปวดหัวตื้อๆ ท้ายทอย", hint: "สงสัยความดัน" },
  { id: 28, category: "OTHER", text: "ใจสั่น หัวใจเต้นเร็ว/สะดุด", hint: "หัวใจ" },
  { id: 29, category: "OTHER", text: "บวมเท้า/หน้า ตอนเช้า", hint: "บวมน้ำ" },
  { id: 30, category: "OTHER", text: "หิวน้ำบ่อย ปากแห้ง ฉี่มาก", hint: "สงสัยน้ำตาล" },
  { id: 31, category: "OTHER", text: "น้ำหนักขึ้น/ลงเกิน 2 กก. ใน 1 เดือน", hint: "น้ำหนักสวิง" },
  { id: 32, category: "OTHER", text: "มีไข้ต่ำๆ 37.5°C ขึ้นไปบ่อย", hint: "ไข้ต่ำ" },
];

const CATEGORY_LABEL: Record<HealthCategory, string> = {
  SLEEP: "การนอน",
  URINATION: "ปัสสาวะ",
  APPETITE: "ความอยากอาหาร",
  DIGESTION: "ย่อยอาหาร",
  FATIGUE: "อ่อนเพลีย",
  FEVER: "ไข้/ติดเชื้อ",
  MOOD: "อารมณ์",
  OTHER: "อื่น ๆ (หัวใจ/เมตาบอลิก)",
};

const SCALE_LABEL = ["ไม่มีเลย", "น้อยมาก", "บางครั้ง", "บ่อย", "บ่อยมาก", "ทุกวัน/รุนแรง"];

function parseScore(text: string): number | null {
  const t = text.toLowerCase();
  // digit first
  const m = t.match(/[0-5]/);
  if (m) return parseInt(m[0], 10);
  if (t.includes("ศูนย์") || t.includes("ไม่มี")) return 0;
  if (t.includes("หนึ่ง") || t.includes("นิดหน่อย") || t.includes("น้อยมาก")) return 1;
  if (t.includes("สอง") || t.includes("บางครั้ง")) return 2;
  if (t.includes("สาม") || (t.includes("บ่อย") && !t.includes("มาก"))) return 3;
  if (t.includes("สี่") || t.includes("บ่อยมาก")) return 4;
  if (t.includes("ห้า") || t.includes("ทุกวัน") || t.includes("รุนแรง") || t.includes("มากสุด")) return 5;
  return null;
}

export default function SelfCheckPage() {
  const { isAuthenticated, isHydrated } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [detail, setDetail] = useState<Record<number, string>>({});
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<any>(null);
  const [error, setError] = useState("");
  const recogRef = useRef<any>(null);

  const q = QUESTIONS[idx];
  const progress = Math.round((Object.keys(answers).length / QUESTIONS.length) * 100);
  const answered = Object.keys(answers).length;

  const speak = (text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "th-TH";
    u.rate = 0.95;
    u.onstart = () => setSpeaking(true);
    u.onend = () => setSpeaking(false);
    window.speechSynthesis.speak(u);
  };

  const startListening = () => {
    const SR: any = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SR) {
      setError("เบราว์เซอร์นี้ไม่รองรับการพูด — ใช้พิมพ์แทนได้");
      return;
    }
    if (recogRef.current) try { recogRef.current.stop(); } catch {}
    const rec = new SR();
    rec.lang = "th-TH";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onstart = () => { setListening(true); setTranscript("กำลังฟัง..."); };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    rec.onresult = (e: any) => {
      const text = e.results[0][0].transcript as string;
      setTranscript(`คุณพูดว่า: "${text}"`);
      const score = parseScore(text);
      if (score !== null) {
        setAnswers((a) => ({ ...a, [q.id]: score }));
        setTimeout(() => {
          if (idx < QUESTIONS.length - 1) setIdx((i) => i + 1);
        }, 600);
      } else {
        setTranscript(`ได้ยิน "${text}" — ไม่พบคะแนน 0-5 ลองพูดใหม่ เช่น "สาม" หรือ "ห้า"`);
      }
    };
    recogRef.current = rec;
    rec.start();
  };

  const setScore = (score: number) => {
    setAnswers((a) => ({ ...a, [q.id]: score }));
  };

  const next = () => { if (idx < QUESTIONS.length - 1) setIdx(idx + 1); };
  const prev = () => { if (idx > 0) setIdx(idx - 1); };

  // keyboard 0-5
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key >= "0" && e.key <= "5" && !saving && !done) {
        setScore(parseInt(e.key, 10));
        setTimeout(() => next(), 300);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [idx, saving, done]);

  const submit = async () => {
    if (answered < QUESTIONS.length) {
      setError(`ยังตอบไม่ครบ — ตอบแล้ว ${answered}/${QUESTIONS.length} ข้อ`);
      return;
    }
    setSaving(true);
    setError("");
    try {
      // ส่งทีละข้อเข้า POST /api/health/observations (server จะสร้าง flag อัตโนมัติเมื่อ >=3 ใน 14 วัน)
      for (const qq of QUESTIONS) {
        const severity = answers[qq.id] ?? 0;
        if (severity === 0) continue; // ข้ามข้อที่ไม่มีอาการ
        await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/health/observations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category: qq.category,
            detail: `${qq.text}${detail[qq.id] ? " — " + detail[qq.id] : ""} (${severity}/5)`,
            severity: Math.max(1, severity),
            source: transcript ? "conversation" : "manual",
          }),
        });
      }
      // ดึงสรุปใหม่
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/health/overview`);
      const data = await res.json();
      const flags = data.flags?.filter((f: any) => f.status === "PENDING") ?? [];
      const counts = data.counts ?? [];
      setDone({ flags, counts, observations: data.observations?.slice(0, 5) });
      speak(`บันทึกเสร็จแล้ว พบ ${flags.length} หมวดที่ควรติดตาม`);
    } catch (e: any) {
      setError(e.message || "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  if (!isHydrated) return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">{t("common.loading", "กำลังโหลด...")}</div>;
  if (!isAuthenticated) return <div className="text-white p-8">{t("health.unauthorized", "Unauthorized")}</div>;

  if (done) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 flex">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <PageHeader eyebrow="ชีวิต & สุขภาพ" title="ผลวินิจฉัยเบื้องต้น" icon={<Icon name="health" size={18} />} />
          <main className="flex-1 p-4 lg:p-6 space-y-5 max-w-3xl mx-auto w-full space-y-4 w-full">
            <div className="card panel-glow p-6 text-center">
              <div className="text-5xl mb-3">✅</div>
              <h2 className="text-lg font-bold glow-text">บันทึกแล้ว {answered} ข้อ</h2>
              <p className="text-sm text-gray-400 mt-1">ระบบได้สร้าง HealthObservation และ Flag อัตโนมัติ (เกณฑ์ ≥3 ครั้ง/14วัน)</p>
            </div>
            {done.flags.length > 0 ? (
              <div className="card p-4 panel-cyan">
                <h3 className="text-sm font-bold text-amber-300 mb-2 flex items-center gap-1"><Icon name="alert-triangle" size={14} /> พบ {done.flags.length} หมวดที่ควรติดตาม</h3>
                {done.flags.map((f: any) => (
                  <div key={f.id} className="inset px-3 py-2 mb-2 text-sm">
                    <span className="font-bold text-red-400">{f.flag_type}</span> — {f.note}
                    <span className="text-xs text-gray-500 ml-2">{CATEGORY_LABEL[f.category as HealthCategory] ?? f.category}</span>
                  </div>
                ))}
                <p className="text-xs text-gray-500 mt-2">⚠️ นี่ไม่ใช่การวินิจฉัยทางการแพทย์ — ใช้ประกอบการปรึกษาแพทย์ ดูรายละเอียดที่ <Link href="/health" className="text-emerald-400 underline">/health</Link></p>
              </div>
            ) : (
              <div className="card p-4 text-center text-sm text-emerald-300">ไม่พบหมวดที่ถึงเกณฑ์ — สุขภาพโดยรวมดูปกติ ติดตามต่อได้ที่ /health</div>
            )}
            <div className="flex gap-2 justify-center">
              <Link href="/health" className="btn-primary">ไปหน้า Health</Link>
              <Link href="/health-export" className="btn-secondary">ออกรายงาน 30 วัน</Link>
              <button onClick={() => { setDone(null); setAnswers({}); setIdx(0); }} className="px-4 py-2 bg-gray-800 rounded-lg text-sm">ทำใหม่</button>
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <PageHeader
            eyebrow="ชีวิต & สุขภาพ"
            title="Self-Check — วินิจฉัยตัวเอง 32 ข้อ"
            subtitle="พูดตอบหรือพิมพ์ตอบก็ได้ — AI เก็บให้อัตโนมัติ (0=ไม่มี 5=ทุกวัน/รุนแรง)"
            icon={<Icon name="health" size={18} />}
            actions={<Link href="/health" className="text-sm text-sky-400 hover:underline">← กลับ Health</Link>}
          />

        <main className="max-w-3xl mx-auto p-6 space-y-4 w-full">
          {/* progress */}
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>ข้อ {idx + 1} / {QUESTIONS.length} — ตอบแล้ว {answered} ข้อ</span>
            <span className="text-emerald-400">{progress}%</span>
          </div>
          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
          {error && <div className="text-sm text-red-400 inset p-3">{error}</div>}

          {/* question card */}
          <div className="card panel-glow p-6 space-y-4">
            <div className="flex items-center gap-2 text-xs">
              <span className="px-2 py-1 rounded bg-gray-800 border border-gray-700 text-gray-300">{CATEGORY_LABEL[q.category]}</span>
              <span className="text-gray-500">#{q.id}</span>
              {answers[q.id] != null && <span className="ml-auto text-emerald-400 flex items-center gap-1"><Icon name="check-circle" size={12} /> ตอบแล้ว {answers[q.id]}/5</span>}
            </div>

            <h2 className="text-lg font-bold text-white leading-snug">{q.text}</h2>
            <p className="text-xs text-gray-500">เช่น {q.hint}</p>

            {/* 0-5 buttons */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => setScore(n)}
                  className={`p-3 rounded-xl border text-center transition-all ${answers[q.id] === n ? "bg-emerald-600 border-emerald-500 text-white scale-105" : "bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-500"}`}
                >
                  <div className="text-xl font-bold">{n}</div>
                  <div className="text-[10px] leading-tight mt-1">{SCALE_LABEL[n]}</div>
                </button>
              ))}
            </div>

            {/* detail optional */}
            <input
              value={detail[q.id] ?? ""}
              onChange={(e) => setDetail((d) => ({ ...d, [q.id]: e.target.value }))}
              placeholder="รายละเอียดเพิ่มเติม (ถ้ามี) เช่น เป็นมา 3 วันแล้ว"
              className="input text-sm w-full"
            />

            {/* voice controls */}
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-800">
              <button
                onClick={() => speak(q.text + " ให้คะแนน 0 ถึง 5")}
                disabled={speaking}
                className="px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs flex items-center gap-1.5"
              >
                <Icon name="healing" size={14} /> {speaking ? "กำลังพูด..." : "ฟังคำถาม"}
              </button>
              <button
                onClick={startListening}
                disabled={listening}
                className={`px-3 py-2 rounded-lg text-xs flex items-center gap-1.5 ${listening ? "bg-red-600 text-white animate-pulse" : "bg-emerald-600 hover:bg-emerald-500 text-white"}`}
              >
                <Icon name="healing" size={14} /> {listening ? "กำลังฟัง..." : "🎤 พูดตอบ (0-5)"}
              </button>
              <span className="text-xs text-gray-500">พูดว่า "ศูนย์" ถึง "ห้า" หรือกด 0-5 บนคีย์บอร์ด</span>
            </div>
            {transcript && <div className="text-xs text-amber-300 inset p-2">{transcript}</div>}

            <div className="flex justify-between pt-2">
              <button onClick={prev} disabled={idx === 0} className="px-4 py-2 bg-gray-800 disabled:opacity-40 rounded-lg text-sm">← ก่อนหน้า</button>
              {idx < QUESTIONS.length - 1 ? (
                <button onClick={next} className="px-4 py-2 bg-sky-600 hover:bg-sky-500 rounded-lg text-sm text-white">ถัดไป →</button>
              ) : (
                <button onClick={submit} disabled={saving || answered === 0} className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded-lg text-sm font-bold text-white">
                  {saving ? "กำลังบันทึก..." : `บันทึก ${answered} ข้อ → ดูผล`}
                </button>
              )}
            </div>
            <p className="text-[11px] text-gray-500 text-center">พิมพ์ 0-5 บนคีย์บอร์ดได้เลย • พูดภาษาไทยได้ • ข้อมูลเก็บในเครื่อง (Local-First) ผ่าน /api/health/observations</p>
          </div>

          {/* quick jump */}
          <div className="flex flex-wrap gap-1.5 justify-center">
            {QUESTIONS.map((qq, i) => (
              <button
                key={qq.id}
                onClick={() => setIdx(i)}
                className={`w-7 h-7 rounded text-xs ${i === idx ? "bg-sky-600 text-white" : answers[qq.id] != null ? "bg-emerald-900 text-emerald-300 border border-emerald-700" : "bg-gray-800 text-gray-500"}`}
                title={`${qq.id}. ${qq.text.slice(0, 24)}`}
              >
                {qq.id}
              </button>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
