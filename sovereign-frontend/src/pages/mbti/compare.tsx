"use client";
// ─────────────────────────────────────────────────────────────
//  MBTI Compare — เทียบผลสองคน (คู่สมรส/สมาชิกครอบครัว)
//  ข้อมูลอยู่บนเครื่องทั้งหมด: ผลของ "ฉัน" มาจาก localStorage ของเบราว์เซอร์นี้
//  ผลของอีกคน: ผู้ใช้เลือกจากคลัง 16 ประเภท (รู้ผลเขาอยู่แล้ว) หรือกรอกโค้ด 4 ตัว
//  ธีม: atmo-mind
// ─────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from "react";
import Sidebar from "../../components/layout/Sidebar";
import PageHeader from "../../components/ui/PageHeader";
import Icon from "../../components/ui/Icon";
import { MBTI_TYPES, compareMbti, typeInfo, latestLocalResult, type MbtiResult, type MbtiTypeInfo } from "../../lib/mbtiData";

const RELATION_STYLE: Record<string, { chip: string; label: string; icon: string }> = {
  same:    { chip: "text-emerald-300 bg-emerald-900/40 border-emerald-700/60", label: "เหมือนกัน", icon: "🤝" },
  mirror:  { chip: "text-sky-300 bg-sky-900/40 border-sky-700/60", label: "สมดุลสองขั้ว", icon: "⚖️" },
  adjacent:{ chip: "text-amber-300 bg-amber-900/40 border-amber-700/60", label: "ต่างเล็กน้อย", icon: "🌱" },
  clash:   { chip: "text-rose-300 bg-rose-900/40 border-rose-700/60", label: "มุมเสียดสี", icon: "⚡" },
};

export default function MbtiComparePage() {
  const [myResult, setMyResult] = useState<MbtiResult | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [otherCode, setOtherCode] = useState<string>("");
  const [role, setRole] = useState("คนสำคัญ");
  const [manualCode, setManualCode] = useState("");
  const [manualError, setManualError] = useState("");

  useEffect(() => {
    setMyResult(latestLocalResult());
    setLoaded(true);
  }, []);

  // โค้ดที่กรอกมือ: ตรวจว่าเป็นตัวอักษรที่ถูกต้องครบ 4 ตัว
  const tryManual = () => {
    const c = manualCode.trim().toUpperCase();
    if (typeInfo(c)) { setOtherCode(c); setManualError(""); }
    else setManualError("ไม่พบประเภทนี้ — กรอกโค้ด 4 ตัว เช่น INFP, ESTJ (ใช้ได้แค่ตัว E/I, S/N, T/F, J/P)");
  };

  const compare = useMemo(() => {
    if (!myResult || !otherCode) return null;
    // สร้างผลจำลองฝั่ง "อีกคน" จากคะแนนกลาง (50/50) — ใช้เฉพาะตัวอักษรในการเทียบ
    const other: MbtiResult = {
      code: otherCode,
      answered: 0,
      date: "",
      dims: ["EI", "SN", "TF", "JP"].map((dim, i) => {
        const letter = otherCode[i];
        const first = ["E", "S", "T", "J"][i];
        return {
          dim: dim as "EI" | "SN" | "TF" | "JP",
          first, second: { E: "I", S: "N", T: "F", J: "P" }[first as "E" | "S" | "T" | "J"],
          firstCount: letter === first ? 1 : 0,
          secondCount: letter === first ? 0 : 1,
          firstPct: letter === first ? 100 : 0,
          clarity: 100,
          letter,
        };
      }),
    };
    return compareMbti(myResult, other);
  }, [myResult, otherCode]);

  const myInfo: MbtiTypeInfo | undefined = myResult ? typeInfo(myResult.code) : undefined;
  const otherInfo: MbtiTypeInfo | undefined = otherCode ? typeInfo(otherCode) : undefined;

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
          {!loaded ? (
            <div className="text-sm text-gray-500">กำลังโหลด...</div>
          ) : !myResult ? (
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
                      <div className="text-xl font-bold text-fuchsia-300">{myResult.code}</div>
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
                        <div className="text-xl font-bold text-violet-300">{otherCode} {role && <span className="text-xs text-gray-400">({role})</span>}</div>
                        <div className="text-xs text-gray-400">{otherInfo.name} · {otherInfo.nameEn}</div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-gray-500 pt-2">← เลือกประเภทของเขาด้านล่าง</div>
                  )}
                </div>
              </div>

              {/* ── เลือกอีกคน ── */}
              {!otherCode && (
                <div className="card p-5 space-y-4">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1.5">ความสัมพันธ์ (ปรับบริบทการอ่านผล)</label>
                    <div className="flex flex-wrap gap-1.5">
                      {["คู่สมรส/คนรัก", "ลูก", "พ่อ/แม่", "พี่น้อง", "หุ้นส่วน/เพื่อนร่วมงาน"].map((r) => (
                        <button key={r} onClick={() => setRole(r)}
                          className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${role === r ? "bg-fuchsia-600/25 border-fuchsia-500 text-white" : "bg-gray-800 border-gray-700 text-gray-300 hover:border-fuchsia-500/40"}`}>
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1.5">เลือกประเภทของเขา (จากคลัง 16 ประเภท)</label>
                    <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
                      {MBTI_TYPES.map((t) => (
                        <button key={t.code} onClick={() => { setOtherCode(t.code); setManualError(""); }}
                          className="inset rounded-lg px-1 py-2 text-center hover:border-fuchsia-500/40 transition-colors"
                          title={t.name}>
                          <div className="text-base">{t.emoji}</div>
                          <div className="text-[10px] font-bold text-fuchsia-200">{t.code}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1.5">หรือกรอกโค้ดเอง (ถ้าเขาทำแบบทดสอบที่อื่น)</label>
                    <div className="flex gap-2">
                      <input value={manualCode} onChange={(e) => setManualCode(e.target.value)} maxLength={4}
                        placeholder="เช่น INFP" className="input text-sm w-32 uppercase" />
                      <button onClick={tryManual} className="btn-secondary px-4 py-2 text-sm">เทียบ</button>
                    </div>
                    {manualError && <p className="text-xs text-rose-300 mt-1.5">{manualError}</p>}
                  </div>
                </div>
              )}

              {/* ── ผลการเทียบ ── */}
              {compare && otherInfo && myInfo && (
                <>
                  <div className="card panel-glow p-6 text-center space-y-2">
                    <div className="text-3xl">{compare.summary.sameCount >= 3 ? "💞" : compare.summary.sameCount === 2 ? "🧩" : "🌋"}</div>
                    <h2 className="text-lg font-bold glow-text">{myResult.code} × {otherCode}</h2>
                    <p className="text-sm text-fuchsia-200/90 max-w-xl mx-auto leading-relaxed">{compare.summary.headline}</p>
                    <div className="flex justify-center gap-2 pt-1">
                      <span className="inset px-2 py-1 rounded text-xs text-emerald-300">เหมือนกัน {compare.summary.sameCount}/4 มิติ</span>
                      <span className="inset px-2 py-1 rounded text-xs text-amber-300">ต่างกัน {compare.summary.diffCount}/4 มิติ</span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {compare.dims.map((d) => {
                      const st = RELATION_STYLE[d.relation];
                      const L = { EI: "พลังงาน", SN: "การรับรู้", TF: "การตัดสินใจ", JP: "วิถีชีวิต" }[d.dim];
                      const names = { E: "มุ่งออก", I: "มุ่งเข้า", S: "จับต้องได้", N: "นามธรรม", T: "ตรรกะ", F: "ความรู้สึก", J: "จัดระเบียบ", P: "ล่องลอย" };
                      return (
                        <div key={d.dim} className="card p-4">
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <h3 className="text-sm font-bold text-gray-200">{L}</h3>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full border ${st.chip}`}>{st.icon} {st.label}</span>
                            <span className="text-xs text-gray-500 ml-auto">
                              <b className="text-fuchsia-300">{d.aLetter}</b> ({names[d.aLetter]}) × <b className="text-violet-300">{d.bLetter}</b> ({names[d.bLetter]})
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
                    <p className="text-sm text-gray-300 leading-relaxed">เมื่ออีกฝ่ายเครียด/ไม่สบายใจ — คุณ ({myInfo.name}) ควร{myResult.code.includes("T") && !myResult.code.includes("F") ? "ฟังก่อนเสนอทางแก้ (เขาต้องการความเข้าใจ ไม่ใช่โซลูชัน)" : "อยู่ข้าง ๆ และช่วยคิดจริงจัง (เขาต้องการการลงมือ ไม่ใช่แค่คำปลอบ)"} {" "} ส่วนเขา ({otherInfo.name}) มัก{otherCode.includes("J") ? "อยากได้ความชัดเจนและแผนที่แน่นอน" : "อยากได้พื้นที่ยืดหยุ่นและไม่ถูกตารางบีบ"} ในวันยาก ๆ
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
          <p className="text-[11px] text-gray-500 text-center">ข้อมูลทั้งหมดอยู่บนเครื่องของคุณ — ผลของอีกคนใช้การเลือกจากคลัง ไม่มีการส่งข้อมูลออกนอกเครื่อง</p>
        </main>
      </div>
    </div>
  );
}
