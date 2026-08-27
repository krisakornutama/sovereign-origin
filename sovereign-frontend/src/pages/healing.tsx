"use client";
// Sovereign Buddhist Healing Module — ห้องเยียวยา (ธรรมะบำบัดใจ + สมาธิ + สมุนไพรคู่ยา + ติดตามผล)
// ดีไซน์: ห้องสว่างเทียนในคฤหาสน์ command center — เทียนแห่งสติ = ไฟที่ลุกตามสมาธิที่ทำจริง
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '../lib/apiFetch';
import { asObject } from '../lib/fetchJson';
import { useAuthStore } from '../stores/useAuthStore';
import Icon from '../components/ui/Icon';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import { useLanguageStore } from '../stores/useLanguageStore';

interface Teaching {
  id: string; title: string; category: string; category_tags?: string[] | null;
  content: string; application?: string | null; source?: string | null;
}
interface Herb {
  name: string; uses: string[]; warnings: string[]; interactions: { med: string; severity: string; note: string }[];
}
interface ProgressMetric {
  metric: string; before: number; after: number; delta: number; improving: boolean; samples: number;
}

// ── จานสีห้องเยียวยา (อบอุ่น ไม่ใช่เทาเย็นของทั้งแอป): ขี้ผึ้ง #151009 · เทียนทอง #E3B04B · ทองแก่ #B8873A · กระดาษสา #EDE3CC · ใบโพธิ์ #93A97E · ไฟแดง #C05B4D ──
const GOLD = '#E3B04B';      // เทียนทอง (เปลวเทียน/แสง)
const GOLD_DEEP = '#B8873A'; // ทองแก่ (เชิงเทียน)
const CARD = 'bg-[#1B140C]/80 border border-[#332616] rounded-xl';
const INPUT = 'bg-[#120D07] border border-[#3A2C1B] rounded-lg px-2 py-2 text-sm text-[#EDE3CC] placeholder-[#8A7A58] focus:outline-none focus:ring-1 focus:ring-[#E3B04B]';
const BTN = 'px-4 py-2 bg-[#E3B04B] text-[#1A1209] hover:bg-[#F0C069] disabled:opacity-50 rounded-lg text-sm font-semibold transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E3B04B]';

const METRIC_LABELS: Record<string, string> = {
  stress: 'ความเครียด', pain: 'ความเจ็บปวด', anxiety: 'วิตกกังวล',
  meditation_min: 'สมาธิ (นาที/วัน)', sleep_hours: 'การนอนหลับ (ชม.)',
  hrv: 'HRV', wbc: 'ภูมิคุ้มกัน (WBC)', heart_rate: 'ชีพจร',
};

// ── เทียนแห่งสติ — ไฟลุกตามสมาธิ 24 ชม. ล่าสุด เทียบเป้า 30 นาที ──
function flamePath(h: number): string {
  const H = 34 + 62 * h;          // ความสูงเปลว
  const W = 13 + 9 * h;           // ครึ่งความกว้าง
  const base = 112;
  const tip = base - H;
  const waist = base - H * 0.55;  // จุดพุงของเปลว
  return [
    `M ${70} ${base}`,
    `C ${70 + W} ${waist}, ${70 + W * 0.75} ${tip + H * 0.18}, ${70} ${tip}`,
    `C ${70 - W * 0.75} ${tip + H * 0.18}, ${70 - W} ${waist}, ${70} ${base}`,
    'Z',
  ].join(' ');
}

function Candle({ lit, pct }: { lit: boolean; pct: number }) {
  const t = useLanguageStore((s) => s.t);
  return (
    <svg viewBox="0 0 140 200" className="w-32 sm:w-36 drop-shadow-[0_0_18px_rgba(227,176,75,0.25)]" role="img" aria-label={lit ? t('healing.candle.ariaLit', 'เทียนแห่งสติลุก {pct} เปอร์เซ็นต์', { pct: Math.round(pct * 100) }) : t('healing.candle.ariaUnlit', 'เทียนแห่งสติยังไม่ได้จุด')}>
      <defs>
        <radialGradient id="candleGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={GOLD} stopOpacity="0.9" />
          <stop offset="60%" stopColor={GOLD} stopOpacity="0.25" />
          <stop offset="100%" stopColor={GOLD} stopOpacity="0" />
        </radialGradient>
        <linearGradient id="flameGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F9E3A8" />
          <stop offset="55%" stopColor={GOLD} />
          <stop offset="100%" stopColor="#C9872F" />
        </linearGradient>
        <linearGradient id="waxGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#CBBFA3" />
          <stop offset="50%" stopColor="#E8DFC8" />
          <stop offset="100%" stopColor="#B9AD91" />
        </linearGradient>
      </defs>
      {/* แสงจากเปลว */}
      <circle cx="70" cy="98" r="52" fill="url(#candleGlow)" className="candle-glow" opacity={lit ? 0.55 : 0.08} />
      {/* เปลวไฟ */}
      {lit ? (
        <g className="candle-flame">
          <path d={flamePath(pct)} fill="url(#flameGrad)" />
          <path d={flamePath(pct * 0.55)} fill="#FDF3D7" opacity="0.85" />
        </g>
      ) : (
        <path d="M 69 96 C 70 92, 70 92, 71 96" stroke="#7A6B4B" strokeWidth="1.4" fill="none" opacity="0.9" />
      )}
      {/* ไส้เทียน */}
      <line x1="70" y1="112" x2="70" y2="103" stroke="#3A2E1B" strokeWidth="2" strokeLinecap="round" />
      {/* แท่งเทียน */}
      <rect x="58" y="112" width="24" height="52" rx="3" fill="url(#waxGrad)" />
      <path d="M 58 136 C 63 131, 67 138, 72 133 C 77 128, 79 132, 82 130 L 82 164 L 58 164 Z" fill="#CFC4A6" opacity="0.55" />
      {/* เชิงเทียนทอง */}
      <path d="M 46 170 L 94 170 L 88 182 L 52 182 Z" fill={GOLD_DEEP} />
      <path d="M 38 182 L 102 182 L 96 192 L 44 192 Z" fill="#8F6B2F" />
      <rect x="48" y="164" width="44" height="6" rx="2" fill="#C99A43" />
    </svg>
  );
}

export default function HealingPage() {
  const { isAuthenticated } = useAuthStore();
  const t = useLanguageStore((s) => s.t);
  const [tab, setTab] = useState<'ธรรมะ' | 'สมาธิ' | 'สมุนไพร' | 'ติดตาม'>('ธรรมะ');
  const [teachings, setTeachings] = useState<Teaching[]>([]);
  const [herbs, setHerbs] = useState<Herb[]>([]);
  const [progress, setProgress] = useState<ProgressMetric[]>([]);
  const [meditation, setMeditation] = useState<{ total_min: number; sessions: number }>({ total_min: 0, sessions: 0 });
  const [todayMin, setTodayMin] = useState(0);

  const [chatMsg, setChatMsg] = useState('');
  const [chatReply, setChatReply] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [teachingFilter, setTeachingFilter] = useState('');

  const [medForm, setMedForm] = useState({ type: 'หายใจ', duration_min: '10', note: '' });
  const [herbCheck, setHerbCheck] = useState({ herb: '', meds: '' });
  const [herbResult, setHerbResult] = useState<any>(null);
  const [metricForm, setMetricForm] = useState({ metric: 'stress', value: '' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [tr, hr, pr, prDay] = await Promise.all([
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/healing/teachings`),
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/healing/herbs`),
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/healing/progress?days=90`),
        authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/healing/progress?days=1`),
      ]);
      const trJson = await tr.json();
      const h = await hr.json();
      const p = await pr.json();
      const pd = await prDay.json();
      setTeachings(trJson.teachings ?? []);
      setHerbs(h.herbs ?? []);
      setProgress(p.progress ?? []);
      setMeditation(p.meditation ?? { total_min: 0, sessions: 0 });
      setTodayMin(pd.meditation?.total_min ?? 0);
    } catch {
      setError(t('healing.loadFailed', 'โหลดข้อมูลไม่สำเร็จ — ตรวจสอบเซิร์ฟเวอร์'));
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) load();
  }, [isAuthenticated, load]);

  // auto-fill meds from HealthProfile (fetch /api/health/profile and merge)
  useEffect(() => {
    if (!isAuthenticated) return;
    (async () => {
      try {
        const r = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/health/profile`);
        if (!r.ok) return;
        const p = await r.json();
        const meds: string[] = Array.isArray(p.medications) ? p.medications : [];
        const conds: string[] = Array.isArray(p.conditions) ? p.conditions : [];
        const merged = [...meds, ...conds].map((s) => String(s).trim()).filter(Boolean);
        if (merged.length > 0) {
          setHerbCheck((prev) => (prev.meds.trim() === '' ? { ...prev, meds: merged.join(', ') } : prev));
        }
      } catch {}
    })();
  }, [isAuthenticated]);

  const askCompanion = async () => {
    if (!chatMsg.trim()) return;
    setChatBusy(true);
    setError('');
    try {
      const r = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/healing/companion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: chatMsg }),
      });
      const j = await r.json();
      setChatReply(j.reply ?? (j.error ?? t('healing.companion.noReply', 'ไม่มีการตอบกลับ')));
    } catch {
      setChatReply('');
      setError(t('healing.companion.failed', 'AI ปลอบโยนไม่สำเร็จ — ตรวจสอบ Ollama'));
    } finally {
      setChatBusy(false);
    }
  };

  const logMeditation = async () => {
    setMessage(''); setError('');
    try {
      const r = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/healing/meditation`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: medForm.type, duration_min: Number(medForm.duration_min) || 5, note: medForm.note }),
      });
      const j = await r.json();
      if (j.success) {
        setMessage(t('healing.meditate.saved', 'บันทึกสมาธิแล้ว {n} นาที', { n: medForm.duration_min }));
        setMedForm({ ...medForm, note: '' });
        load();
      } else setError(j.error ?? t('healing.meditate.saveFailed2', 'บันทึกไม่สำเร็จ'));
    } catch { setError(t('healing.meditate.saveFailed', 'บันทึกสมาธิไม่สำเร็จ')); }
  };

  const checkHerb = async () => {
    setMessage(''); setError('');
    try {
      const r = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/healing/herbs/check`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ herb: herbCheck.herb, meds: herbCheck.meds.split(',').map((s) => s.trim()).filter(Boolean) }),
      });
      setHerbResult(asObject(await r.json()));
    } catch { setError(t('healing.herbTab.checkFailed', 'ตรวจสมุนไพรไม่สำเร็จ')); }
  };

  const logMetric = async () => {
    setMessage(''); setError('');
    try {
      const r = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/healing/log`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metric: metricForm.metric, value: Number(metricForm.value) || 0 }),
      });
      const j = await r.json();
      if (j.success) {
        setMessage(t('healing.trackTab.saved', 'บันทึก {label} = {value}', { label: t('healing.metric.' + metricForm.metric, METRIC_LABELS[metricForm.metric] ?? metricForm.metric), value: metricForm.value }));
        setMetricForm({ ...metricForm, value: '' });
        load();
      } else setError(j.error ?? t('healing.meditate.saveFailed2', 'บันทึกไม่สำเร็จ'));
    } catch { setError(t('healing.trackTab.saveFailed', 'บันทึกตัววัดไม่สำเร็จ')); }
  };

  const cats = Array.from(new Set(teachings.map((item) => item.category)));
  const filtered = teachingFilter ? teachings.filter((item) => item.category === teachingFilter) : teachings;

  // ── เทียน: lit ตามนาทีสมาธิ 24 ชม. ล่าสุด (เป้า 30 นาที) ──
  const pct = Math.min(1, todayMin / 30);
  const lit = pct >= 0.03;
  const candleCaption = !lit
    ? t('healing.candle.captionUnlit', 'เทียนยังไม่ได้จุด — บันทึกสมาธิวันนี้ เพื่อจุดไฟแห่งสติ')
    : pct < 1 / 3
      ? t('healing.candle.captionStart', 'ไฟเริ่มลุก — {min} นาทีใน 24 ชม. สู่เป้า 30', { min: todayMin })
      : pct < 2 / 3
        ? t('healing.candle.captionRising', 'ไฟกำลังลุกโชน — {min}/30 นาที', { min: todayMin })
        : t('healing.candle.captionFull', 'ไฟแห่งสติเต็มเปี่ยม — {min} นาทีใน 24 ชม.', { min: todayMin });

  const TABS: Array<{ key: typeof tab; label: string }> = [
    { key: 'ธรรมะ', label: t('healing.tabs.dhamma', 'ธรรมะบำบัดใจ') },
    { key: 'สมาธิ', label: t('healing.tabs.meditation', 'สมาธิบำบัดกาย') },
    { key: 'สมุนไพร', label: t('healing.tabs.herbs', 'สมุนไพรคู่ยา') },
    { key: 'ติดตาม', label: t('healing.tabs.track', 'ติดตามผล') },
  ];

  return (
    <>
      <style>{`
        @keyframes candle-flicker { 0%,100% { transform: scale(1,1); } 25% { transform: scale(1.03,0.96); } 50% { transform: scale(0.97,1.04); } 75% { transform: scale(1.02,0.98); } }
        .candle-flame { transform-origin: 70px 112px; animation: candle-flicker 1.7s ease-in-out infinite; }
        @keyframes candle-glow { 0%,100% { opacity: 0.55; } 50% { opacity: 0.38; } }
        .candle-glow { animation: candle-glow 2.6s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .candle-flame, .candle-glow { animation: none; } }
      `}</style>
      <div className="min-h-screen bg-gray-950 flex">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <main className="flex-1 p-4 lg:p-6">
            <PageHeader
              eyebrow={t('healing.eyebrow', 'ชีวิต & การเงิน')}
              title={t('healing.page.title', 'ห้องเยียวยา')}
              subtitle={t('healing.page.subtitle', 'สมุนไพร/แพทย์รักษากาย — สติปัฏฐานรักษาใจ · อริยสัจเข้าใจเหตุ · อนัตตาปล่อยวาง')}
              icon={<Icon name="healing" size={18} />}
            />
            <div className="rounded-xl p-4 md:p-6 text-[#EDE3CC]" style={{ background: 'radial-gradient(1100px 420px at 50% -8%, rgba(227,176,75,0.10), transparent 65%), #151009' }}>
              <div className="max-w-5xl mx-auto space-y-5">
                {/* ── ส่วนหัว: เงียบ แต่เป็นเอกลักษณ์ — ตีกรอบคำสอนด้วยเส้นทอง ── */}
                <header className="text-center space-y-2">
                  <p className="mono text-[10px] tracking-[0.35em] text-[#B8873A] uppercase">Sovereign Buddhist Healing</p>
                  <h1 className="font-script text-4xl font-semibold text-[#EDE3CC]">{t('healing.page.title', 'ห้องเยียวยา')}</h1>
                  <p className="text-sm text-[#B99F70]">{t('healing.page.subtitle', 'สมุนไพร/แพทย์รักษากาย — สติปัฏฐานรักษาใจ · อริยสัจเข้าใจเหตุ · อนัตตาปล่อยวาง')}</p>
                  <p className="font-script italic text-[#E3B04B] text-sm leading-relaxed max-w-xl mx-auto border-y border-[#332616] py-2 px-4">
                    “จิตที่ตั้งมั่น ย่อมไม่หวั่นไหวต่อทุกขเวทนา” <span className="text-[#8A7A58] not-italic">— หลวงปู่ชา สุภัทโท</span>
                  </p>
                </header>

          {/* ── เทียนแห่งสติ — signature: ไฟลุกตามสมาธิจริง ── */}
          <section className="flex flex-col items-center gap-1 py-2" aria-label={t('healing.candle.sectionLabel', 'เทียนแห่งสติ')}>
            <Candle lit={lit} pct={pct} />
            <p className={`text-xs font-medium ${lit ? 'text-[#E3B04B]' : 'text-[#8A7A58]'}`}>{candleCaption}</p>
            <p className="text-[10px] text-[#6E6248] flex items-center justify-center gap-1"><Icon name="target" size={11} /> {t('healing.page.target', 'เป้าหมาย: สมาธิ 30 นาที/วัน')}</p>
          </section>

          {/* ── แท็บ: เส้นใต้ทองเงียบ ๆ (ไม่ใช่ปุ่มเม็ดยา) ── */}
          <nav className="flex flex-wrap gap-1 justify-center border-b border-[#332616]">
            {TABS.map((tItem) => (
              <button
                key={tItem.key}
                onClick={() => setTab(tItem.key)}
                className={`px-4 py-2.5 text-sm transition-colors border-b-2 -mb-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E3B04B] ${tab === tItem.key ? 'border-[#E3B04B] text-[#E3B04B] font-semibold' : 'border-transparent text-[#8A7A58] hover:text-[#B99F70]'}`}
              >
                {tItem.label}
              </button>
            ))}
          </nav>

          {message && <div className="bg-[#2A3A22]/70 border border-[#3D5232] text-[#A8C193] text-sm px-3 py-2 rounded-lg">{message}</div>}
          {error && <div className="bg-[#4A211A]/70 border border-[#6E3026] text-[#D9A69A] text-sm px-3 py-2 rounded-lg">{error}</div>}

          {/* ── 📿 ธรรมะบำบัดใจ ── */}
          {tab === 'ธรรมะ' && (
            <div className="grid md:grid-cols-2 gap-4">
              <div className={`${CARD} p-4 space-y-3 panel-glow`}>
                <h2 className="text-base font-semibold text-[#EDE3CC]"><span className="text-[#E3B04B]">▍</span> AI Dhamma Companion</h2>
                <p className="text-xs text-[#8A7A58]">{t('healing.companion.desc', 'เล่าให้หลวงพี่ AI ฟัง — ระบบค้นพุทธวจนะที่ตรง แล้วปลอบโยนพร้อมคำแนะนำการปฏิบัติ')}</p>
                <textarea
                  value={chatMsg}
                  onChange={(e) => setChatMsg(e.target.value)}
                  placeholder={t('healing.companion.placeholder', 'เช่น กลัวความตาย อยากฝึกใจให้สงบ...')}
                  rows={3}
                  className={`w-full ${INPUT}`}
                />
                <button onClick={askCompanion} disabled={chatBusy} className={`w-full ${BTN}`}>
                  {chatBusy ? t('healing.companion.busy', 'หลวงพี่กำลังพิจารณา... (อาจใช้เวลานานในเครื่อง CPU)') : <><Icon name="send" size={14} /> {t('healing.companion.ask', 'ถามหลวงพี่')}</>}
                </button>
                {chatReply && (
                  <div className="bg-[#120D07]/80 border-l-2 border-l-[#E3B04B] rounded-r-lg p-3 text-sm leading-relaxed whitespace-pre-wrap text-[#D9CEB2]">
                    {chatReply}
                  </div>
                )}
              </div>
              <div className={`${CARD} p-4 space-y-3 panel-cyan`}>
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-[#EDE3CC]"><span className="text-[#E3B04B]">▍</span> {t('healing.teachings.title', 'ฐานข้อมูลพุทธวจนะ')}</h2>
                  <select value={teachingFilter} onChange={(e) => setTeachingFilter(e.target.value)} className={`${INPUT} text-xs px-2 py-1.5`}>
                    <option value="">{t('healing.teachings.all', 'ทุกหมวด')}</option>
                    {cats.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                  {filtered.map((item) => (
                    <div key={item.id} className="border border-[#332616] rounded-lg p-3 space-y-1 bg-[#151009]/60">
                      <div className="flex items-center justify-between">
                        <span className="font-script font-semibold text-[#E3B04B]">{item.title}</span>
                        <span className="text-[10px] border border-[#3A2C1B] px-2 py-0.5 rounded-full text-[#B99F70]">{item.category}</span>
                      </div>
                      <p className="text-xs text-[#C9BCA4] leading-relaxed">{item.content}</p>
                      {item.application && <p className="text-[11px] text-[#93A97E]/90">{t('healing.teachings.application', 'ใช้สำหรับ: {text}', { text: item.application })}</p>}
                      {item.source && <p className="text-[10px] text-[#6E6248] flex items-center gap-1"><Icon name="book" size={11} /> {item.source}</p>}
                    </div>
                  ))}
                  {filtered.length === 0 && <p className="text-xs text-[#6E6248]">{t('healing.teachings.empty', 'ยังไม่มีหลักธรรมในหมวดนี้')}</p>}
                </div>
              </div>
            </div>
          )}

          {/* ── 🧘 สมาธิ ── */}
          {tab === 'สมาธิ' && (
            <div className="grid md:grid-cols-2 gap-4">
              <div className={`${CARD} p-4 space-y-3 panel-glow`}>
                <h2 className="text-base font-semibold text-[#EDE3CC]"><span className="text-[#E3B04B]">▍</span> {t('healing.meditate.title', 'บันทึกการเจริญสมาธิ')}</h2>
                <div className="grid grid-cols-2 gap-2">
                  <select value={medForm.type} onChange={(e) => setMedForm({ ...medForm, type: e.target.value })} className={INPUT}>
                    <option value="หายใจ">{t('healing.meditate.type.breathing', 'หายใจ')}</option><option value="เดินจงกรม">{t('healing.meditate.type.walking', 'เดินจงกรม')}</option><option value="แผ่เมตตา">{t('healing.meditate.type.lovingKindness', 'แผ่เมตตา')}</option><option value="กราบพระ">{t('healing.meditate.type.bowing', 'กราบพระ')}</option><option value="สวดมนต์">{t('healing.meditate.type.chanting', 'สวดมนต์')}</option><option value="นั่งสมาธิ">{t('healing.meditate.type.sitting', 'นั่งสมาธิ')}</option>
                  </select>
                  <input value={medForm.duration_min} onChange={(e) => setMedForm({ ...medForm, duration_min: e.target.value })} type="number" min="1" placeholder={t('healing.meditate.minutesPlaceholder', 'นาที')} className={INPUT} />
                </div>
                <input value={medForm.note} onChange={(e) => setMedForm({ ...medForm, note: e.target.value })} placeholder={t('healing.meditate.notePlaceholder', 'หมายเหตุ (เช่น รู้สึกสงบขึ้น)')} className={`w-full ${INPUT}`} />
                <button onClick={logMeditation} className={`w-full ${BTN}`}><Icon name="check" size={14} /> {t('healing.meditate.save', 'บันทึกสมาธิ')}</button>
                <p className="text-[11px] text-[#6E6248] leading-relaxed">
                  {t('healing.meditate.info1', 'การหายใจเข้าออกรู้ชัด — ฝึกสติปัฏฐานตามมหาสติปัฏฐานสูตร')}<br />
                  {t('healing.meditate.info2', 'คลื่นสมอง: Alpha (8-13Hz) = สงบตื่นรู้ · Theta (4-7Hz) = สมาธิลึก ลดปวด · Delta = หลับลึกซ่อมแซมร่างกาย')}
                </p>
              </div>
              <div className={`${CARD} p-4 space-y-3 panel-cyan`}>
                <h2 className="text-base font-semibold text-[#EDE3CC]"><span className="text-[#E3B04B]">▍</span> {t('healing.meditate.statsTitle', 'สถิติสมาธิ (90 วัน)')}</h2>
                <div className="grid grid-cols-2 gap-3 text-center">
                  <div className="bg-[#151009]/80 rounded-xl p-4 border border-[#332616]">
                    <div className="mono text-3xl font-bold text-[#E3B04B] glow-text">{meditation.total_min}</div>
                    <div className="text-xs text-[#8A7A58]">{t('healing.meditate.totalMin', 'นาทีรวม')}</div>
                  </div>
                  <div className="bg-[#151009]/80 rounded-xl p-4 border border-[#332616]">
                    <div className="mono text-3xl font-bold text-[#E3B04B] glow-text">{meditation.sessions}</div>
                    <div className="text-xs text-[#8A7A58]">{t('healing.meditate.sessions', 'ครั้งที่ทำ')}</div>
                  </div>
                </div>
                <div className="bg-[#151009]/60 border border-[#332616] rounded-lg p-3 text-xs text-[#8A7A58] space-y-1">
                  <p>{t('healing.meditate.goal', 'เป้าหมายแนะนำ: 30-45 นาที/วัน เพื่อให้ได้ประโยชน์ทางกายและใจ')}</p>
                  <p>{t('healing.meditate.theta', 'สมาธิลึก (Theta) ช่วยลดความเจ็บปวด — เห็นเวทนาเป็นแค่คลื่นที่มาแล้วไป')}</p>
                </div>
              </div>
            </div>
          )}

          {/* ── 🌿 สมุนไพรคู่ยา ── */}
          {tab === 'สมุนไพร' && (
            <div className="space-y-4">
              <div className={`${CARD} p-4 space-y-3`}>
                <h2 className="text-base font-semibold text-[#EDE3CC]"><span className="text-[#E3B04B]">▍</span> {t('healing.herbTab.title', 'ตรวจสมุนไพรกับยาที่ทาน')}</h2>
                <div className="grid md:grid-cols-2 gap-2">
                  <select value={herbCheck.herb} onChange={(e) => setHerbCheck({ ...herbCheck, herb: e.target.value })} className={INPUT}>
                    <option value="">{t('healing.herbTab.select', 'เลือกสมุนไพร')}</option>
                    {herbs.map((h) => <option key={h.name} value={h.name}>{h.name}</option>)}
                  </select>
                  <input value={herbCheck.meds} onChange={(e) => setHerbCheck({ ...herbCheck, meds: e.target.value })} placeholder={t('healing.herbTab.medsPlaceholder', 'ยาที่ทาน (คั่นด้วย , เช่น Warfarin, Paracetamol)')} className={INPUT} />
                </div>
                <button onClick={checkHerb} className={BTN}><Icon name="search" size={14} /> {t('healing.herbTab.check', 'ตรวจ')}</button>
                {herbResult && (
                  <div className={`rounded-lg p-3 text-sm border ${herbResult.safe ? 'bg-[#2A3A22]/70 border-[#3D5232] text-[#A8C193]' : 'bg-[#4A211A]/70 border-[#6E3026] text-[#D9A69A]'}`}>
                    <p className="font-semibold">{herbResult.note}</p>
                    {herbResult.conflicts?.map((c: any, i: number) => (
                      <p key={i} className="text-xs mt-1"><Icon name="alert-triangle" size={12} className="inline-block mr-1 align-[-2px]" /> {c.med} ({c.severity}): {c.note}</p>
                    ))}
                  </div>
                )}
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                {herbs.map((h) => (
                  <div key={h.name} className={`${CARD} p-4 space-y-2`}>
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-script font-semibold text-[#93A97E] flex items-center gap-1.5"><Icon name="farm" size={14} /> {h.name}</h3>
                      <Link href={`/farm?crop=${encodeURIComponent(h.name)}`} className="text-[11px] px-2 py-1 bg-[#E3B04B] text-[#1A1209] rounded font-semibold inline-flex items-center gap-1 hover:bg-[#F0C069]">
                        <Icon name="farm" size={11} /> {t('healing.herbTab.plantInGarden', 'ปลูกในสวน')}
                      </Link>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {h.uses.map((u) => <span key={u} className="text-[10px] border border-[#3A2C1B] px-2 py-0.5 rounded-full text-[#B99F70]">{u}</span>)}
                    </div>
                    <ul className="text-[11px] text-[#E3B04B]/90 space-y-0.5">
                      {h.warnings.map((w) => <li key={w} className="flex items-start gap-1"><Icon name="alert-triangle" size={11} className="mt-0.5 shrink-0" /> {w}</li>)}
                    </ul>
                    {h.interactions.length > 0 && (
                      <div className="text-[11px] text-[#8A7A58] space-y-0.5">
                        <p className="text-[#B99F70] font-semibold">{t('healing.herbTab.caution', 'ข้อควรระวังกับยา:')}</p>
                        {h.interactions.map((i) => (
                          <p key={i.med}>• {i.med} [{i.severity}]: {i.note}</p>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-[#6E6248] text-center"><Icon name="alert-triangle" size={11} className="inline-block mr-1 align-[-2px]" /> {t('healing.herbTab.footer', 'สมุนไพรเป็นยาเสริม — ไม่ใช่ยารักษาหลัก ต้องปรึกษาแพทย์ก่อนใช้ร่วมกับคีโม/ยาละลายลิ่มเลือด')}</p>
            </div>
          )}

          {/* ── 📊 ติดตามผล ── */}
          {tab === 'ติดตาม' && (
            <div className="space-y-4">
              <div className={`${CARD} p-4 space-y-3`}>
                <h2 className="text-base font-semibold text-[#EDE3CC]"><span className="text-[#E3B04B]">▍</span> {t('healing.trackTab.title', 'บันทึกตัววัดรายสัปดาห์')}</h2>
                <div className="grid md:grid-cols-3 gap-2">
                  <select value={metricForm.metric} onChange={(e) => setMetricForm({ ...metricForm, metric: e.target.value })} className={INPUT}>
                    {Object.entries(METRIC_LABELS).map(([k, v]) => <option key={k} value={k}>{t('healing.metric.' + k, v)}</option>)}
                  </select>
                  <input value={metricForm.value} onChange={(e) => setMetricForm({ ...metricForm, value: e.target.value })} type="number" step="any" placeholder={t('healing.trackTab.valuePlaceholder', 'ค่า')} className={INPUT} />
                  <button onClick={logMetric} className={BTN}><Icon name="check" size={14} /> {t('healing.trackTab.save', 'บันทึก')}</button>
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                {progress.length === 0 && (
                  <div className={`md:col-span-2 ${CARD} p-6 text-center text-sm text-[#8A7A58]`}>
                    {t('healing.trackTab.empty', 'ยังไม่มีข้อมูล — บันทึกตัววัดสัปดาห์ละครั้ง แล้วระบบจะแสดงความคืบหน้า (ก่อน vs หลัง) ที่นี่')}
                  </div>
                )}
                {progress.map((m) => {
                  const label = t('healing.metric.' + m.metric, METRIC_LABELS[m.metric] ?? m.metric);
                  return (
                    <div key={m.metric} className={`${CARD} p-4 space-y-2`}>
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-[#D9CEB2]">{label}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full border inline-flex items-center gap-1 ${m.improving ? 'bg-[#2A3A22]/70 border-[#3D5232] text-[#93A97E]' : 'bg-[#4A211A]/70 border-[#6E3026] text-[#D9A69A]'}`}>
                          {m.improving ? <><Icon name="check" size={11} /> {t('healing.trackTab.better', 'ดีขึ้น')}</> : <><Icon name="alert-triangle" size={11} /> {t('healing.trackTab.needsCare', 'ต้องดูแล')}</>}
                        </span>
                      </div>
                      <div className="flex items-end justify-between">
                        <div>
                          <div className="mono text-2xl font-bold text-[#C9BCA4]">{m.before}</div>
                          <div className="text-[10px] text-[#6E6248]">{t('healing.trackTab.before', 'ก่อน ({n} ครั้ง)', { n: m.samples })}</div>
                        </div>
                        <div className="text-xl text-[#6E6248]">→</div>
                        <div className="text-right">
                          <div className="mono text-2xl font-bold text-[#E3B04B]">{m.after}</div>
                          <div className="text-[10px] text-[#6E6248]">{t('healing.trackTab.latest', 'ล่าสุด')}</div>
                        </div>
                      </div>
                      <div className={`text-xs ${m.improving ? 'text-[#93A97E]' : 'text-[#D9A69A]'}`}>Δ {m.delta > 0 ? '+' : ''}{m.delta}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
              </div>
            </div>
          </main>
        </div>
      </div>
    </>
  );
}
