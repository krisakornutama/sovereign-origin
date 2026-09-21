"use client";
// ─────────────────────────────────────────────────────────────
//  MBTI Compare — เทียบผลสองคน (คู่สมรส/สมาชิกครอบครัว)
//  ข้อมูลอยู่บนเครื่องทั้งหมด: ผลของ "ฉัน" มาจาก localStorage ของเบราว์เซอร์นี้
//  ผลของอีกคน 2 วิธี: ① เลือกจากคลัง 16 ประเภท (รู้ผลเขาอยู่แล้ว)
//                     ② ให้เขาทำแบบทดสอบเองบนเครื่องนี้ → บันทึกเป็น profile ตั้งชื่อได้ (แม่นกว่า)
//  ธีม: atmo-mind
// ─────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from "react";
import Sidebar from "../../components/layout/Sidebar";
import PageHeader from "../../components/ui/PageHeader";
import Icon from "../../components/ui/Icon";
import { MBTI_TYPES, MBTI_QUESTIONS, MBTI_SHORT_QUESTIONS, scoreMbti, compareMbti, typeInfo, latestLocalResult, DIM_LABELS, familyOf, FAM_RGB, loadProfiles, saveProfile, deleteProfile, type MbtiResult, type MbtiProfile, type MbtiTypeInfo } from "../../lib/mbtiData";
import Seal from "../../components/mbti/Seal";
import QuizCard from "../../components/mbti/QuizCard";

const RELATION_STYLE: Record<string, { chip: string; label: string; icon: string }> = {
  same:    { chip: "text-emerald-300 bg-emerald-900/40 border-emerald-700/60", label: "เหมือนกัน", icon: "🤝" },
  mirror:  { chip: "text-sky-300 bg-sky-900/40 border-sky-700/60", label: "สมดุลสองขั้ว", icon: "⚖️" },
  adjacent:{ chip: "text-amber-300 bg-amber-900/40 border-amber-700/60", label: "ต่างเล็กน้อย", icon: "🌱" },
  clash:   { chip: "text-rose-300 bg-rose-900/40 border-rose-700/60", label: "มุมเสียดสี", icon: "⚡" },
};

type PickMode = "menu" | "quiz" | "naming";

export default function MbtiComparePage() {
  const [myResult, setMyResult] = useState<MbtiResult | null>(null);
  const [otherCode, setOtherCode] = useState<string>("");
  const [pickMode, setPickMode] = useState<PickMode>("menu");
  const [profiles, setProfiles] = useState<MbtiProfile[]>([]);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, number> | null>(null);
  const [quizKind, setQuizKind] = useState<'full' | 'short'>('full');
  const [profileName, setProfileName] = useState("");

  useEffect(() => {
    setMyResult(latestLocalResult());
    setProfiles(loadProfiles());
  }, []);

  const compare = useMemo(() => {
    if (!myResult || !otherCode) return null;
    // ฝั่ง "อีกคน" จากโค้ด 4 ตัว + คะแนนกลาง 50/50 (ใช้เฉพาะตัวอักษรในการเทียบ)
    const half: Record<number, number> = {};
    MBTI_QUESTIONS.forEach((q) => { half[q.id] = otherCode.includes(q.d[1]) ? 1 : 0; });
    return compareMbti(myResult, scoreMbti(half, MBTI_QUESTIONS));
  }, [myResult, otherCode]);

  const myInfo: MbtiTypeInfo | undefined = myResult ? typeInfo(myResult.code) : undefined;
  const otherInfo: MbtiTypeInfo | undefined = otherCode ? typeInfo(otherCode) : undefined;

  // เสร็จแบบทดสอบของอีกคน → ไปหน้าตั้งชื่อโปรไฟล์
  const finishQuiz = (answers: Record<number, number>) => {
    setQuizAnswers(answers);
    setPickMode("naming");
  };

  const confirmProfile = () => {
    if (!quizAnswers) return;
    const name = profileName.trim() || "คนในบ้าน";
    const questions = quizKind === 'full' ? MBTI_QUESTIONS : MBTI_SHORT_QUESTIONS;
    const result = scoreMbti(quizAnswers, questions);
    const saved = saveProfile({ name, result, quiz: quizKind });
    setProfiles((p) => [saved, ...p]);
    setOtherCode(saved.result.code);
    setQuizAnswers(null);
    setProfileName("");
    setPickMode("menu");
  };

  return (
    <div className="atmo-mind min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <PageHeader
          eyebrow="ชีวิต & สุขภาพ"
          title="เทียบบุคลิกภาพสองคน"
          subtitle="คู่สมรส · ลูก · พ่อแม่ · หุ้นส่วน — เข้าใจความต่างรายมิติ ก่อนที่ความต่างจะกลายเป็นรอยขัด"
          icon={<Icon name="users" size={18} />}
          actions={<a href="/mbti" className="text-sm text-gray-400 hover:text-white">← กลับ MBTI</a>}
        />
        <main className="flex-1 p-4 lg:p-6 space-y-5 max-w-4xl mx-auto w-full">
          {!myResult ? (
            <div className="card p-8 text-center max-w-xl mx-auto">
              <div className="text-5xl mb-3">🧩</div>
              <h3 className="text-lg font-bold mb-2">ยังไม่มีผล MBTI ของคุณ</h3>
              <p className="text-sm text-gray-400 mb-4">ทำแบบทดสอบก่อน แล้วกลับมาเทียบกับคนสำคัญได้เลย</p>
              <a href="/mbti" className="btn-primary inline-block px-5 py-2 text-sm">ไปทำแบบทดสอบ</a>
            </div>
          ) : (
            <>
              {/* ── การ์ดสองฝั่ง ── */}
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="card panel-glow p-5">
                  <div className="text-[11px] text-gray-500 mb-2">คุณ (ผลจากเครื่องนี้)</div>
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">{myInfo?.emoji}</span>
                    <div>
                      <div className="text-xl font-bold" style={{ color: `rgb(${FAM_RGB[familyOf(myResult.code) ?? "nt"]})` }}>{myResult.code}</div>
                      <div className="text-xs text-gray-400">{myInfo?.name} · {myInfo?.nameEn}</div>
                    </div>
                  </div>
                </div>
                <div className="card panel-glow p-5">
                  <div className="text-[11px] text-gray-500 mb-2">อีกคน</div>
                  {otherInfo ? (
                    <div className="flex items-center gap-3">
                      <span className="text-3xl">{otherInfo.emoji}</span>
                      <div>
                        <div className="text-xl font-bold" style={{ color: `rgb(${FAM_RGB[familyOf(otherCode) ?? "nt"]})` }}>{otherCode}</div>
                        <div className="text-xs text-gray-400">{otherInfo.name} · {otherInfo.nameEn}</div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-gray-500 pt-2">← เลือกวิธีรู้จักเขาด้านล่าง</div>
                  )}
                </div>
              </div>

              {/* ── เลือกอีกคน ── */}
              {!otherCode && pickMode === "menu" && (
                <div className="card p-5 space-y-4">
                  <div className="grid sm:grid-cols-2 gap-3">
                    <button onClick={() => setPickMode("quiz")}
                      className="inset rounded-xl p-4 text-left hover:border-violet-500/50 transition-colors">
                      <div className="text-lg">📝 ให้เขาทำแบบทดสอบเอง <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-900/60 text-violet-300">แม่นที่สุด</span></div>
                      <div className="text-xs text-gray-500 mt-1">ส่งเครื่อง/นั่งด้วยกันครั้งเดียว — บันทึกเป็นโปรไฟล์ตั้งชื่อได้ ใช้เทียบใหม่ได้ตลอด</div>
                    </button>
                    <div className="inset rounded-xl p-4 text-left bg-gray-800/30">
                      <div className="text-lg">📚 เลือกจากคลัง 16 ประเภท</div>
                      <div className="text-xs text-gray-500 mt-1">รู้ผลเขาอยู่แล้ว — เลือกเร็ว ไม่ต้องทำแบบทดสอบ</div>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1.5">เลือกประเภทของเขา (จากคลัง 16 ประเภท)</label>
                    <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
                      {MBTI_TYPES.map((t) => (
                        <button key={t.code} onClick={() => setOtherCode(t.code)}
                          className="inset rounded-lg px-1 py-2 text-center hover:border-fuchsia-500/40 transition-colors"
                          title={t.name}>
                          <div className="text-base">{t.emoji}</div>
                          <div className="text-[10px] font-bold text-fuchsia-200">{t.code}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                  {profiles.length > 0 && (
                    <div>
                      <label className="text-xs text-gray-400 block mb-1.5">โปรไฟล์ที่บันทึกไว้ ({profiles.length})</label>
                      <div className="space-y-1.5">
                        {profiles.map((p) => {
                          const info = typeInfo(p.result.code);
                          return (
                            <div key={p.id} className="inset rounded-lg px-3 py-2 flex items-center gap-2 sm:gap-3 min-w-0">
                              <span className="text-lg shrink-0">{info?.emoji ?? "🧩"}</span>
                              <button onClick={() => setOtherCode(p.result.code)} className="flex items-center gap-2 flex-1 text-left hover:text-white min-w-0">
                                <span className="font-bold text-sm shrink-0 max-w-[9rem] truncate">{p.name}</span>
                                <span className="text-xs shrink-0" style={{ color: `rgb(${FAM_RGB[familyOf(p.result.code) ?? "nt"]})` }}>{p.result.code}</span>
                                <span className="text-xs text-gray-500 truncate">{info?.name}</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 shrink-0 hidden sm:inline">{p.quiz === 'full' ? 'ชุดเต็ม 93' : 'ควิซสั้น 32'}</span>
                              </button>
                              <button onClick={() => { deleteProfile(p.id); setProfiles(loadProfiles()); }}
                                className="text-xs text-gray-600 hover:text-rose-400 shrink-0" title="ลบโปรไฟล์">ลบ</button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── โหมด: อีกคนทำแบบทดสอบเอง ── */}
              {!otherCode && pickMode === "quiz" && (
                <div className="space-y-3">
                  <div className="flex gap-2 justify-center">
                    {(['full', 'short'] as const).map((k) => (
                      <button key={k} onClick={() => setQuizKind(k)}
                        className={`px-3 py-1.5 rounded-lg text-xs ${quizKind === k ? "bg-violet-600 text-white" : "bg-gray-800 text-gray-400"}`}>
                        {k === 'full' ? "ชุดเต็ม 93 ข้อ (แม่น)" : "ควิซสั้น 32 ข้อ (เร็ว)"}
                      </button>
                    ))}
                  </div>
                  <QuizCard
                    key={quizKind}
                    variant="inline"
                    questions={quizKind === 'full' ? MBTI_QUESTIONS : MBTI_SHORT_QUESTIONS}
                    title="แบบทดสอบของอีกคน"
                    subtitle="ให้เขานั่งทำเอง — เลือกข้อความที่ตรงกับเขากว่า ไม่มีถูกผิด"
                    tone="violet"
                    onDone={finishQuiz}
                    onCancel={() => setPickMode("menu")}
                  />
                </div>
              )}

              {/* ── โหมด: ตั้งชื่อโปรไฟล์ ── */}
              {!otherCode && pickMode === "naming" && quizAnswers && (() => {
                const questions = quizKind === 'full' ? MBTI_QUESTIONS : MBTI_SHORT_QUESTIONS;
                const preview = scoreMbti(quizAnswers, questions);
                const info = typeInfo(preview.code);
                return (
                  <div className="card p-6 text-center space-y-4 max-w-xl mx-auto">
                    <div className="text-4xl">{info?.emoji}</div>
                    <div className="text-2xl font-bold" style={{ color: `rgb(${FAM_RGB[familyOf(preview.code) ?? "nt"]})` }}>{preview.code}</div>
                    <div className="text-sm text-gray-300">{info?.name} — {info?.nameEn}</div>
                    <p className="text-xs text-gray-500">บันทึกเป็นโปรไฟล์ของเขา เพื่อเทียบใหม่ได้โดยไม่ต้องทำซ้ำ</p>
                    <input
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") confirmProfile(); }}
                      placeholder="ชื่อเขา เช่น แม่, พี่ชาย, คู่สมรส"
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:border-violet-500 outline-none"
                      autoFocus
                    />
                    <div className="flex justify-center gap-2">
                      <button onClick={() => setPickMode("quiz")} className="btn-secondary px-4 py-2 text-sm">ทำใหม่</button>
                      <button onClick={confirmProfile} className="btn-primary px-5 py-2 text-sm">บันทึกและเทียบเลย</button>
                    </div>
                  </div>
                );
              })()}

              {/* ── ผลการเทียบ ── */}
              {compare && otherInfo && myInfo && (
                <>
                  <div className="card panel-glow p-6">
                    <div className="flex flex-col items-center gap-4">
                      <div className="text-center space-y-2">
                        <div className="text-3xl">{compare.summary.sameCount >= 3 ? "💞" : compare.summary.sameCount === 2 ? "🧩" : "🌋"}</div>
                        <h2 className="text-xl font-bold">
                          <span style={{ color: `rgb(${FAM_RGB[familyOf(myResult.code) ?? "nt"]})` }}>{myResult.code}</span>
                          <span className="text-gray-600"> × </span>
                          <span style={{ color: `rgb(${FAM_RGB[familyOf(otherCode) ?? "nt"]})` }}>{otherCode}</span>
                        </h2>
                        <p className="text-sm text-fuchsia-200/90">{compare.summary.headline}</p>
                        <div className="flex justify-center gap-2 pt-1">
                          <span className="inset px-2 py-1 rounded text-xs text-emerald-300">เหมือนกัน {compare.summary.sameCount}/4 มิติ</span>
                          <span className="inset px-2 py-1 rounded text-xs text-amber-300">ต่างกัน {compare.summary.diffCount}/4 มิติ</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-center gap-2 sm:gap-6">
                        <Seal letters={myResult.code} dims={myResult.dims} famRgb={FAM_RGB[familyOf(myResult.code) ?? "nt"]} />
                        <span className="text-lg text-gray-600 font-light">×</span>
                        <Seal letters={otherCode} dims={compare.dims.map((d, i) => ({ dim: d.dim, letter: otherCode[i], clarity: 50 }))} famRgb={FAM_RGB[familyOf(otherCode) ?? "nt"]} />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {compare.dims.map((d) => {
                      const st = RELATION_STYLE[d.relation];
                      return (
                        <div key={d.dim} className="card p-4">
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <h3 className="text-sm font-bold text-gray-200">{DIM_LABELS[d.dim]}</h3>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full border ${st.chip}`}>{st.icon} {st.label}</span>
                            <span className="text-xs text-gray-500 ml-auto">
                              <b style={{ color: `rgb(${FAM_RGB[familyOf(myResult.code) ?? "nt"]})` }}>{d.aLetter}</b> × <b style={{ color: `rgb(${FAM_RGB[familyOf(otherCode) ?? "nt"]})` }}>{d.bLetter}</b>
                            </span>
                          </div>
                          <p className="text-sm text-gray-300 leading-relaxed">{d.note}</p>
                        </div>
                      );
                    })}
                  </div>

                  {/* ── โทนการดูแลร่วมกัน ── */}
                  <div className="card p-5 space-y-2">
                    <h3 className="text-sm font-bold text-fuchsia-300 flex items-center gap-2"><Icon name="healing" size={14} /> ใช้คู่นี้อย่างไรในบ้านนี้</h3>
                    <p className="text-sm text-gray-300 leading-relaxed">
                      เมื่ออีกฝ่ายเครียด/ไม่สบายใจ — คุณ ({myInfo.name}) ควร{myResult.code.includes("T") ? "ฟังก่อนเสนอทางแก้ (เขาต้องการความเข้าใจ ไม่ใช่โซลูชัน)" : "อยู่ข้าง ๆ และช่วยคิดจริงจัง (เขาต้องการการลงมือ ไม่ใช่แค่คำปลอบ)"} ส่วนเขา ({otherInfo.name}) มัก{otherCode.includes("J") ? "อยากได้ความชัดเจนและแผนที่แน่นอน" : "อยากได้พื้นที่ยืดหยุ่นและไม่ถูกตารางบีบ"} ในวันยาก ๆ
                    </p>
                    <p className="text-xs text-gray-500">
                      💡 กติกาทองของทุกคู่: มิติที่ "ต่าง" คือแรงเสริมของบ้าน ไม่ใช่ข้อตำหนิ — ใช้มิติที่ "เหมือน" เป็นพื้นที่พัก และใช้มิติที่ "ต่าง" เป็นพื้นที่เรียนรู้
                    </p>
                  </div>

                  <div className="flex justify-center">
                    <button onClick={() => setOtherCode("")} className="btn-secondary px-5 py-2 text-sm">เทียบกับคนอื่น</button>
                  </div>
                </>
              )}
            </>
          )}
          <p className="text-[11px] text-gray-500 text-center">ข้อมูลทั้งหมดอยู่บนเครื่องของคุณ — โปรไฟล์ของคนในบ้านเก็บในเบราว์เซอร์นี้เท่านั้น ไม่มีการส่งข้อมูลออกนอกเครื่อง</p>
        </main>
      </div>
    </div>
  );
}
