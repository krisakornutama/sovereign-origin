"use client";
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { authFetch } from '../lib/apiFetch';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';

type ItemType = 'LINK' | 'VIDEO' | 'PDF' | 'TXT' | 'WEBPAGE' | 'NOTE';

interface KnowledgeItem {
  id: string;
  type: ItemType;
  title: string;
  url: string | null;
  file_path: string | null;
  tags: string[];
  notes: string | null;
  created_at: string;
  updated_at: string;
  preview?: string | null;
  content?: string | null;
}

const TYPE_META: Record<ItemType, { icon: string; label: string; color: string }> = {
  LINK: { icon: '🔗', label: 'ลิงก์', color: 'border-blue-700 bg-blue-900/30 text-blue-300' },
  VIDEO: { icon: '🎬', label: 'วิดีโอ', color: 'border-red-700 bg-red-900/30 text-red-300' },
  PDF: { icon: '📄', label: 'PDF', color: 'border-orange-700 bg-orange-900/30 text-orange-300' },
  TXT: { icon: '📝', label: 'ไฟล์ข้อความ', color: 'border-green-700 bg-green-900/30 text-green-300' },
  WEBPAGE: { icon: '🌐', label: 'เว็บเพจ', color: 'border-cyan-700 bg-cyan-900/30 text-cyan-300' },
  NOTE: { icon: '🗒️', label: 'บันทึก', color: 'border-violet-700 bg-violet-900/30 text-violet-300' },
};

const TYPE_ORDER: ItemType[] = ['LINK', 'VIDEO', 'PDF', 'TXT', 'WEBPAGE', 'NOTE'];

// ── AI สอนลูก — บทเรียน + แบบทดสอบที่สร้างจากคลังความรู้ ──
interface TeachQuizQuestion {
  question: string;
  options: string[];
  answer: number; // index ของตัวเลือกที่ถูก
  explanation: string;
}

interface TeachLesson {
  title: string;
  age_range: string;
  summary: string;
  sections: { heading: string; content: string }[];
  key_points: string[];
  quiz: TeachQuizQuestion[];
  sources: string[];
}

const AGE_OPTIONS = [
  { id: '3-5', label: '3-5 ปี (อนุบาล)' },
  { id: '6-8', label: '6-8 ปี (ประถมต้น)' },
  { id: '9-12', label: '9-12 ปี (ประถมปลาย)' },
  { id: '13-15', label: '13-15 ปี (มัธยมต้น)' },
  { id: '16+', label: '16 ปีขึ้นไป (มัธยมปลาย)' },
];

const LESSON_TAG = 'บทเรียน'; // แท็กของบทเรียนที่เก็บในคลังความรู้

// ── โปรไฟล์เด็ก — เก็บคะแนน/บทเรียนที่เรียนจบของแต่ละคน ──
interface KidProfile {
  id: string;
  name: string;
  age: number | null;
  emoji: string | null;
  color: string | null;
}

interface KidStats {
  attempts: number;
  totalCorrect: number;
  totalQuestions: number;
  best: number | null;
  avg: number | null;
}

interface KidProgressRow {
  id: string;
  lesson_item_id: string | null;
  lesson_title: string;
  score: number;
  total: number;
  completed_at: string;
}

// ── หน้าที่ของลูก — งานบ้าน / บิล / กระเป๋าเงิน ──
interface KidChore {
  id: string;
  title: string;
  reward: number;
  emoji: string | null;
  status: string; // pending | done
  repeat: string; // none | daily
  completed_at: string | null;
}

interface KidBill {
  id: string;
  title: string;
  amount: number;
  emoji: string | null;
  period: string; // one-time | monthly
  status: string; // unpaid | paid
}

interface KidWalletTx {
  id: string;
  amount: number;
  note: string;
  category: string;
  created_at: string;
}

interface KidCoupon {
  id: string;
  title: string;
  cost: number;
  emoji: string | null;
  status: string; // available | redeemed
  redeemed_at: string | null;
}

interface KidHome {
  kid: {
    id: string; name: string; age: number | null; emoji: string | null; color: string | null;
    allowance_day: number | null; allowance_amount: number | null; allowance_last_paid: string | null;
    savings_goal: number | null; has_pin: boolean;
    piggy_target_title: string | null; piggy_target_amount: number | null;
    xp: number; level: number; money_mode: string; invest_policy: string;
  };
  chores: KidChore[];
  bills: KidBill[];
  coupons: KidCoupon[];
  balance: number;
  piggy: number;
  piggy_month: number;
  piggy_eta: { balance: number; monthlyRate: number; months: number | null };
  piggy_txs: { id: string; amount: number; note: string; created_at: string }[];
  portfolio: {
    holdings: { symbol: string; name: string; emoji: string; units: number; avg_cost: number; price: number; value: number; profit: number; profitPct: number }[];
    value: number;
    totalCost: number;
    totalProfit: number;
  };
  portfolio_history: { date: string; value: number }[];
  portfolio_performance: {
    total_deposited: number; portfolio_value: number; profit: number; profit_pct: number;
    deposits_month: number; month_start_value: number | null; month_return_pct: number | null; target_pct: number;
  };
  portfolio_deposits: { id: string; amount: number; note: string; created_at: string }[];
  certificates: { id: string; level: number; title: string; detail: string | null; created_at: string }[];
  txs: KidWalletTx[];
}

// ── หุ้นจำลองของบ้าน ──
interface KidStock {
  symbol: string;
  name: string;
  emoji: string;
  base: number;
  price: number;
}

// ── Audit log ของลูก ──
interface KidAuditRow {
  id: string;
  action: string;
  detail: string | null;
  actor: string;
  created_at: string;
}

const AUDIT_LABELS: Record<string, string> = {
  coupon_redeem: '🎟️ แลกคูปอง',
  pin_set: '🔐 ตั้ง PIN',
  pin_clear: '🔓 ล้าง PIN',
  chore_complete: '🧹 ทำงานเสร็จ',
  bill_pay: '🧾 จ่ายบิล',
  stock_buy: '📈 ซื้อหุ้น',
  stock_sell: '📉 ขายหุ้น',
  allowance_pay: '💰 ค่าขนม',
};

// ── ประวัติค่าขนมของทุกคน (จ่ายย้อนหลังได้) ──
interface AllowanceHistoryKid {
  id: string;
  name: string;
  emoji: string | null;
  allowance_day: number | null;
  allowance_amount: number | null;
  allowance_last_paid: string | null;
  txs: { id: string; amount: number; note: string; created_at: string }[];
}

const CHORE_EMOJIS = ['🧹', '🧽', '🧺', '🍳', '🚰', '🐶', '🪴', '🗑️', '🛏️', '💪'];
const BILL_EMOJIS = ['💡', '🚿', '🏠', '📱', '📺', '🌐', '🚗', '🧾'];
const WALLET_PRESETS = [10, 20, 50, 100];
const WEEKDAY_LABELS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const COUPON_EMOJIS = ['🎮', '📺', '🍦', '🎁', '🎬', '📱', '🏞️', '🧸', '🎨', '🏊'];
const COUPON_PRESETS = ['เล่นเกม 30 นาที', 'ดูทีวี 1 ชั่วโมง', 'ไอศกรีม 1 ถ้วย', 'ออกไปเล่นนอกบ้าน', 'เลือกเมนูอาหารเย็น', 'เงินค่าแป้งพิเศษ'];
const PIGGY_PRESETS = [10, 20, 50, 100];

// ── รายงานรายสัปดาห์ (PDF) — โครงสร้างจาก GET /teach/report/weekly ──
interface WeeklyReportKid {
  id: string;
  name: string;
  age: number | null;
  emoji: string | null;
  color: string | null;
  allowance_day: number | null;
  allowance_amount: number | null;
  stats: KidStats;
  progress: KidProgressRow[];
  chores: KidChore[];
  bills: KidBill[];
  txs: KidWalletTx[];
  balance: number;
}

const KID_EMOJIS = ['🧒', '👧', '👦', '🧑', '👶', '🦁', '🐯', '🐰', '🦊', '🐼', '🦄', '🤖'];
const ACTIVE_KID_KEY = 'sovereign-active-kid'; // localStorage

// ดึง YouTube / Vimeo video id สำหรับ embed
function videoEmbedUrl(url: string): string | null {
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const vm = url.match(/vimeo\.com\/(\d+)/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  return null;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

// จ่ายค่าขนมครบสัปดาห์นี้หรือยัง? (เทียบ anchor = ครั้งล่าสุดของวันจ่าย)
function isPaidThisWeek(day: number | null, lastPaid: string | null, now = new Date()): boolean {
  if (day == null || !lastPaid) return false;
  const diff = (now.getDay() - day + 7) % 7;
  const anchor = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff);
  return new Date(lastPaid) >= anchor;
}

// ── กราฟคะแนนตามเวลา (SVG — วาดเอง ไม่พึ่ง library) ──
const CHART_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#a78bfa', '#22d3ee', '#f472b6'];

function kidColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return CHART_COLORS[h % CHART_COLORS.length];
}

interface ScoreSeries {
  name: string;
  color: string;
  points: { time: number; pct: number; label: string }[];
}

function ScoreTrendChart({ series }: { series: ScoreSeries[] }) {
  const W = 560;
  const H = 230;
  const PAD = { top: 16, right: 14, bottom: 32, left: 36 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const Y_MAX = 100;

  if (series.length === 0) return null;

  const allTimes = series.flatMap((s) => s.points.map((p) => p.time));
  let tMin = Math.min(...allTimes);
  let tMax = Math.max(...allTimes);
  if (tMax === tMin) {
    tMin -= 86400000;
    tMax += 86400000;
  }
  const tSpan = tMax - tMin;
  const x = (t: number) => PAD.left + ((t - tMin) / tSpan) * innerW;
  const y = (pct: number) => PAD.top + ((Y_MAX - pct) / Y_MAX) * innerH;

  // ป้ายเวลาแกน X — แบ่งเป็น 4-5 จุด
  const xTicks = Array.from({ length: 5 }, (_, i) => tMin + (tSpan * i) / 4);
  const fmtTick = (t: number) =>
    new Date(t).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit' });

  return (
    <div className="bg-gray-950/50 border border-gray-800 rounded-lg p-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="กราฟคะแนนแบบทดสอบตามเวลา">
        {/* เส้นตารางแนวนอน 0/25/50/75/100 */}
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1={PAD.left} y1={y(v)} x2={W - PAD.right} y2={y(v)} stroke="#1f2937" strokeWidth="1" />
            <text x={PAD.left - 6} y={y(v) + 3} textAnchor="end" fontSize="9" fill="#6b7280">{v}%</text>
          </g>
        ))}
        {/* แกน X */}
        {xTicks.map((t, i) => (
          <text key={i} x={x(t)} y={H - 10} textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'} fontSize="9" fill="#6b7280">
            {fmtTick(t)}
          </text>
        ))}
        {/* เส้นของแต่ละคน */}
        {series.map((s) => (
          <g key={s.name}>
            {s.points.length === 1 ? (
              <circle cx={x(s.points[0].time)} cy={y(s.points[0].pct)} r="4" fill={s.color} />
            ) : (
              <polyline
                points={s.points.map((p) => `${x(p.time)},${y(p.pct)}`).join(' ')}
                fill="none"
                stroke={s.color}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity="0.9"
              />
            )}
            {s.points.map((p, i) => (
              <circle key={i} cx={x(p.time)} cy={y(p.pct)} r="3" fill="#0b0f19" stroke={s.color} strokeWidth="1.5">
                <title>{`${s.name} — ${p.label}: ${p.pct}% (${fmtDate(new Date(p.time).toISOString())})`}</title>
              </circle>
            ))}
          </g>
        ))}
      </svg>
      {/* ตำนาน */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {series.map((s) => (
          <span key={s.name} className="flex items-center gap-1.5 text-[11px] text-gray-400">
            <span className="w-3 h-0.5 rounded" style={{ background: s.color }} />
            {s.name} <span className="text-gray-600">({s.points.length} ครั้ง)</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ── กราฟมูลค่าพอร์ตหุ้นย้อนหลัง (SVG วาดเอง — ไม่พึ่ง library) ──
function PortfolioHistoryChart({ data }: { data: { date: string; value: number }[] }) {
  const W = 560;
  const H = 180;
  const PAD = { top: 16, right: 14, bottom: 30, left: 52 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  if (data.length < 2) return null;
  const values = data.map((d) => d.value);
  let vMin = Math.min(...values);
  let vMax = Math.max(...values);
  if (vMax === vMin) {
    vMin -= 1;
    vMax += 1;
  }
  const span = vMax - vMin;
  const x = (i: number) => PAD.left + (i / (data.length - 1)) * innerW;
  const y = (v: number) => PAD.top + ((vMax - v) / span) * innerH;
  const pts = data.map((d, i) => `${x(i)},${y(d.value)}`).join(' ');
  const first = data[0];
  const last = data[data.length - 1];
  const pct = first.value > 0 ? Math.round(((last.value - first.value) / first.value) * 100) : 0;
  const up = last.value >= first.value;
  const fmt = (d: string) => d.slice(5).replace('-', '/');

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-gray-500">📊 มูลค่าพอร์ตย้อนหลัง ({data.length} วัน)</span>
        <span className={up ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
          {up ? '+' : ''}{pct}% · {last.value.toLocaleString()}฿
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        {/* gridlines */}
        {[0, 0.5, 1].map((f) => (
          <line key={f} x1={PAD.left} x2={W - PAD.right} y1={PAD.top + f * innerH} y2={PAD.top + f * innerH} stroke="#1f2937" strokeWidth="1" />
        ))}
        <text x={4} y={PAD.top + 4} fill="#6b7280" fontSize="9">{vMax.toFixed(0)}฿</text>
        <text x={4} y={PAD.top + innerH / 2 + 3} fill="#6b7280" fontSize="9">{((vMax + vMin) / 2).toFixed(0)}฿</text>
        <text x={4} y={H - PAD.bottom + 4} fill="#6b7280" fontSize="9">{vMin.toFixed(0)}฿</text>
        <polyline points={pts} fill="none" stroke={up ? '#34d399' : '#f87171'} strokeWidth="2" strokeLinejoin="round" />
        {data.map((d, i) => (
          <circle key={i} cx={x(i)} cy={y(d.value)} r={2.5} fill={up ? '#34d399' : '#f87171'}>
            <title>{`${d.date} · ${d.value.toLocaleString()}฿`}</title>
          </circle>
        ))}
        <text x={PAD.left} y={H - 8} fill="#4b5563" fontSize="9">{fmt(first.date)}</text>
        <text x={W - PAD.right - 30} y={H - 8} fill="#4b5563" fontSize="9">{fmt(last.date)}</text>
      </svg>
    </div>
  );
}

// ── สร้าง HTML สำหรับรายงานรายสัปดาห์ (พิมพ์/PDF) — กราฟคะแนนเป็น SVG inline ──
function buildWeeklyReportHtml(kids: WeeklyReportKid[], generatedAt?: string): string {
  const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const pct = (p: { score: number; total: number }) => (p.total > 0 ? Math.round((p.score / p.total) * 100) : 0);
  const fmtD = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit' });
    } catch {
      return iso;
    }
  };

  // กราฟคะแนน (SVG) ของคนเดียว — เส้นตามเวลา
  const scoreSvg = (k: WeeklyReportKid) => {
    const pts = k.progress.map((p) => ({ time: new Date(p.completed_at).getTime(), pct: pct(p) }));
    if (pts.length === 0) return '<p class="muted">ยังไม่มีคะแนนแบบทดสอบใน 7 วันนี้</p>';
    const W = 560, H = 150, PL = 32, PR = 10, PT = 10, PB = 24;
    const iw = W - PL - PR, ih = H - PT - PB;
    let tMin = Math.min(...pts.map((p) => p.time));
    let tMax = Math.max(...pts.map((p) => p.time));
    if (tMax === tMin) { tMin -= 86400000; tMax += 86400000; }
    const x = (t: number) => PL + ((t - tMin) / (tMax - tMin)) * iw;
    const y = (v: number) => PT + ((100 - v) / 100) * ih;
    const line = pts.length === 1
      ? ''
      : `<polyline points="${pts.map((p) => `${x(p.time).toFixed(1)},${y(p.pct).toFixed(1)}`).join(' ')}" fill="none" stroke="#10b981" stroke-width="2"/>`;
    const dots = pts.map((p) => `<circle cx="${x(p.time).toFixed(1)}" cy="${y(p.pct).toFixed(1)}" r="3" fill="#0f172a" stroke="#10b981" stroke-width="1.5"/>`).join('');
    const grid = [0, 25, 50, 75, 100].map((v) =>
      `<line x1="${PL}" y1="${y(v).toFixed(1)}" x2="${W - PR}" y2="${y(v).toFixed(1)}" stroke="#e2e8f0" stroke-width="1"/><text x="${PL - 5}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" font-size="8" fill="#94a3b8">${v}%</text>`
    ).join('');
    const xTicks = Array.from({ length: 5 }, (_, i) => tMin + ((tMax - tMin) * i) / 4).map((t) =>
      `<text x="${x(t).toFixed(1)}" y="${H - 7}" text-anchor="middle" font-size="8" fill="#94a3b8">${fmtD(new Date(t).toISOString())}</text>`
    ).join('');
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">${grid}${xTicks}${line}${dots}</svg>`;
  };

  const txs = (k: WeeklyReportKid) => {
    if (k.txs.length === 0) return '<p class="muted">ไม่มีรายรับ-รายจ่ายใน 7 วันนี้</p>';
    const cat: Record<string, string> = { chore: '🧹 ทำงาน', bill: '🧾 จ่ายบิล', manual: '💸 ปรับยอด', allowance: '💰 ค่าขนม', coupon: '🎟️ แลกคูปอง' };
    return `<ul class="tight">${k.txs.slice(0, 12).map((t) =>
      `<li><b>${t.amount >= 0 ? '+' : ''}${t.amount}฿</b> — ${cat[t.category] || t.category}${t.note ? ` · ${esc(t.note)}` : ''} <span class="muted">(${fmtD(t.created_at)})</span></li>`
    ).join('')}</ul>`;
  };

  const kidHtml = kids.map((k) => {
    const st = k.stats;
    const choresDone = k.chores.filter((c) => c.status === 'done').length;
    const choresPending = k.chores.filter((c) => c.status === 'pending').length;
    const billsUnpaid = k.bills.filter((b) => b.status === 'unpaid').length;
    const allow = k.allowance_amount != null ? `<p class="muted">ค่าขนม: ทุกวัน${WEEKDAY_LABELS[k.allowance_day ?? 0]} ${k.allowance_amount}฿/สัปดาห์</p>` : '';
    return `<section class="kid">
<h2>${k.emoji || '🧒'} ${esc(k.name)}${k.age != null ? ` <span class="muted">(${k.age} ปี)</span>` : ''}</h2>
<div class="chips">
<span>📖 เรียนจบ 7 วัน: <b>${k.progress.length}</b> บทเรียน</span>
<span>📊 เฉลี่ย: <b>${st.avg ?? 0}%</b></span>
<span>🏆 ดีที่สุด: <b>${st.best ?? 0}%</b></span>
<span>🧹 งาน: <b>${choresDone}</b> เสร็จ / <b>${choresPending}</b> ค้าง</span>
<span>🧾 บิลค้าง: <b>${billsUnpaid}</b> ใบ</span>
<span>💰 ยอดเงิน: <b>${k.balance.toLocaleString()}฿</b></span>
</div>
${allow}
<h3>คะแนนแบบทดสอบตามเวลา</h3>
${scoreSvg(k)}
${k.progress.length ? `<ul class="tight">${k.progress.slice(-10).map((p) => `<li>${esc(p.lesson_title)} — <b>${p.score}/${p.total}</b> (${pct(p)}%) <span class="muted">${fmtD(p.completed_at)}</span></li>`).join('')}</ul>` : ''}
<h3>รายรับ-รายจ่าย (7 วัน)</h3>
${txs(k)}
<h3>งานบ้าน</h3>
${k.chores.length ? `<ul class="tight">${k.chores.slice(0, 10).map((c) => `<li>${c.emoji || '📋'} ${esc(c.title)} — <b>${c.reward}฿</b> ${c.status === 'done' ? '<span style="color:#16a34a">✓ เสร็จ</span>' : '<span style="color:#d97706">⏳ ค้าง</span>'}</li>`).join('')}</ul>` : '<p class="muted">ไม่มีงานบ้าน</p>'}
<h3>บิล</h3>
${k.bills.length ? `<ul class="tight">${k.bills.slice(0, 10).map((b) => `<li>${b.emoji || '🧾'} ${esc(b.title)} — <b>${b.amount.toLocaleString()}฿</b> ${b.period === 'monthly' ? '<span class="muted">(รายเดือน)</span> ' : ''}${b.status === 'paid' ? '<span style="color:#16a34a">✓ จ่ายแล้ว</span>' : '<span style="color:#dc2626">ยังไม่จ่าย</span>'}</li>`).join('')}</ul>` : '<p class="muted">ไม่มีบิล</p>'}
</section>`;
  }).join('');

  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8"/>
<title>รายงานความก้าวหน้าลูก รายสัปดาห์</title>
<style>
  body { font-family: 'Leelawadee UI', 'Noto Sans Thai', Tahoma, sans-serif; color: #1e293b; max-width: 760px; margin: 32px auto; padding: 0 24px; line-height: 1.55; }
  h1 { font-size: 24px; color: #065f46; margin-bottom: 4px; }
  h2 { font-size: 18px; color: #065f46; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; margin-top: 26px; }
  h3 { font-size: 13px; color: #475569; margin: 14px 0 6px; text-transform: uppercase; letter-spacing: 0.4px; }
  .muted { color: #94a3b8; font-size: 11px; font-weight: normal; }
  .kid { break-inside: avoid; margin-bottom: 8px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
  .chips span { background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 6px; padding: 3px 8px; font-size: 11px; }
  ul.tight { margin: 4px 0 8px; padding-left: 20px; font-size: 12px; }
  ul.tight li { margin: 2px 0; }
  .meta { font-size: 11px; color: #94a3b8; margin-bottom: 12px; }
  @media print { body { margin: 0; } .kid { break-inside: avoid; } }
</style>
</head>
<body>
<h1>📚 รายงานความก้าวหน้าของลูก (7 วัน)</h1>
<div class="meta">สร้างเมื่อ ${generatedAt ? new Date(generatedAt).toLocaleString('th-TH', { dateStyle: 'long', timeStyle: 'short' }) : ''} · Sovereign OS — AI สอนลูก</div>
${kidHtml}
</body>
</html>`;
}

export default function KnowledgePage() {
  const { user, isAuthenticated, token, isHydrated } = useAuthStore();
  const isSuperadmin = user?.role === 'SUPERADMIN';

  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [typeFilter, setTypeFilter] = useState<ItemType | 'ALL'>('ALL');
  const [selected, setSelected] = useState<KnowledgeItem | null>(null);
  const [detail, setDetail] = useState<KnowledgeItem | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // เพิ่ม / นำเข้า / อัปโหลด
  const [showAdd, setShowAdd] = useState(false);
  const [addMode, setAddMode] = useState<'manual' | 'import' | 'upload'>('manual');
  const [addForm, setAddForm] = useState<{ type: ItemType; title: string; url: string; content: string; tags: string; notes: string }>({
    type: 'LINK', title: '', url: '', content: '', tags: '', notes: '',
  });
  const [importing, setImporting] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [importTitle, setImportTitle] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // ค้นหา
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [indexInfo, setIndexInfo] = useState<{ files: number; chunks: number; model: string } | null>(null);

  // ไฟล์คู่มือ (legacy)
  const [manualFiles, setManualFiles] = useState<string[]>([]);
  const [manualFile, setManualFile] = useState('');
  const [manualContent, setManualContent] = useState('');

  // ── AI สอนลูก ──
  const [teachTopic, setTeachTopic] = useState('');
  const [teachAge, setTeachAge] = useState('6-8');
  const [teachQuizCount, setTeachQuizCount] = useState(3); // จำนวนข้อแบบทดสอบ (1-10)
  const [teachModel, setTeachModel] = useState(''); // '' = โมเดลเริ่มต้นของระบบ
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [teaching, setTeaching] = useState(false);
  const [teachError, setTeachError] = useState('');
  const [lesson, setLesson] = useState<TeachLesson | null>(null);
  const [lessonUsedKnowledge, setLessonUsedKnowledge] = useState(false);
  const [savedLessons, setSavedLessons] = useState<KnowledgeItem[]>([]);
  const [lessonSaving, setLessonSaving] = useState(false);
  // สถานะทำแบบทดสอบ: quizAnswers[i] = ตัวเลือกที่เลือก (-1 = ยังไม่ได้ตอบ)
  const [quizAnswers, setQuizAnswers] = useState<number[]>([]);

  // ── โปรไฟล์เด็ก ──
  const [kids, setKids] = useState<KidProfile[]>([]);
  const [activeKidId, setActiveKidId] = useState<string | null>(null);
  const [kidStats, setKidStats] = useState<Record<string, KidStats>>({});
  const [kidProgress, setKidProgress] = useState<KidProgressRow[]>([]);
  const [showAddKid, setShowAddKid] = useState(false);
  const [kidForm, setKidForm] = useState<{ name: string; age: string; emoji: string }>({ name: '', age: '', emoji: '🧒' });
  const kidRecordedRef = useRef<string | null>(null); // กันบันทึกคะแนนซ้ำ

  // ── หน้าที่ของลูก — งานบ้าน / บิล / กระเป๋าเงิน ──
  const [kidHome, setKidHome] = useState<KidHome | null>(null);
  const [showKidHome, setShowKidHome] = useState(false);
  const [homeLoading, setHomeLoading] = useState(false);
  const [choreForm, setChoreForm] = useState<{ title: string; reward: string; emoji: string }>({ title: '', reward: '10', emoji: '🧹' });
  const [billForm, setBillForm] = useState<{ title: string; amount: string; emoji: string; period: string }>({ title: '', amount: '20', emoji: '💡', period: 'one-time' });
  const [walletAmount, setWalletAmount] = useState('');
  const [walletNote, setWalletNote] = useState('');
  const [couponForm, setCouponForm] = useState<{ title: string; cost: string; emoji: string }>({ title: '', cost: '50', emoji: '🎮' });
  const [allowanceForm, setAllowanceForm] = useState<{ day: string; amount: string }>({ day: '0', amount: '20' });
  const [reportLoading, setReportLoading] = useState(false);
  const [piggyForm, setPiggyForm] = useState<{ amount: string; note: string }>({ amount: '', note: '' });
  const [goalForm, setGoalForm] = useState<{ amount: string }>({ amount: '100' });
  const [pinForm, setPinForm] = useState('');
  const [choreRepeat, setChoreRepeat] = useState<'none' | 'daily'>('none');
  const [targetForm, setTargetForm] = useState<{ title: string; amount: string }>({ title: '', amount: '500' });
  const [stocks, setStocks] = useState<KidStock[]>([]);
  const [stockForm, setStockForm] = useState<{ symbol: string; units: string }>({ symbol: 'FARM', units: '1' });
  const [audit, setAudit] = useState<KidAuditRow[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [policyText, setPolicyText] = useState('');
  const [savingTip, setSavingTip] = useState(false);
  const [depositForm, setDepositForm] = useState<{ amount: string; note: string }>({ amount: '', note: '' });
  const [targetPctForm, setTargetPctForm] = useState<{ pct: string }>({ pct: '2' });

  // ── ประวัติค่าขนมทุกคน ──
  const [showAllowanceHistory, setShowAllowanceHistory] = useState(false);
  const [allowanceHistory, setAllowanceHistory] = useState<AllowanceHistoryKid[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  // ── สรุปความคืบหน้าทุกคน + กราฟคะแนนตามเวลา ──
  const [showProgress, setShowProgress] = useState(false);
  const [allProgress, setAllProgress] = useState<Record<string, KidProgressRow[]>>({});
  const [progressLoading, setProgressLoading] = useState(false);

  const loadItems = useCallback(async () => {
    try {
      const q = typeFilter === 'ALL' ? '' : `?type=${typeFilter}`;
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/items${q}`);
      if (!res.ok) throw new Error('Failed to load');
      setItems(await res.json());
      setError('');
    } catch (err) {
      setError('โหลดคลังความรู้ไม่สำเร็จ — ตรวจว่า Backend เปิดอยู่');
    } finally {
      setLoading(false);
    }
  }, [typeFilter]);

  const loadManualFiles = useCallback(async () => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/files`);
      if (res.ok) setManualFiles((await res.json()).files || []);
    } catch {
      // เงียบ
    }
  }, []);

  const loadIndexStatus = useCallback(async () => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/index/status`);
      if (res.ok) setIndexInfo(await res.json());
    } catch {
      // backend ไม่มี semantic module → ข้าม
    }
  }, []);

  // โมเดล Ollama ที่เลือกได้สำหรับสร้างบทเรียน
  const loadOllamaModels = useCallback(async () => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/models`);
      if (!res.ok) return;
      const data = await res.json();
      const models = (data.models || []).filter((m: string) => !m.startsWith('nomic-embed')); // เอา embedding model ออก
      setOllamaModels(models);
    } catch {
      // เงียบ — ใช้โมเดลเริ่มต้นของระบบ
    }
  }, []);

  useEffect(() => {
    if (!isHydrated || !isAuthenticated || !token) return;
    loadItems();
    loadManualFiles();
    loadIndexStatus();
    loadOllamaModels();
  }, [isHydrated, isAuthenticated, token, loadItems, loadManualFiles, loadIndexStatus, loadOllamaModels]);

  const openItem = async (item: KnowledgeItem) => {
    setSelected(item);
    setDetail(null);
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/items/${item.id}`);
      if (res.ok) {
        const data = await res.json();
        setDetail(data);
        setSelected(data);
      }
    } catch {
      setDetail(item);
    }
  };

  const parseTags = (raw: string): string[] => raw.split(',').map((t) => t.trim()).filter(Boolean);

  const createItem = async () => {
    if (!addForm.title.trim()) {
      setError('กรุณากรอกชื่อ/หัวข้อ');
      return;
    }
    setError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: addForm.type,
          title: addForm.title.trim(),
          url: addForm.url.trim() || undefined,
          content: addForm.content,
          tags: parseTags(addForm.tags),
          notes: addForm.notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'สร้างไม่สำเร็จ');
      setMessage(`✅ เพิ่ม "${data.item.title}" แล้ว`);
      setAddForm({ type: 'LINK', title: '', url: '', content: '', tags: '', notes: '' });
      setShowAdd(false);
      loadItems();
    } catch (err: any) {
      setError(err.message || 'สร้างไม่สำเร็จ');
    }
  };

  const importFromUrl = async () => {
    const url = importUrl.trim();
    if (!/^https?:\/\//i.test(url)) {
      setError('URL ต้องขึ้นต้นด้วย http(s)://');
      return;
    }
    setImporting(true);
    setError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, title: importTitle.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'นำเข้าไม่สำเร็จ');
      setMessage(`✅ นำเข้าสำเร็จ: "${data.item.title}" (สกัดข้อความ ${data.extractedChars ?? 0} ตัวอักษร)`);
      setImportUrl('');
      setImportTitle('');
      setShowAdd(false);
      loadItems();
    } catch (err: any) {
      setError(err.message || 'นำเข้าไม่สำเร็จ');
    } finally {
      setImporting(false);
    }
  };

  const uploadFile = async (file: File) => {
    setUploading(true);
    setError('');
    const form = new FormData();
    form.append('file', file);
    form.append('tags', '');
    form.append('notes', '');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/upload`, {
        method: 'POST',
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'อัปโหลดไม่สำเร็จ');
      setMessage(`✅ อัปโหลด "${data.item.title}" แล้ว${data.extractedChars ? ` (สกัดข้อความ ${data.extractedChars} ตัวอักษร)` : ''}`);
      setShowAdd(false);
      loadItems();
    } catch (err: any) {
      setError(err.message || 'อัปโหลดไม่สำเร็จ');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const deleteItem = async (item: KnowledgeItem) => {
    if (!confirm(`ลบ "${item.title}" จากคลังความรู้?`)) return;
    try {
      await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/items/${item.id}`, { method: 'DELETE' });
      setMessage(`🗑️ ลบ "${item.title}" แล้ว`);
      if (selected?.id === item.id) setSelected(null);
      loadItems();
    } catch {
      setError('ลบไม่สำเร็จ');
    }
  };

  const runSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery.trim(), top_k: 8 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'ค้นหาไม่สำเร็จ');
      setSearchResults(data.results || []);
    } catch (err: any) {
      setError(err.message || 'ค้นหาไม่สำเร็จ');
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const rebuildIndex = async () => {
    if (!confirm('สร้าง index ใหม่ (embed ไฟล์คู่มือ + รายการในคลังความรู้)? อาจใช้เวลาสักครู่')) return;
    setError('');
    setMessage('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/index`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'สร้าง index ไม่สำเร็จ');
      setMessage(`✅ สร้าง index สำเร็จ: ${data.chunks} chunks จาก ${data.files} รายการ`);
      loadIndexStatus();
    } catch (err: any) {
      setError(err.message || 'สร้าง index ไม่สำเร็จ (ต้องมี Ollama + embedding model)');
    }
  };

  const openManual = async (file: string) => {
    setManualFile(file);
    setError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/file/${file}`);
      if (!res.ok) throw new Error('File not found');
      setManualContent((await res.json()).content || '');
    } catch {
      setError(`ไม่สามารถโหลดไฟล์ ${file} ได้`);
      setManualContent('');
    }
  };

  const saveManual = async () => {
    if (!manualFile) return;
    try {
      await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/file/${manualFile}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: manualContent }),
      });
      setMessage('✅ บันทึกคู่มือสำเร็จ');
    } catch {
      setError('ไม่สามารถบันทึกไฟล์ได้');
    }
  };

  // เปิดผลค้นหา — 📚 prefix = knowledge item, อื่น = ไฟล์คู่มือ
  const openSearchResult = (r: any) => {
    if (r.file && r.file.startsWith('📚 ')) {
      const m = r.file.match(/\[([0-9a-f-]{36})\]/);
      if (m) {
        const item = items.find((i) => i.id === m[1]);
        if (item) {
          openItem(item);
          setSearchResults(null);
          return;
        }
      }
    }
    openManual(r.file);
    setSearchResults(null);
  };

  // ── AI สอนลูก ──

  // โหลดบทเรียนที่เคยเก็บไว้ (NOTE + แท็ก "บทเรียน")
  const loadSavedLessons = useCallback(async () => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/items`);
      if (!res.ok) return;
      const all = (await res.json()) as KnowledgeItem[];
      setSavedLessons(all.filter((i) => (i.tags || []).includes(LESSON_TAG)));
    } catch {
      // เงียบ — ยังเปิดใช้งานโหมดอื่นได้
    }
  }, []);

  useEffect(() => {
    if (isHydrated && isAuthenticated) loadSavedLessons();
  }, [isHydrated, isAuthenticated, loadSavedLessons]);

  const teachAgeLabel = (id: string) => AGE_OPTIONS.find((a) => a.id === id)?.label || id;

  // เรียก AI สร้างบทเรียน (ผู้ใหญ่เลือกหัวข้อ + ระดับอายุ)
  const runTeachGenerate = async () => {
    const topic = teachTopic.trim();
    if (!topic) {
      setTeachError('กรุณากรอกหัวข้อที่อยากให้ AI สอนลูก — เช่น "น้ำ", "ระบบสุริยะ", "การเอาตัวรอดจากน้ำท่วม"');
      return;
    }
    setTeaching(true);
    setTeachError('');
    setLesson(null);
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, ageRange: teachAge, quizCount: teachQuizCount, model: teachModel || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'สร้างบทเรียนไม่สำเร็จ');
      setLesson(data.lesson);
      setLessonUsedKnowledge(!!data.usedKnowledge);
      setQuizAnswers(data.lesson.quiz ? data.lesson.quiz.map(() => -1) : []);
    } catch (err: any) {
      setTeachError(err.message || 'สร้างบทเรียนไม่สำเร็จ — ตรวจว่า Ollama เปิดอยู่');
      setLesson(null);
    } finally {
      setTeaching(false);
    }
  };

  // เก็บบทเรียนนี้ไว้ในคลังความรู้
  const saveGeneratedLesson = async () => {
    if (!lesson || lessonSaving) return;
    setLessonSaving(true);
    setTeachError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lesson }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'บันทึกไม่สำเร็จ');
      setMessage(`✅ เก็บบทเรียน "${lesson.title}" ไว้ในคลังความรู้แล้ว`);
      loadSavedLessons();
    } catch (err: any) {
      setTeachError(err.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setLessonSaving(false);
    }
  };

  // เปิดบทเรียนที่เคยเก็บไว้ — ใช้ notes (JSON) เพื่อเล่นแบบทดสอบแบบอินเทอร์แอคทีฟ
  const openSavedLesson = (item: KnowledgeItem) => {
    try {
      const parsed = JSON.parse(item.notes || '');
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.quiz)) {
        setLesson(parsed as TeachLesson);
        setLessonUsedKnowledge(false);
        setQuizAnswers(parsed.quiz.map(() => -1));
        setTeachError('');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
    } catch {
      // notes ไม่ใช่ JSON — เปิดเป็น NOTE ธรรมดา
    }
    openItem(item);
  };

  const pickQuizOption = (qi: number, oi: number) => {
    if (quizAnswers[qi] >= 0) return; // ตอบแล้ว — ล็อกคำตอบ
    setQuizAnswers((prev) => prev.map((a, i) => (i === qi ? oi : a)));
  };

  const resetQuiz = () => setQuizAnswers((prev) => prev.map(() => -1));

  // ── โปรไฟล์เด็ก ──

  const loadKids = useCallback(async () => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids`);
      if (!res.ok) return;
      const data = await res.json();
      setKids(data.kids || []);
      // คืนค่าโปรไฟล์ที่เลือกไว้ (localStorage) ถ้ายังมีอยู่
      const saved = localStorage.getItem(ACTIVE_KID_KEY);
      const stillExists = saved && (data.kids || []).some((k: KidProfile) => k.id === saved);
      setActiveKidId(stillExists ? saved : (data.kids?.[0]?.id ?? null));
    } catch {
      // backend ยังไม่มีโมดูลนี้ → ข้าม
    }
  }, []);

  const loadKidProgress = useCallback(async (kidId: string) => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${kidId}/progress`);
      if (!res.ok) return;
      const data = await res.json();
      setKidProgress(data.progress || []);
      setKidStats((prev) => ({ ...prev, [kidId]: data.stats }));
    } catch {
      // เงียบ
    }
  }, []);

  useEffect(() => {
    if (isHydrated && isAuthenticated) loadKids();
  }, [isHydrated, isAuthenticated, loadKids]);

  useEffect(() => {
    if (activeKidId) {
      localStorage.setItem(ACTIVE_KID_KEY, activeKidId);
      loadKidProgress(activeKidId);
    } else {
      setKidProgress([]);
      setKidHome(null);
    }
  }, [activeKidId, loadKidProgress]);

  const createKidUI = async () => {
    const name = kidForm.name.trim();
    if (!name) {
      setTeachError('ต้องใส่ชื่อเด็กก่อน');
      return;
    }
    setTeachError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, age: kidForm.age ? Number(kidForm.age) : undefined, emoji: kidForm.emoji }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'เพิ่มไม่สำเร็จ');
      setMessage(`✅ เพิ่มโปรไฟล์ "${name}" แล้ว`);
      setKidForm({ name: '', age: '', emoji: '🧒' });
      setShowAddKid(false);
      await loadKids();
    } catch (err: any) {
      setTeachError(err.message || 'เพิ่มโปรไฟล์ไม่สำเร็จ');
    }
  };

  const deleteKidUI = async (kid: KidProfile) => {
    if (!confirm(`ลบโปรไฟล์ "${kid.name}" (รวมประวัติคะแนน)?`)) return;
    try {
      await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${kid.id}`, { method: 'DELETE' });
      if (activeKidId === kid.id) {
        localStorage.removeItem(ACTIVE_KID_KEY);
        setActiveKidId(null);
      }
      setKidStats((prev) => { const next = { ...prev }; delete next[kid.id]; return next; });
      await loadKids();
    } catch {
      setTeachError('ลบโปรไฟล์ไม่สำเร็จ');
    }
  };

  // เมื่อทำแบบทดสอบเสร็จครบทุกข้อ (และมีโปรไฟล์เด็กที่เลือก) → บันทึกคะแนนอัตโนมัติ
  useEffect(() => {
    if (!lesson || !activeKidId || lesson.quiz.length === 0) return;
    const allAnswered = quizAnswers.every((a) => a >= 0);
    if (!allAnswered) return;
    const score = lesson.quiz.filter((_, i) => quizAnswers[i] === lesson.quiz[i].answer).length;
    const signature = `${lesson.title}|${score}/${lesson.quiz.length}`;
    if (kidRecordedRef.current === signature) return;
    kidRecordedRef.current = signature;
    authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lessonTitle: lesson.title,
        score,
        total: lesson.quiz.length,
        lessonItemId: null,
      }),
    })
      .then((res) => (res.ok ? loadKidProgress(activeKidId) : null))
      .catch(() => { kidRecordedRef.current = null; });
  }, [lesson, activeKidId, quizAnswers, loadKidProgress]);

  // ── หน้าที่ของลูก — โหลดงานบ้าน/บิล/กระเป๋าเงินของเด็กที่เลือก ──
  const loadKidHome = useCallback(async (kidId: string) => {
    setHomeLoading(true);
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${kidId}/home`);
      if (!res.ok) return;
      setKidHome(await res.json());
    } catch {
      setKidHome(null);
    } finally {
      setHomeLoading(false);
    }
  }, []);

  // ── งานบ้าน ──
  const addChoreUI = async () => {
    if (!activeKidId) return;
    const title = choreForm.title.trim();
    if (!title) {
      setTeachError('ต้องใส่ชื่องานบ้านก่อน — เช่น "กวาดบ้าน"');
      return;
    }
    setTeachError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/chores`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, reward: Math.max(1, Number(choreForm.reward) || 1), emoji: choreForm.emoji, repeat: choreRepeat }),
      });
      if (!res.ok) throw new Error('เพิ่มงานไม่สำเร็จ');
      setChoreForm({ title: '', reward: '10', emoji: choreForm.emoji });
      setChoreRepeat('none');
      loadKidHome(activeKidId);
    } catch (err: any) {
      setTeachError(err.message || 'เพิ่มงานไม่สำเร็จ');
    }
  };

  // ขอ PIN ของลูก (ถ้ามี) — คืน null เมื่อผู้ใช้ยกเลิก
  const promptKidPin = (): string | null => {
    if (!kidHome?.kid.has_pin) return '';
    const pin = window.prompt(`🔐 ${kidHome.kid.name} ตั้ง PIN ไว้ — กรอกรหัสลับเพื่อยืนยัน`);
    return pin === null ? null : pin.trim();
  };

  const completeChoreUI = async (choreId: string) => {
    if (!activeKidId) return;
    const pin = promptKidPin();
    if (pin === null) return; // ผู้ใช้ยกเลิก
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/chores/${choreId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'ทำไมสำเร็จ');
      setMessage(`✅ งานเสร็จแล้ว — +${data.reward} บาท เข้ากระเป๋าเงิน`);
      loadKidHome(activeKidId);
    } catch (err: any) {
      setTeachError(err.message || 'ทำไมสำเร็จ');
    }
  };

  const reopenChoreUI = async (choreId: string) => {
    if (!activeKidId) return;
    try {
      await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/chores/${choreId}/reopen`, { method: 'POST' });
      loadKidHome(activeKidId);
    } catch {
      setTeachError('เปิดงานใหม่ไม่สำเร็จ');
    }
  };

  const deleteChoreUI = async (choreId: string) => {
    if (!activeKidId || !confirm('ลบงานนี้?')) return;
    try {
      await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/chores/${choreId}`, { method: 'DELETE' });
      loadKidHome(activeKidId);
    } catch {
      setTeachError('ลบงานไม่สำเร็จ');
    }
  };

  // ── บิล ──
  const addBillUI = async () => {
    if (!activeKidId) return;
    const title = billForm.title.trim();
    if (!title) {
      setTeachError('ต้องใส่ชื่อบิลก่อน — เช่น "ค่าไฟ" "ค่าน้ำ" "ค่าห้อง"');
      return;
    }
    setTeachError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/bills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, amount: Math.max(1, Number(billForm.amount) || 1), emoji: billForm.emoji, period: billForm.period }),
      });
      if (!res.ok) throw new Error('เพิ่มบิลไม่สำเร็จ');
      setBillForm({ title: '', amount: '20', emoji: billForm.emoji, period: billForm.period });
      loadKidHome(activeKidId);
    } catch (err: any) {
      setTeachError(err.message || 'เพิ่มบิลไม่สำเร็จ');
    }
  };

  const payBillUI = async (billId: string) => {
    if (!activeKidId) return;
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/bills/${billId}/pay`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'จ่ายไมสำเร็จ');
      setMessage(`💰 จ่ายบิลแล้ว — ตัด ${data.amount} บาทจากกระเป๋าเงิน`);
      loadKidHome(activeKidId);
    } catch (err: any) {
      setTeachError(err.message || 'จ่ายไมสำเร็จ');
    }
  };

  const deleteBillUI = async (billId: string) => {
    if (!activeKidId || !confirm('ลบบิลนี้?')) return;
    try {
      await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/bills/${billId}`, { method: 'DELETE' });
      loadKidHome(activeKidId);
    } catch {
      setTeachError('ลบบิลไม่สำเร็จ');
    }
  };

  // ── กระเป๋าเงิน — ผู้ใหญ่เติม/หักเงิน ──
  const adjustWalletUI = async (sign: 1 | -1) => {
    if (!activeKidId) return;
    const amt = Number(walletAmount);
    if (!amt || amt <= 0) {
      setTeachError('ใส่จำนวนเงินก่อน (บาท)');
      return;
    }
    setTeachError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/wallet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: sign * amt, note: walletNote.trim() || undefined }),
      });
      if (!res.ok) throw new Error('ปรับยอดไม่สำเร็จ');
      setWalletAmount('');
      setWalletNote('');
      loadKidHome(activeKidId);
    } catch (err: any) {
      setTeachError(err.message || 'ปรับยอดไม่สำเร็จ');
    }
  };

  // ── ค่าขนมรายสัปดาห์ ──
  const setAllowanceUI = async () => {
    if (!activeKidId) return;
    const amount = Number(allowanceForm.amount);
    const day = Number(allowanceForm.day);
    if (!amount || amount <= 0) {
      setTeachError('ต้องใส่จำนวนเงินค่าขนม (บาท/สัปดาห์)');
      return;
    }
    setTeachError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/allowance`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ day, amount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'ตั้งค่าไม่สำเร็จ');
      setMessage(`✅ ค่าขนมรายสัปดาห์: ทุกวัน${WEEKDAY_LABELS[day]} ${amount} บาท — ระบบจ่ายให้อัตโนมัติ`);
      loadKidHome(activeKidId);
    } catch (err: any) {
      setTeachError(err.message || 'ตั้งค่าไม่สำเร็จ');
    }
  };

  // ── คูปองรางวัล ──
  const addCouponUI = async () => {
    if (!activeKidId) return;
    const title = couponForm.title.trim();
    if (!title) {
      setTeachError('ต้องใส่ชื่อรางวัลก่อน — เช่น "เล่นเกม 30 นาที"');
      return;
    }
    setTeachError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/coupons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, cost: Math.max(1, Number(couponForm.cost) || 1), emoji: couponForm.emoji }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'เพิ่มคูปองไม่สำเร็จ');
      setMessage(`🎟️ เพิ่มคูปอง "${title}" แล้ว`);
      setCouponForm({ title: '', cost: couponForm.cost, emoji: couponForm.emoji });
      loadKidHome(activeKidId);
    } catch (err: any) {
      setTeachError(err.message || 'เพิ่มคูปองไม่สำเร็จ');
    }
  };

  const redeemCouponUI = async (coupon: KidCoupon) => {
    if (!activeKidId) return;
    const pin = promptKidPin();
    if (pin === null) return; // ผู้ใช้ยกเลิก
    if (!confirm(`ให้ ${kidHome?.kid.name || 'ลูก'} แลกคูปอง "${coupon.title}" ด้วย ${coupon.cost} คะแนน?`)) return;
    setTeachError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/coupons/${coupon.id}/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'แลกไม่สำเร็จ');
      setMessage(`🎉 แลกคูปอง "${coupon.title}" แล้ว — หัก ${coupon.cost} คะแนน`);
      loadKidHome(activeKidId);
    } catch (err: any) {
      setTeachError(err.message || 'แลกไม่สำเร็จ');
    }
  };

  const deleteCouponUI = async (coupon: KidCoupon) => {
    if (!activeKidId || !confirm(`ลบคูปอง "${coupon.title}"?`)) return;
    try {
      await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/coupons/${coupon.id}`, { method: 'DELETE' });
      loadKidHome(activeKidId);
    } catch {
      setTeachError('ลบคูปองไม่สำเร็จ');
    }
  };

  // ── ถังสะสมแต้ม + เป้าหมายออมรายเดือน ──
  const setSavingsGoalUI = async () => {
    if (!activeKidId) return;
    const goal = Math.max(0, Number(goalForm.amount) || 0);
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/savings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'ตั้งเป้าหมายไม่สำเร็จ');
      setMessage(goal > 0 ? `🎯 ตั้งเป้าหมายออม ${goal} บาท/เดือน แล้ว` : 'ปิดเป้าหมายออมแล้ว');
      loadKidHome(activeKidId);
    } catch (err: any) {
      setTeachError(err.message || 'ตั้งเป้าหมายไม่สำเร็จ');
    }
  };

  const piggyTransferUI = async (sign: 1 | -1) => {
    if (!activeKidId) return;
    const amt = Number(piggyForm.amount);
    if (!amt || amt <= 0) {
      setTeachError('ใส่จำนวนเหรียญก่อน (บาท)');
      return;
    }
    setTeachError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/piggy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: sign * amt, note: piggyForm.note.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'ย้ายเหรียญไม่สำเร็จ');
      setMessage(sign > 0 ? `🐷 ฝาก ${amt} บาท เข้าถังสะสมแต้มแล้ว` : `🐷 ถอน ${amt} บาท จากถังแล้ว`);
      setPiggyForm({ amount: '', note: '' });
      loadKidHome(activeKidId);
    } catch (err: any) {
      setTeachError(err.message || 'ย้ายเหรียญไม่สำเร็จ');
    }
  };

  // ── PIN ของลูก ──
  const setPinUI = async () => {
    if (!activeKidId) return;
    const pin = pinForm.trim();
    if (pin && !/^\d{4,6}$/.test(pin)) {
      setTeachError('PIN ต้องเป็นตัวเลข 4-6 หลัก');
      return;
    }
    setTeachError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/pin`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'ตั้ง PIN ไม่สำเร็จ');
      setMessage(pin ? `🔐 ตั้ง PIN ให้ ${kidHome?.kid.name || 'ลูก'} แล้ว (ต้องกรอกก่อนทำงานเสร็จ/แลกคูปอง)` : '🔓 ล้าง PIN แล้ว');
      setPinForm('');
      loadKidHome(activeKidId);
    } catch (err: any) {
      setTeachError(err.message || 'ตั้ง PIN ไม่สำเร็จ');
    }
  };

  // ── ประวัติค่าขนมทุกคน + จ่ายย้อนหลัง ──
  const loadAllowanceHistory = useCallback(async () => {
    setHistoryLoading(true);
    setTeachError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/allowance/history`);
      if (!res.ok) throw new Error('โหลดประวัติไม่สำเร็จ');
      const data = await res.json();
      setAllowanceHistory(data.kids || []);
    } catch (err: any) {
      setTeachError(err.message || 'โหลดประวัติไม่สำเร็จ');
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const payAllowanceNowUI = async (kidId: string, kidName: string) => {
    if (!confirm(`จ่ายค่าขนมย้อนหลังให้ ${kidName} ตอนนี้? (ระบบจะจ่ายเฉพาะรอบที่ยังไม่ได้จ่าย)`)) return;
    setTeachError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${kidId}/allowance/pay-now`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'จ่ายไม่สำเร็จ');
      setMessage(data.paid ? `💰 จ่ายค่าขนมย้อนหลัง ${data.amount} บาท ให้ ${kidName} แล้ว` : `ℹ️ ${kidName} จ่ายครบสัปดาห์นี้แล้ว — ไม่ต้องจ่ายซ้ำ`);
      loadAllowanceHistory();
    } catch (err: any) {
      setTeachError(err.message || 'จ่ายไม่สำเร็จ');
    }
  };

  // ── เป้าหมายถังระยะยาว ──
  const setPiggyTargetUI = async () => {
    if (!activeKidId) return;
    const amount = Math.max(0, Number(targetForm.amount) || 0);
    const title = targetForm.title.trim();
    if (amount > 0 && !title) {
      setTeachError('ต้องใส่ชื่อเป้าหมายก่อน — เช่น "ซื้อจักรยาน"');
      return;
    }
    setTeachError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/piggy-target`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, amount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'ตั้งเป้าหมายไม่สำเร็จ');
      setMessage(amount > 0 ? `🎯 ตั้งเป้าหมาย "${title}" ${amount}฿ แล้ว` : 'ล้างเป้าหมายระยะยาวแล้ว');
      setTargetForm({ title: '', amount: '500' });
      loadKidHome(activeKidId);
    } catch (err: any) {
      setTeachError(err.message || 'ตั้งเป้าหมายไม่สำเร็จ');
    }
  };

  // ── หุ้นจำลองของบ้าน ──
  const loadStocks = useCallback(async () => {
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/stocks`);
      if (!res.ok) return;
      const data = await res.json();
      setStocks(data.stocks || []);
    } catch {
      // เงียบ
    }
  }, []);

  useEffect(() => {
    if (isHydrated && isAuthenticated) loadStocks();
  }, [isHydrated, isAuthenticated, loadStocks]);

  const buyStockUI = async () => {
    if (!activeKidId) return;
    const units = Number(stockForm.units);
    if (!units || units <= 0) {
      setTeachError('ใส่จำนวนหน่วยหุ้นก่อน');
      return;
    }
    const item = stocks.find((s) => s.symbol === stockForm.symbol);
    const cost = Math.round(units * (item?.price ?? 0));
    if (cost > (kidHome?.balance ?? 0)) {
      setTeachError(`เงินไม่พอซื้อ — ต้องใช้ ${cost}฿ แต่มี ${kidHome?.balance ?? 0}฿ ทำงานบ้านก่อนนะ`);
      return;
    }
    setTeachError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/stocks/buy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: stockForm.symbol, units }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'ซื้อไม่สำเร็จ');
      setMessage(`📈 ซื้อหุ้น ${units} หน่วย @ ${data.price}฿ แล้ว`);
      loadKidHome(activeKidId);
      loadAudit();
    } catch (err: any) {
      setTeachError(err.message || 'ซื้อไม่สำเร็จ');
    }
  };

  const sellStockUI = async (symbol: string, units: number) => {
    if (!activeKidId) return;
    setTeachError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/stocks/sell`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, units }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'ขายไม่สำเร็จ');
      setMessage(`📉 ขายหุ้น ${units} หน่วย @ ${data.price}฿ แล้ว`);
      loadKidHome(activeKidId);
      loadAudit();
    } catch (err: any) {
      setTeachError(err.message || 'ขายไม่สำเร็จ');
    }
  };

  // ── โหมดเงินจริง/จำลอง + นโยบายลงทุนของพ่อแม่ ──
  const setMoneyModeUI = async (mode: 'play' | 'real') => {
    if (!activeKidId) return;
    setTeachError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/money-mode`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'เปลี่ยนโหมดไม่สำเร็จ');
      setMessage(mode === 'real' ? '💵 เปลี่ยนเป็นเงินจริง — เงินที่พ่อแม่มอบหมายให้ลูกบริหารและลงทุน' : '🎮 เปลี่ยนเป็นเงินจำลอง — หัดเล่น');
      loadKidHome(activeKidId);
      loadAudit();
    } catch (err: any) {
      setTeachError(err.message || 'เปลี่ยนโหมดไม่สำเร็จ');
    }
  };

  const setInvestPolicyUI = async () => {
    if (!activeKidId) return;
    setTeachError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/invest-policy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: policyText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'ตั้งนโยบายไม่สำเร็จ');
      setMessage('📜 บันทึกนโยบายลงทุนของบ้านแล้ว');
      loadKidHome(activeKidId);
      loadAudit();
    } catch (err: any) {
      setTeachError(err.message || 'ตั้งนโยบายไม่สำเร็จ');
    }
  };

  // ── พ่อแม่เติมเงินจริงเข้าพอร์ต + เป้าหมายผลตอบแทน ──
  const addDepositUI = async () => {
    if (!activeKidId) return;
    const amount = Number(depositForm.amount);
    if (!amount || amount <= 0) { setTeachError('ใส่จำนวนเงินที่ต้องการฝากเข้าพอร์ต'); return; }
    setTeachError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/portfolio-deposits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, note: depositForm.note || 'เงินจริงเข้าพอร์ต' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'ฝากไม่สำเร็จ');
      setMessage(`💰 พ่อแม่เติมเงินจริงเข้าพอร์ต +${amount}฿ แล้ว`);
      setDepositForm({ amount: '', note: '' });
      loadKidHome(activeKidId);
      loadAudit();
    } catch (err: any) {
      setTeachError(err.message || 'ฝากเงินไม่สำเร็จ');
    }
  };

  const setTargetUI = async () => {
    if (!activeKidId) return;
    setTeachError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/invest-target`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pct: Number(targetPctForm.pct) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'ตั้งเป้าหมายไม่สำเร็จ');
      setMessage('🎯 ตั้งเป้าหมายผลตอบแทนรายเดือนแล้ว');
      loadKidHome(activeKidId);
      loadAudit();
    } catch (err: any) {
      setTeachError(err.message || 'ตั้งเป้าหมายไม่สำเร็จ');
    }
  };

  // ── พิมพ์เกียรติบัตร PDF (หน้าต่างพิมพ์ → บันทึกเป็น PDF) ──
  const printCertificate = (cert: { level: number; title: string; detail: string | null; created_at: string }, kid: { name: string; age: number | null; emoji: string | null }) => {
    const name = `${kid.emoji || ''} ${kid.name}`.trim();
    const date = new Date(cert.created_at).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
    const win = window.open('', '_blank', 'width=800,height=600');
    if (!win) {
      setTeachError('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — อนุญาต popup แล้วลองใหม่');
      return;
    }
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>เกียรติบัตร ${cert.level}</title><style>
      body { font-family: 'Sarabun', 'Tahoma', sans-serif; background: #fff8e7; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
      .cert { width: 720px; padding: 40px; border: 4px double #c9a227; border-radius: 12px; text-align: center; background: #fffdf5; }
      .star { font-size: 42px; }
      h1 { color: #b8860b; font-size: 34px; margin: 8px 0 4px; }
      .name { font-size: 40px; color: #1f2937; font-weight: bold; margin: 12px 0; }
      .line { font-size: 15px; color: #4b5563; line-height: 1.8; }
      .detail { font-size: 13px; color: #6b7280; margin-top: 10px; }
      .date { margin-top: 24px; font-size: 12px; color: #9ca3af; }
      @media print { body { background: #fff; } }
    </style></head><body><div class="cert">
      <div class="star">🎓</div>
      <h1>เกียรติบัตร</h1>
      <div class="name">${name}</div>
      <div class="line">ได้รับเกียรตินี้เพื่อยืนยันว่า สะสมคะแนนถึงระดับ ${cert.level}</div>
      <div class="line" style="font-weight:bold; color:#b8860b; font-size:20px;">⭐ ระดับ ${cert.level} ⭐</div>
      <div class="detail">${cert.detail || ''}</div>
      <div class="date">ออกให้ ณ วันที่ ${date} · ครอบครัว Sovereign OS</div>
    </div></body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 400);
  };

  // ── Audit log ของลูก ──
  const loadAudit = useCallback(async () => {
    if (!activeKidId) return;
    setAuditLoading(true);
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${activeKidId}/audit`);
      if (!res.ok) return;
      const data = await res.json();
      setAudit(data.logs || []);
    } catch {
      // เงียบ
    } finally {
      setAuditLoading(false);
    }
  }, [activeKidId]);

  useEffect(() => {
    if (activeKidId && showKidHome) loadAudit();
  }, [activeKidId, showKidHome, loadAudit, kidHome]);

  // ── รายงานรายสัปดาห์ (PDF) — ดึงข้อมูล 7 วัน + เปิดหน้าต่างพิมพ์ ──
  const printWeeklyReport = async () => {
    if (reportLoading) return;
    setReportLoading(true);
    setTeachError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/report/weekly`);
      if (!res.ok) throw new Error('โหลดรายงานไม่สำเร็จ');
      const data = await res.json();
      const kids = (data.kids || []) as WeeklyReportKid[];
      if (kids.length === 0) {
        setTeachError('ยังไม่มีโปรไฟล์เด็ก — เพิ่มโปรไฟล์ก่อนสร้างรายงาน');
        return;
      }
      const html = buildWeeklyReportHtml(kids, data.generatedAt);
      const w = window.open('', '_blank', 'width=860,height=960');
      if (!w) {
        alert('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — อนุญาต popup แล้วลองใหม่');
        return;
      }
      w.document.open();
      w.document.write(html);
      w.document.close();
      w.focus();
      w.print();
    } catch (err: any) {
      setTeachError(err.message || 'สร้างรายงานไม่สำเร็จ');
    } finally {
      setReportLoading(false);
    }
  };

  // ── สรุปความคืบหน้าทุกคน — ดึงคะแนนตามเวลาเพื่อวาดกราฟ ──
  const loadAllProgress = useCallback(async () => {
    if (progressLoading) return;
    setProgressLoading(true);
    setTeachError('');
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids`);
      if (!res.ok) throw new Error('โหลดโปรไฟล์ไม่สำเร็จ');
      const { kids: kidList } = await res.json();
      const rows = await Promise.all(
        (kidList as KidProfile[]).map(async (k) => {
          try {
            const r = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/teach/kids/${k.id}/progress`);
            if (!r.ok) return [k.id, []] as const;
            const d = await r.json();
            return [k.id, (d.progress || []).slice().reverse()] as const; // เรียงตามเวลา (เก่า→ใหม่)
          } catch {
            return [k.id, []] as const;
          }
        })
      );
      setAllProgress(Object.fromEntries(rows));
    } catch (err: any) {
      setTeachError(err.message || 'โหลดความคืบหน้าไม่สำเร็จ');
    } finally {
      setProgressLoading(false);
    }
  }, [progressLoading]);

  // ── พิมพ์ / ส่งออก PDF บทเรียน ── เปิดหน้าต่างพิมพ์ของเบราว์เซอร์ (บันทึกเป็น PDF ได้)
  const printLesson = (l: TeachLesson) => {
    const ageLabel = teachAgeLabel(l.age_range || teachAge);
    const esc = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const sections = l.sections.map((s) =>
      `<h3>${esc(s.heading)}</h3><p>${esc(s.content).replace(/\n/g, '<br/>')}</p>`
    ).join('');
    const points = l.key_points.length
      ? `<h2>จุดสำคัญที่ต้องจำ</h2><ul>${l.key_points.map((k) => `<li>${esc(k)}</li>`).join('')}</ul>`
      : '';
    const quiz = l.quiz.map((q, i) => {
      const opts = q.options.map((o, j) => {
        const mark = j === q.answer ? ' ✓ (คำตอบ)' : '';
        return `<li>${esc(o)}${mark}</li>`;
      }).join('');
      return `<div class="q"><p><b>${i + 1}. ${esc(q.question)}</b></p><ol>${opts}</ol>${q.explanation ? `<p class="exp">เฉลย: ${esc(q.explanation)}</p>` : ''}</div>`;
    }).join('');

    const html = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8"/>
<title>${esc(l.title)} — AI สอนลูก</title>
<style>
  body { font-family: 'Leelawadee UI', 'Noto Sans Thai', Tahoma, sans-serif; color: #1f2937; max-width: 720px; margin: 32px auto; padding: 0 24px; line-height: 1.6; }
  h1 { font-size: 26px; color: #065f46; margin-bottom: 4px; }
  .meta { font-size: 13px; color: #6b7280; margin-bottom: 16px; }
  h2 { font-size: 18px; color: #065f46; border-bottom: 1px solid #d1d5db; padding-bottom: 4px; margin-top: 24px; }
  h3 { font-size: 15px; color: #065f46; margin-bottom: 4px; }
  p { margin: 4px 0 12px; }
  ul, ol { margin: 4px 0 12px 20px; }
  .q { margin-bottom: 16px; }
  .exp { color: #4b5563; font-size: 13px; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>
<h1>${esc(l.title)}</h1>
<div class="meta">🧑‍🏫 AI สอนลูก · ${esc(ageLabel)}</div>
${l.summary ? `<p>${esc(l.summary)}</p>` : ''}
${sections}
${points}
${quiz ? `<h2>แบบทดสอบ</h2>${quiz}` : ''}
${l.sources.length ? `<p style="font-size:11px;color:#9ca3af">อ้างอิงจากคลังความรู้: ${esc(l.sources.filter((s, i, a) => a.indexOf(s) === i).join(' · '))}</p>` : ''}
</body>
</html>`;

    const w = window.open('', '_blank', 'width=820,height=900');
    if (!w) {
      alert('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — อนุญาต popup แล้วลองใหม่');
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  };

  if (!isHydrated) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-400">⏳ Loading...</div>;
  }

  if (!isAuthenticated || !user) {
    return <div className="text-white p-8">Unauthorized</div>;
  }

  const filtered = typeFilter === 'ALL' ? items : items.filter((i) => i.type === typeFilter);
  const embed = detail?.url ? videoEmbedUrl(detail.url) : null;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-mono flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-gray-900/70 border-b border-gray-800 px-6 py-3 backdrop-blur-md">
        <PageHeader
          eyebrow="ชีวิต &amp; การเงิน"
          title="📚 SOVEREIGN OS"
          subtitle="Knowledge Base — เก็บทุกอย่างไว้ในที่เดียว" actions={<div className="flex items-center gap-3">
            <button
              onClick={() => { setShowAdd(!showAdd); setError(''); }}
              className="px-3 py-1.5 bg-green-600 hover:bg-green-500 rounded-lg text-sm font-semibold"
            >
              ➕ เพิ่มข้อมูล
            </button>
            <a href="/dashboard" className="text-sm text-blue-400 hover:underline">← กลับ Dashboard</a>
          </div>}
        />
      </header>

        <main className="max-w-7xl mx-auto p-6 flex gap-6 w-full items-start">
          {/* ── ซ้าย: ตัวกรอง + ค้นหา + คู่มือ ── */}
          <div className="w-72 shrink-0 space-y-4">
            {/* เพิ่มข้อมูล */}
            {showAdd && (
              <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-3">
                <h3 className="text-sm font-bold">➕ เพิ่มข้อมูลใหม่</h3>
                {/* Tabs: กรอกเอง / นำเข้าจากเว็บ / อัปโหลด */}
                <div className="grid grid-cols-3 gap-1 text-[10px]">
                  {(['manual', 'import', 'upload'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setAddMode(mode)}
                      className={`px-2 py-1.5 rounded ${addMode === mode ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-400'}`}
                    >
                      {mode === 'manual' ? 'กรอกเอง' : mode === 'import' ? 'นำเข้าเว็บ' : 'อัปโหลดไฟล์'}
                    </button>
                  ))}
                </div>

                {addMode === 'manual' && (
                  <div className="space-y-2">
                    <select
                      value={addForm.type}
                      onChange={(e) => setAddForm({ ...addForm, type: e.target.value as ItemType })}
                      className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm"
                    >
                      {TYPE_ORDER.map((t) => <option key={t} value={t}>{TYPE_META[t].icon} {TYPE_META[t].label}</option>)}
                    </select>
                    <input value={addForm.title} onChange={(e) => setAddForm({ ...addForm, title: e.target.value })} placeholder="ชื่อ/หัวข้อ *" className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm" />
                    {(addForm.type === 'LINK' || addForm.type === 'VIDEO' || addForm.type === 'WEBPAGE') && (
                      <input value={addForm.url} onChange={(e) => setAddForm({ ...addForm, url: e.target.value })} placeholder="URL (https://...)" className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm" />
                    )}
                    {(addForm.type === 'NOTE' || addForm.type === 'TXT') && (
                      <textarea value={addForm.content} onChange={(e) => setAddForm({ ...addForm, content: e.target.value })} rows={4} placeholder="เนื้อหา/บันทึก..." className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm" />
                    )}
                    <input value={addForm.tags} onChange={(e) => setAddForm({ ...addForm, tags: e.target.value })} placeholder="แท็ก คั่นด้วย , เช่น ประวัติศาสตร์,สอนลูก" className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm" />
                    <button onClick={createItem} className="w-full bg-green-600 hover:bg-green-500 py-1.5 rounded text-sm font-semibold">💾 บันทึก</button>
                  </div>
                )}

                {addMode === 'import' && (
                  <div className="space-y-2">
                    <input value={importUrl} onChange={(e) => setImportUrl(e.target.value)} placeholder="URL ของเว็บที่อยากเก็บ (https://...)" className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm" />
                    <input value={importTitle} onChange={(e) => setImportTitle(e.target.value)} placeholder="ชื่อ (ไม่ใส่ = ดึงจากหน้าเว็บ)" className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm" />
                    <button onClick={importFromUrl} disabled={importing} className="w-full bg-cyan-600 hover:bg-cyan-500 py-1.5 rounded text-sm font-semibold disabled:opacity-50">
                      {importing ? '⏳ กำลังดึงหน้าเว็บ...' : '🌐 ดึงเนื้อหาจากเว็บ'}
                    </button>
                  </div>
                )}

                {addMode === 'upload' && (
                  <div className="space-y-2">
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".pdf,.txt,.md"
                      onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0])}
                      className="w-full text-xs bg-gray-800 border border-gray-600 rounded px-2 py-1.5 file:mr-2 file:bg-green-600 file:border-0 file:rounded file:text-white file:px-2 file:py-0.5"
                    />
                    <div className="text-[10px] text-gray-600">รองรับ .pdf .txt .md — PDF จะพยายามสกัดข้อความอัตโนมัติ (ไฟล์สแกนภาพต้องเพิ่มบันทึกเอง)</div>
                    {uploading && <div className="text-xs text-gray-400">⏳ กำลังอัปโหลด...</div>}
                  </div>
                )}
              </div>
            )}

            {/* กรองตามประเภท */}
            <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-2">
              <h3 className="text-sm font-bold">🗂️ ประเภท</h3>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setTypeFilter('ALL')}
                  className={`text-[11px] px-2 py-1 rounded-full border ${typeFilter === 'ALL' ? 'bg-green-600 border-green-600 text-white' : 'bg-gray-800 border-gray-600 text-gray-400 hover:bg-gray-700'}`}
                >
                  ทั้งหมด ({items.length})
                </button>
                {TYPE_ORDER.map((t) => {
                  const n = items.filter((i) => i.type === t).length;
                  return (
                    <button
                      key={t}
                      onClick={() => setTypeFilter(typeFilter === t ? 'ALL' : t)}
                      className={`text-[11px] px-2 py-1 rounded-full border ${typeFilter === t ? 'bg-green-600 border-green-600 text-white' : 'bg-gray-800 border-gray-600 text-gray-400 hover:bg-gray-700'}`}
                    >
                      {TYPE_META[t].icon} {TYPE_META[t].label} ({n})
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ค้นหาความหมาย */}
            <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-2">
              <h3 className="text-sm font-bold">🔎 ค้นหาความหมาย (AI)</h3>
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                placeholder="เช่น วิธีรับมือพายุเข้า..."
                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm"
              />
              <button onClick={runSearch} disabled={searching} className="w-full px-3 py-1.5 bg-green-600 hover:bg-green-500 rounded text-sm disabled:opacity-50">
                {searching ? 'ค้นหา...' : '🔍 ค้นหา'}
              </button>
              <div className="text-[10px] text-gray-600 leading-relaxed">
                {indexInfo
                  ? <>index: {indexInfo.chunks} chunks / {indexInfo.files} รายการ · model: {indexInfo.model}</>
                  : <>ยังไม่ได้สร้าง index — ค้นหาจะใช้แบบ keyword</>}
              </div>
              {isSuperadmin && (
                <button onClick={rebuildIndex} className="w-full px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded text-xs">
                  🏗️ สร้าง index ใหม่
                </button>
              )}
            </div>

            {/* AI สอนลูก — ผู้ใหญ่เลือกหัวข้อ/ระดับอายุ → สร้างบทเรียน + แบบทดสอบจากคลังความรู้ */}
            <div className="bg-gray-900 border border-green-800 rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-bold text-green-400">🧑‍🏫 AI สอนลูก</h3>
              <div className="text-[10px] text-gray-500 leading-relaxed">
                เลือกหัวข้อ + ระดับอายุ แล้ว AI สร้างบทเรียนและแบบทดสอบจากข้อมูลในคลังความรู้ (Ollama ทำงานในเครื่อง)
              </div>
              <input
                value={teachTopic}
                onChange={(e) => setTeachTopic(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && runTeachGenerate()}
                placeholder="หัวข้อ เช่น ระบบสุริยะ, การประหยัดน้ำ..."
                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm"
              />
              <select
                value={teachAge}
                onChange={(e) => setTeachAge(e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm"
              >
                {AGE_OPTIONS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
              <div className="flex gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] text-gray-500 mb-0.5">จำนวนข้อแบบทดสอบ</div>
                  <select
                    value={teachQuizCount}
                    onChange={(e) => setTeachQuizCount(Number(e.target.value))}
                    className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm"
                  >
                    {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => <option key={n} value={n}>{n} ข้อ</option>)}
                  </select>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] text-gray-500 mb-0.5">โมเดล AI</div>
                  <select
                    value={teachModel}
                    onChange={(e) => setTeachModel(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm"
                  >
                    <option value="">⚙️ เริ่มต้นของระบบ</option>
                    {ollamaModels.map((m) => (
                      <option key={m} value={m}>{m.replace(/:latest$/, '')}</option>
                    ))}
                  </select>
                </div>
              </div>
              <button
                onClick={runTeachGenerate}
                disabled={teaching}
                className="w-full px-3 py-2 bg-green-600 hover:bg-green-500 rounded text-sm font-semibold disabled:opacity-50"
              >
                {teaching ? '⏳ AI กำลังสร้างบทเรียน...' : '✨ สร้างบทเรียน + แบบทดสอบ'}
              </button>
              {teachError && <div className="text-[11px] text-red-400 bg-red-900/30 border border-red-800 rounded p-2 leading-relaxed">{teachError}</div>}

              {/* หัวข้อแนะนำจากรายการที่มีอยู่ในคลัง */}
              {items.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] text-gray-500">หัวข้อจากคลังความรู้:</div>
                  <div className="flex flex-wrap gap-1">
                    {items.slice(0, 6).map((it) => (
                      <button
                        key={it.id}
                        onClick={() => { setTeachTopic(it.title); setTeachError(''); }}
                        className="text-[10px] px-2 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-gray-400 hover:border-green-600 hover:text-green-400"
                      >
                        {it.title.length > 24 ? it.title.slice(0, 24) + '…' : it.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* โปรไฟล์เด็ก — เลือกคนที่เรียน แล้วคะแนนจะบันทึกให้อัตโนมัติ */}
              <div className="border-t border-gray-800 pt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] text-gray-500">🧒 โปรไฟล์เด็ก (บันทึกคะแนนให้คนที่เลือก):</div>
                  <button onClick={() => { setShowAddKid(!showAddKid); setTeachError(''); }} className="text-[10px] px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 border border-gray-600">
                    {showAddKid ? '✕ ปิด' : '➕ เพิ่ม'}
                  </button>
                </div>

                {showAddKid && (
                  <div className="space-y-2 bg-gray-950/50 border border-gray-800 rounded-lg p-2">
                    <div className="flex gap-2">
                      <input
                        value={kidForm.name}
                        onChange={(e) => setKidForm({ ...kidForm, name: e.target.value })}
                        placeholder="ชื่อเล่น เช่น น้องน้ำ"
                        className="flex-1 min-w-0 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
                      />
                      <input
                        value={kidForm.age}
                        onChange={(e) => setKidForm({ ...kidForm, age: e.target.value })}
                        placeholder="อายุ"
                        type="number"
                        min={0}
                        max={18}
                        className="w-14 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
                      />
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {KID_EMOJIS.map((e) => (
                        <button
                          key={e}
                          onClick={() => setKidForm({ ...kidForm, emoji: e })}
                          className={`text-base w-7 h-7 rounded flex items-center justify-center ${kidForm.emoji === e ? 'bg-green-600' : 'bg-gray-800 hover:bg-gray-700'}`}
                        >{e}</button>
                      ))}
                    </div>
                    <button onClick={createKidUI} className="w-full bg-green-600 hover:bg-green-500 py-1 rounded text-xs font-semibold">💾 เพิ่มโปรไฟล์</button>
                  </div>
                )}

                {kids.length === 0 ? (
                  <div className="text-[10px] text-gray-600">ยังไม่มีโปรไฟล์ — กด ➕ เพิ่ม เพื่อบันทึกคะแนนและบทเรียนที่เรียนจบของแต่ละคน</div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {kids.map((k) => {
                      const st = kidStats[k.id];
                      const active = activeKidId === k.id;
                      return (
                        <div key={k.id} className={`relative rounded-lg border px-2 py-1 text-[11px] ${active ? 'bg-green-900/30 border-green-600 text-green-300' : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-500'}`}>
                          <button onClick={() => setActiveKidId(active ? null : k.id)} className="flex items-center gap-1">
                            <span>{k.emoji || '🧒'}</span>
                            <span className="font-semibold">{k.name}</span>
                            <span className="text-[9px] text-gray-500">
                              {st ? `${st.attempts} บทเรียน · เฉลี่ย ${st.avg ?? 0}%` : 'ยังไม่เริ่ม'}
                            </span>
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteKidUI(k); }}
                            title={`ลบ ${k.name}`}
                            className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-700 text-[9px] text-white leading-none"
                          >✕</button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* หน้าที่ของลูก + สรุปความคืบหน้า + ประวัติค่าขนม */}
                {kids.length > 0 && (
                  <div className="flex gap-1.5 pt-0.5">
                    <button
                      onClick={() => { setShowKidHome(!showKidHome); setShowProgress(false); setShowAllowanceHistory(false); if (!kidHome && !showKidHome && activeKidId) loadKidHome(activeKidId); }}
                      disabled={!activeKidId}
                      className={`flex-1 text-[10px] px-2 py-1.5 rounded border ${showKidHome ? 'bg-green-600 border-green-600 text-white' : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-500'} disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      {showKidHome ? '✕ ปิดหน้าบ้าน' : '🧹 หน้าที่ของลูก'}
                    </button>
                    <button
                      onClick={() => { setShowProgress(!showProgress); setShowKidHome(false); setShowAllowanceHistory(false); if (!showProgress && Object.keys(allProgress).length === 0) loadAllProgress(); }}
                      className={`flex-1 text-[10px] px-2 py-1.5 rounded border ${showProgress ? 'bg-green-600 border-green-600 text-white' : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-500'}`}
                    >
                      {showProgress ? '✕ ปิดสรุป' : '📈 ความคืบหน้าทุกคน'}
                    </button>
                    <button
                      onClick={() => { setShowAllowanceHistory(!showAllowanceHistory); setShowKidHome(false); setShowProgress(false); if (!showAllowanceHistory && !allowanceHistory) loadAllowanceHistory(); }}
                      className={`text-[10px] px-2 py-1.5 rounded border ${showAllowanceHistory ? 'bg-green-600 border-green-600 text-white' : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-500'}`}
                    >
                      {showAllowanceHistory ? '✕' : '💰 ค่าขนม'}
                    </button>
                  </div>
                )}

                {/* บทเรียนที่เรียนจบของเด็กที่เลือก */}
                {activeKidId && kidProgress.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-[10px] text-gray-500">📖 เรียนจบแล้ว ({kidProgress.length}):</div>
                    <div className="space-y-1 max-h-28 overflow-y-auto pr-1">
                      {kidProgress.slice(0, 6).map((p) => (
                        <div key={p.id} className="flex items-center justify-between gap-2 text-[10px] bg-gray-950/40 border border-gray-800 rounded px-2 py-1">
                          <span className="truncate text-gray-400">{p.lesson_title}</span>
                          <span className={`shrink-0 font-bold ${p.score === p.total ? 'text-green-400' : 'text-amber-400'}`}>{p.score}/{p.total}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* บทเรียนที่เก็บไว้แล้ว */}
              {savedLessons.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] text-gray-500">📖 บทเรียนที่เก็บไว้ ({savedLessons.length}):</div>
                  <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                    {savedLessons.map((it) => (
                      <button
                        key={it.id}
                        onClick={() => openSavedLesson(it)}
                        className="block w-full text-left px-2 py-1 rounded text-[11px] bg-gray-800/60 hover:bg-gray-800 text-gray-300 border border-gray-700"
                      >
                        {it.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ไฟล์คู่มือ (legacy) */}
            <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-2">
              <h3 className="text-sm font-bold">📁 คู่มือระบบ ({manualFiles.length})</h3>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {manualFiles.map((f) => (
                  <button
                    key={f}
                    onClick={() => openManual(f)}
                    className={`block w-full text-left px-2 py-1 rounded text-xs ${manualFile === f ? 'bg-gray-800 text-green-400' : 'text-gray-400 hover:bg-gray-800'}`}
                  >
                    {f}
                  </button>
                ))}
                {manualFiles.length === 0 && <div className="text-gray-600 text-xs">ไม่มีไฟล์คู่มือ</div>}
              </div>
              {manualFile && (
                <div className="space-y-2">
                  <textarea value={manualContent} onChange={(e) => setManualContent(e.target.value)} rows={5} className="w-full bg-gray-800 text-green-400 text-xs p-2 rounded border border-gray-600 font-mono" />
                  <button onClick={saveManual} className="w-full px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-xs">💾 บันทึกคู่มือ</button>
                </div>
              )}
            </div>
          </div>

          {/* ── ขวา: รายการ + ตัวแสดงผล ── */}
          <div className="flex-1 min-w-0 space-y-4">
            {message && <div className="p-3 rounded text-sm bg-green-900/30 text-green-400 border border-green-800">{message}</div>}
            {error && <div className="p-3 rounded text-sm bg-red-900/30 text-red-400 border border-red-800">{error}</div>}

            {/* ── สรุปความคืบหน้าของลูกทุกคน — กราฟคะแนนตามเวลา ── */}
            {showProgress && (
              <div className="bg-gray-900 border border-green-800 rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-green-400">📈 ความคืบหน้าของลูกทุกคน</h3>
                  <span className="text-[10px] text-gray-500">คะแนนแบบทดสอบ (%) ตามเวลา</span>
                </div>

                {progressLoading ? (
                  <div className="text-xs text-gray-400 py-6 text-center">⏳ กำลังโหลดคะแนนของทุกคน...</div>
                ) : (
                  <>
                    {/* สรุปต่อคน */}
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                      {kids.map((k) => {
                        const st = kidStats[k.id];
                        const rows = allProgress[k.id] || [];
                        return (
                          <div key={k.id} className="bg-gray-950/50 border border-gray-800 rounded-lg p-2.5">
                            <div className="text-xs font-bold text-gray-200">{k.emoji || '🧒'} {k.name}</div>
                            <div className="text-[10px] text-gray-500 mt-0.5">
                              เรียนจบ {rows.length} บทเรียน · เฉลี่ย {st?.avg ?? 0}% · ดีที่สุด {st?.best ?? 0}%
                            </div>
                            {rows.length > 0 && (
                              <div className="mt-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${Math.max(4, st?.avg ?? 0)}%`, background: kidColor(k.name) }} />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* กราฟคะแนนตามเวลา */}
                    <ScoreTrendChart
                      series={kids
                        .map((k) => ({
                          name: k.name,
                          color: kidColor(k.name),
                          points: (allProgress[k.id] || []).map((p) => ({
                            time: new Date(p.completed_at).getTime(),
                            pct: p.total > 0 ? Math.round((p.score / p.total) * 100) : 0,
                            label: p.lesson_title,
                          })),
                        }))
                        .filter((s) => s.points.length > 0)}
                    />
                    {Object.values(allProgress).every((r) => r.length === 0) && (
                      <div className="text-xs text-gray-500 py-4 text-center">ยังไม่มีคะแนนแบบทดสอบ — สร้างบทเรียนแล้วให้ลูกทำ quiz เพื่อเห็นกราฟความก้าวหน้า</div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ── ประวัติค่าขนมทุกคน + จ่ายย้อนหลัง ── */}
            {showAllowanceHistory && (
              <div className="bg-gray-900 border border-green-800 rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-green-400">💰 ประวัติค่าขนมรายสัปดาห์</h3>
                  <button onClick={loadAllowanceHistory} className="text-[10px] px-2 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded">🔄 รีเฟรช</button>
                </div>
                {historyLoading && !allowanceHistory ? (
                  <div className="text-xs text-gray-400 py-4 text-center">⏳ กำลังโหลด...</div>
                ) : !allowanceHistory || allowanceHistory.length === 0 ? (
                  <div className="text-xs text-gray-500 py-3 text-center">ยังไม่มีโปรไฟล์เด็ก</div>
                ) : (
                  <div className="space-y-3">
                    {allowanceHistory.map((k) => {
                      const day = k.allowance_day != null ? WEEKDAY_LABELS[k.allowance_day] : null;
                      return (
                        <div key={k.id} className="bg-gray-950/50 border border-gray-800 rounded-lg p-3 space-y-1.5">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="text-sm font-bold text-gray-200">
                              {k.emoji || '🧒'} {k.name}
                              <span className="text-[10px] text-gray-500 font-normal ml-2">
                                {k.allowance_amount != null ? `จ่ายทุกวัน${day} ${k.allowance_amount}฿/สัปดาห์` : 'ยังไม่ได้ตั้งค่าขนม'}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              {k.allowance_amount != null && (
                                <button
                                  onClick={() => payAllowanceNowUI(k.id, k.name)}
                                  disabled={isPaidThisWeek(k.allowance_day, k.allowance_last_paid)}
                                  title={isPaidThisWeek(k.allowance_day, k.allowance_last_paid) ? 'จ่ายครบสัปดาห์นี้แล้ว' : 'worker พลาด → จ่ายด้วยมือ'}
                                  className="text-[10px] px-2 py-1 rounded bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  💰 จ่ายย้อนหลัง
                                </button>
                              )}
                            </div>
                          </div>
                          {k.txs.length === 0 ? (
                            <div className="text-[11px] text-gray-600">ยังไม่เคยจ่ายค่าขนม — worker จะจ่ายอัตโนมัติวัน{day} หรือกด "จ่ายย้อนหลัง"</div>
                          ) : (
                            <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                              {k.txs.slice(0, 10).map((t) => (
                                <div key={t.id} className="flex items-center justify-between gap-2 text-[11px] bg-gray-800/40 border border-gray-800 rounded px-2 py-1">
                                  <span className="truncate text-gray-400">{t.note}</span>
                                  <span className="shrink-0 text-green-400 font-bold">+{t.amount}฿</span>
                                  <span className="shrink-0 text-gray-600">{fmtDate(t.created_at)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── หน้าที่ของลูก — งานบ้าน / บิล / กระเป๋าเงิน ── */}
            {showKidHome && activeKidId && (
              <div className="bg-gray-900 border border-green-800 rounded-xl p-5 space-y-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-[10px] text-green-500 font-bold">🧹 หน้าที่ของลูก · ฝึกทำงานแลกเงิน จ่ายค่าไฟ/น้ำ/ห้องเอง</div>
                    {kidHome && (
                      <h2 className="text-lg font-bold text-gray-100 mt-0.5">
                        {kidHome.kid.emoji || '🧒'} {kidHome.kid.name}
                        {kidHome.kid.age != null && <span className="text-xs text-gray-500 ml-2">{kidHome.kid.age} ปี</span>}
                      </h2>
                    )}
                  </div>
                  {kidHome && (
                    <div className="text-right shrink-0 flex items-center gap-3">
                      <button
                        onClick={printWeeklyReport}
                        disabled={reportLoading}
                        title="ส่งออกรายงาน 7 วันเป็น PDF (คะแนน + งานบ้าน + บิล + ยอดเงิน)"
                        className="px-2.5 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-[11px] font-semibold disabled:opacity-50"
                      >
                        {reportLoading ? '⏳ กำลังสร้าง...' : '📄 รายงานรายสัปดาห์ (PDF)'}
                      </button>
                      <div>
                        <div className="text-[10px] text-gray-500">💰 เงินในกระเป๋า</div>
                        <div className={`text-2xl font-bold ${kidHome.balance >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {kidHome.balance.toLocaleString()} ฿
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {kidHome && (
                  <>
                    {/* ── ระดับ/ดาว + XP ── */}
                    <div className="bg-gray-950/50 border border-gray-800 rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xl">{'⭐'.repeat(Math.min(3, kidHome.kid.level))}</span>
                          <span className="font-bold text-sm">ระดับ {kidHome.kid.level}</span>
                          <span className="text-[10px] text-gray-500">XP {kidHome.kid.xp.toLocaleString()}</span>
                        </div>
                        <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${kidHome.kid.money_mode === 'real' ? 'bg-amber-900/40 border border-amber-700/60 text-amber-300' : 'bg-blue-900/40 border border-blue-700/60 text-blue-300'}`}>
                          {kidHome.kid.money_mode === 'real' ? '💵 เงินจริง' : '🎮 เงินจำลอง'}
                        </span>
                      </div>
                      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-amber-500 to-yellow-400" style={{ width: `${Math.min(100, ((kidHome.kid.xp % 100) / 100) * 100)}%` }} />
                      </div>
                      <div className="text-[10px] text-gray-600">อีก {100 - (kidHome.kid.xp % 100)} XP ถึงระดับ {kidHome.kid.level + 1} — ได้ XP จากการเรียน (คะแนน×10) และทำงานบ้าน</div>
                      {kidHome.certificates.length > 0 && (
                        <div className="space-y-1 pt-1">
                          <div className="text-[10px] font-bold text-gray-400">🎓 เกียรติบัตร ({kidHome.certificates.length})</div>
                          {kidHome.certificates.slice(0, 3).map((cert) => (
                            <div key={cert.id} className="flex items-center gap-2 text-[11px] bg-gray-800/50 border border-gray-700 rounded px-2 py-1">
                              <span className="shrink-0">🎓</span>
                              <span className="flex-1 truncate text-gray-300">{cert.title}</span>
                              <span className="shrink-0 text-gray-500">{new Date(cert.created_at).toLocaleDateString('th-TH')}</span>
                              <button onClick={() => printCertificate(cert, kidHome.kid)} className="shrink-0 px-2 py-0.5 rounded bg-amber-700/60 hover:bg-amber-600 text-[10px] text-white">🖨️ PDF</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* ── นโยบายการลงทุนของบ้าน + โหมดเงิน ── */}
                    <div className="bg-gray-950/50 border border-gray-800 rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <h3 className="text-sm font-bold">📜 นโยบายการออม-ลงทุนของบ้าน</h3>
                        <div className="flex gap-1">
                          <button onClick={() => setMoneyModeUI('play')} className={`px-2 py-0.5 rounded text-[10px] font-bold border ${kidHome.kid.money_mode !== 'real' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-gray-800 border-gray-600 text-gray-400'}`}>🎮 จำลอง</button>
                          <button onClick={() => setMoneyModeUI('real')} className={`px-2 py-0.5 rounded text-[10px] font-bold border ${kidHome.kid.money_mode === 'real' ? 'bg-amber-600 border-amber-500 text-white' : 'bg-gray-800 border-gray-600 text-gray-400'}`}>💵 เงินจริง</button>
                        </div>
                      </div>
                      {kidHome.kid.money_mode === 'real' && (
                        <div className="text-[11px] text-amber-300 bg-amber-900/20 border border-amber-800/60 rounded px-2 py-1.5 leading-relaxed">
                          💵 โหมดเงินจริง — เงินในกระเป๋า/ถังคือเงินเก็บของลูกที่พ่อแม่มอบหมายให้ลูกบริหาร เพื่อให้ลูกคิดถึงอนาคตและลงทุนเอง
                        </div>
                      )}
                      <div className="flex gap-1.5">
                        <input
                          value={policyText || kidHome.kid.invest_policy}
                          onChange={(e) => setPolicyText(e.target.value)}
                          placeholder="เช่น ลูกต้องเก็บ 20% ของรายได้เข้าถังและลงทุนเสมอ"
                          className="flex-1 min-w-0 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
                        />
                        <button onClick={setInvestPolicyUI} className="shrink-0 px-2.5 py-1 rounded bg-gray-800 hover:bg-gray-700 border border-gray-600 text-xs">💾 บันทึก</button>
                      </div>
                      {kidHome.kid.invest_policy && (
                        <div className="text-[10px] text-gray-400 leading-relaxed border-t border-gray-800 pt-1.5">
                          📋 นโยบายปัจจุบัน: <span className="text-gray-300">{kidHome.kid.invest_policy}</span>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {homeLoading && !kidHome ? (
                  <div className="text-xs text-gray-400 py-4 text-center">⏳ กำลังโหลด...</div>
                ) : !kidHome ? (
                  <div className="text-xs text-gray-500 py-2">เลือกโปรไฟล์เด็กแล้วกดปุ่มอีกครั้งเพื่อโหลด</div>
                ) : (
                  <>
                    {/* ── งานบ้าน (ทำงานแลกเงิน) ── */}
                    <div className="bg-gray-950/50 border border-gray-800 rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold">🧹 งานบ้าน — ทำงานแล้วได้เงิน</h3>
                        <span className="text-[10px] text-gray-500">เสร็จแล้ว {kidHome.chores.filter((c) => c.status === 'done').length}/{kidHome.chores.length} งาน</span>
                      </div>
                      <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                        {kidHome.chores.length === 0 && <div className="text-[11px] text-gray-600">ยังไม่มีงานบ้าน — เพิ่มงานแรกด้านล่าง เช่น "กวาดบ้าน 10 บาท"</div>}
                        {kidHome.chores.map((c) => (
                          <div key={c.id} className={`flex items-center gap-2 text-xs rounded px-2 py-1.5 border ${c.status === 'done' ? 'bg-green-900/20 border-green-800 text-gray-500' : 'bg-gray-800/60 border-gray-700 text-gray-200'}`}>
                            <span className="shrink-0">{c.emoji || '📋'}</span>
                            {c.repeat === 'daily' && <span className="shrink-0 text-[9px] text-cyan-400" title="งานรายวัน — รีเซ็ตใหม่ทุกเช้า">🔁 รายวัน</span>}
                            <span className={`flex-1 truncate ${c.status === 'done' ? 'line-through' : ''}`}>{c.title}</span>
                            <span className="shrink-0 font-bold text-green-400">+{c.reward}฿</span>
                            {c.status === 'pending' ? (
                              <button onClick={() => completeChoreUI(c.id)} title="ทำเสร็จ → ได้เงิน" className="shrink-0 px-2 py-0.5 rounded bg-green-600 hover:bg-green-500 text-[10px]">✓ เสร็จ</button>
                            ) : (
                              <button onClick={() => reopenChoreUI(c.id)} title="เปิดงานใหม่" className="shrink-0 px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-[10px]">↺</button>
                            )}
                            <button onClick={() => deleteChoreUI(c.id)} title="ลบ" className="shrink-0 text-red-400 hover:text-red-300 text-[10px]">✕</button>
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-1.5 pt-1">
                        <input
                          value={choreForm.title}
                          onChange={(e) => setChoreForm({ ...choreForm, title: e.target.value })}
                          onKeyDown={(e) => e.key === 'Enter' && addChoreUI()}
                          placeholder="งาน เช่น กวาดบ้าน"
                          className="flex-1 min-w-0 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
                        />
                        <input
                          value={choreForm.reward}
                          onChange={(e) => setChoreForm({ ...choreForm, reward: e.target.value })}
                          type="number"
                          min={1}
                          placeholder="บาท"
                          className="w-16 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
                        />
                        <select
                          value={choreForm.emoji}
                          onChange={(e) => setChoreForm({ ...choreForm, emoji: e.target.value })}
                          className="w-12 bg-gray-800 border border-gray-600 rounded px-1 py-1 text-xs"
                        >
                          {CHORE_EMOJIS.map((e) => <option key={e} value={e}>{e}</option>)}
                        </select>
                        <button onClick={addChoreUI} className="shrink-0 px-2.5 py-1 rounded bg-green-600 hover:bg-green-500 text-xs font-semibold">＋ เพิ่มงาน</button>
                      </div>
                      <div className="flex items-center gap-1.5 pt-1">
                        <button
                          onClick={() => setChoreRepeat(choreRepeat === 'daily' ? 'none' : 'daily')}
                          className={`text-[10px] px-2 py-0.5 rounded-full border ${choreRepeat === 'daily' ? 'bg-cyan-900/40 border-cyan-600 text-cyan-300' : 'bg-gray-800 border-gray-700 text-gray-500 hover:border-gray-500'}`}
                        >
                          🔁 งานรายวัน {choreRepeat === 'daily' ? '✓' : ''}
                        </button>
                        <span className="text-[9px] text-gray-600">งานรายวันจะรีเซ็ตเป็นค้างใหม่ทุกเช้า — ลูกทำได้ทุกวัน</span>
                      </div>
                    </div>

                    {/* ── บิล — จ่ายเองจากเงินที่หามาได้ ── */}
                    <div className="bg-gray-950/50 border border-gray-800 rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold">💡 บิล — ฝึกจ่ายค่าไฟ/น้ำ/ห้องเอง</h3>
                        <span className="text-[10px] text-gray-500">ค้าง {kidHome.bills.filter((b) => b.status === 'unpaid').length} ใบ</span>
                      </div>
                      <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                        {kidHome.bills.length === 0 && <div className="text-[11px] text-gray-600">ยังไม่มีบิล — เพิ่ม "ค่าไฟ 50 บาท" "ค่าน้ำ 20 บาท" ให้ลูกฝึกจัดการ</div>}
                        {kidHome.bills.map((b) => (
                          <div key={b.id} className={`flex items-center gap-2 text-xs rounded px-2 py-1.5 border ${b.status === 'paid' ? 'bg-gray-800/40 border-gray-800 text-gray-500' : 'bg-amber-900/10 border-amber-800/60 text-amber-200'}`}>
                            <span className="shrink-0">{b.emoji || '🧾'}</span>
                            <span className={`flex-1 truncate ${b.status === 'paid' ? 'line-through' : ''}`}>{b.title}</span>
                            {b.period === 'monthly' && <span className="shrink-0 text-[9px] text-gray-500">รายเดือน</span>}
                            <span className="shrink-0 font-bold">{b.amount.toLocaleString()}฿</span>
                            {b.status === 'unpaid' ? (
                              <button
                                onClick={() => payBillUI(b.id)}
                                disabled={kidHome.balance < b.amount}
                                title={kidHome.balance < b.amount ? 'เงินไม่พอ — ทำงานบ้านก่อน' : 'จ่ายจากกระเป๋าเงิน'}
                                className="shrink-0 px-2 py-0.5 rounded bg-amber-600 hover:bg-amber-500 text-[10px] disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                💰 จ่าย
                              </button>
                            ) : (
                              <span className="shrink-0 text-[10px] text-green-500">✓ จ่ายแล้ว</span>
                            )}
                            <button onClick={() => deleteBillUI(b.id)} title="ลบ" className="shrink-0 text-red-400 hover:text-red-300 text-[10px]">✕</button>
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-1.5 pt-1">
                        <input
                          value={billForm.title}
                          onChange={(e) => setBillForm({ ...billForm, title: e.target.value })}
                          onKeyDown={(e) => e.key === 'Enter' && addBillUI()}
                          placeholder="บิล เช่น ค่าไฟ"
                          className="flex-1 min-w-0 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
                        />
                        <input
                          value={billForm.amount}
                          onChange={(e) => setBillForm({ ...billForm, amount: e.target.value })}
                          type="number"
                          min={1}
                          placeholder="บาท"
                          className="w-16 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
                        />
                        <select
                          value={billForm.period}
                          onChange={(e) => setBillForm({ ...billForm, period: e.target.value })}
                          className="w-20 bg-gray-800 border border-gray-600 rounded px-1 py-1 text-xs"
                        >
                          <option value="one-time">ครั้งเดียว</option>
                          <option value="monthly">รายเดือน</option>
                        </select>
                        <button onClick={addBillUI} className="shrink-0 px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-500 text-xs font-semibold">＋ เพิ่มบิล</button>
                      </div>
                    </div>

                    {/* ── ค่าขนมรายสัปดาห์อัตโนมัติ ── */}
                    <div className="bg-gray-950/50 border border-gray-800 rounded-lg p-3 space-y-2">
                      <h3 className="text-sm font-bold">💰 ค่าขนมรายสัปดาห์</h3>
                      <div className="flex gap-1.5 items-center">
                        <select
                          value={allowanceForm.day}
                          onChange={(e) => setAllowanceForm({ ...allowanceForm, day: e.target.value })}
                          className="flex-1 min-w-0 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
                        >
                          {WEEKDAY_LABELS.map((d, i) => <option key={i} value={i}>ทุกวัน{d}</option>)}
                        </select>
                        <input
                          value={allowanceForm.amount}
                          onChange={(e) => setAllowanceForm({ ...allowanceForm, amount: e.target.value })}
                          type="number"
                          min={1}
                          placeholder="บาท/สัปดาห์"
                          className="w-20 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
                        />
                        <button onClick={setAllowanceUI} className="shrink-0 px-2.5 py-1 rounded bg-green-600 hover:bg-green-500 text-xs font-semibold">💾 ตั้งค่า</button>
                      </div>
                      {kidHome.kid.allowance_amount != null ? (
                        <div className="text-[10px] text-gray-400 bg-gray-800/40 border border-gray-800 rounded px-2 py-1.5 leading-relaxed">
                          ✅ ระบบจะจ่าย <b className="text-green-400">{kidHome.kid.allowance_amount}฿</b> ให้อัตโนมัติทุกวัน{WEEKDAY_LABELS[kidHome.kid.allowance_day ?? 0]}
                          {kidHome.kid.allowance_last_paid
                            ? <> — จ่ายล่าสุด {fmtDate(kidHome.kid.allowance_last_paid)}</>
                            : <> — ยังไม่เคยจ่าย (รอถึงวันจ่าย)</>}
                        </div>
                      ) : (
                        <div className="text-[10px] text-gray-600">ตั้งวันจ่าย + จำนวนเงิน แล้วระบบจ่ายให้เองทุกสัปดาห์ (กันจ่ายซ้ำอัตโนมัติ)</div>
                      )}
                    </div>

                    {/* ── ถังสะสมแต้ม — เปลี่ยนคะแนนเป็นเหรียญเก็บกระปุก + เป้าหมายออม ── */}
                    <div className="bg-gray-950/50 border border-gray-800 rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold">🐷 ถังสะสมแต้ม</h3>
                        <span className="text-[10px] text-gray-500">เหรียญที่ลูกเก็บได้จริง (แยกจากกระเป๋าเงิน)</span>
                      </div>
                      <div className="flex items-end gap-3">
                        <div>
                          <div className="text-[10px] text-gray-500">ในกระปุก</div>
                          <div className="text-2xl font-bold text-amber-300">{kidHome.piggy.toLocaleString()} ฿</div>
                        </div>
                        {kidHome.kid.savings_goal != null && kidHome.kid.savings_goal > 0 && (
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between text-[10px] text-gray-500">
                              <span>🎯 เดือนนี้ {kidHome.piggy_month.toLocaleString()}/{kidHome.kid.savings_goal} ฿</span>
                              <span>{Math.min(100, Math.round((kidHome.piggy_month / kidHome.kid.savings_goal) * 100))}%</span>
                            </div>
                            <div className="h-2 bg-gray-800 rounded-full overflow-hidden mt-0.5">
                              <div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-300" style={{ width: `${Math.min(100, Math.round((kidHome.piggy_month / kidHome.kid.savings_goal) * 100))}%` }} />
                            </div>
                            {kidHome.piggy_month >= kidHome.kid.savings_goal && (
                              <div className="text-[10px] text-green-400 mt-0.5">🎉 ถึงเป้าหมายแล้ว!</div>
                            )}
                          </div>
                        )}
                      </div>
                      {/* เป้าหมายระยะยาวของถัง */}
                      {kidHome.kid.piggy_target_amount != null && kidHome.kid.piggy_target_amount > 0 ? (
                        <div className="bg-gray-800/40 border border-amber-800/50 rounded-lg p-2 space-y-1">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-bold text-amber-200">🎯 {kidHome.kid.piggy_target_title}</span>
                            <span className="text-gray-400">{kidHome.piggy.toLocaleString()}/{kidHome.kid.piggy_target_amount.toLocaleString()}฿ ({Math.min(100, Math.round((kidHome.piggy / kidHome.kid.piggy_target_amount) * 100))}%)</span>
                          </div>
                          <div className="h-2.5 bg-gray-800 rounded-full overflow-hidden">
                            <div className="h-full rounded-full bg-gradient-to-r from-amber-500 via-yellow-400 to-emerald-400" style={{ width: `${Math.min(100, Math.round((kidHome.piggy / kidHome.kid.piggy_target_amount) * 100))}%` }} />
                          </div>
                          {kidHome.piggy >= kidHome.kid.piggy_target_amount ? (
                            <div className="text-[10px] text-emerald-400 font-bold">🏆 ถึงเป้าหมายแล้ว! เตรียมรับรางวัลใหญ่</div>
                          ) : (
                            <div className="text-[10px] text-gray-400">
                              เหลืออีก {(kidHome.kid.piggy_target_amount - kidHome.piggy).toLocaleString()}฿ · {kidHome.piggy_eta.months != null
                                ? <>คาดว่าอีก <b className="text-amber-300">{kidHome.piggy_eta.months} เดือน</b> (เก็บเดือนละ {kidHome.piggy_eta.monthlyRate}฿)</>
                                : <>ยังไม่มีอัตราการฝาก — เริ่มฝากเหรียญบ่อยๆ นะ</>}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="text-[10px] text-gray-600">ตั้งเป้าหมายระยะยาว เช่น "ซื้อจักรยาน 500฿" เพื่อสอนลูกเรื่องการตั้งเป้าหมายและอดออม</div>
                      )}
                      <div className="flex gap-1.5 items-center">
                        <input
                          value={targetForm.title}
                          onChange={(e) => setTargetForm((prev) => ({ ...prev, title: e.target.value }))}
                          onKeyDown={(e) => e.key === 'Enter' && setPiggyTargetUI()}
                          placeholder="เป้าหมาย เช่น ซื้อจักรยาน"
                          className="flex-1 min-w-0 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
                        />
                        <input
                          value={targetForm.amount}
                          onChange={(e) => setTargetForm((prev) => ({ ...prev, amount: e.target.value }))}
                          type="number"
                          min={0}
                          placeholder="บาท"
                          className="w-16 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
                        />
                        <button onClick={setPiggyTargetUI} className="shrink-0 px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 border border-gray-600 text-[11px]">ตั้งเป้า</button>
                        {kidHome.kid.piggy_target_amount != null && (
                          <button onClick={() => { setTargetForm({ title: '', amount: '0' }); setTimeout(setPiggyTargetUI, 0); }} className="text-[10px] text-gray-600 hover:text-gray-400 underline">ล้าง</button>
                        )}
                      </div>
                      <div className="flex gap-1.5 flex-wrap items-center">
                        {PIGGY_PRESETS.map((p) => (
                          <button key={p} onClick={() => setPiggyForm((prev) => ({ ...prev, amount: String(p) }))} className={`px-2 py-0.5 rounded text-[10px] border ${piggyForm.amount === String(p) ? 'bg-amber-600 border-amber-600 text-white' : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'}`}>{p}฿</button>
                        ))}
                        <input
                          value={piggyForm.amount}
                          onChange={(e) => setPiggyForm((prev) => ({ ...prev, amount: e.target.value }))}
                          type="number"
                          min={1}
                          placeholder="บาท"
                          className="w-16 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
                        />
                        <input
                          value={piggyForm.note}
                          onChange={(e) => setPiggyForm((prev) => ({ ...prev, note: e.target.value }))}
                          placeholder="หมายเหตุ เช่น เก็บค่าแป้ง"
                          className="flex-1 min-w-28 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
                        />
                        <button onClick={() => piggyTransferUI(1)} disabled={kidHome.balance < (Number(piggyForm.amount) || 0)} title={kidHome.balance < (Number(piggyForm.amount) || 0) ? 'เงินในกระเป๋าไม่พอ' : 'หักจากกระเป๋าเงินเข้าถัง'} className="px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-500 text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed">🐷 ฝาก</button>
                        <button onClick={() => piggyTransferUI(-1)} disabled={kidHome.piggy < (Number(piggyForm.amount) || 0)} title={kidHome.piggy < (Number(piggyForm.amount) || 0) ? 'เหรียญในถังไม่พอ' : 'ถอนกลับกระเป๋าเงิน'} className="px-2.5 py-1 rounded bg-gray-700 hover:bg-gray-600 text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed">↩ ถอน</button>
                      </div>
                      <div className="flex gap-1.5 items-center">
                        <span className="text-[10px] text-gray-500 shrink-0">🎯 เป้าหมายออม/เดือน:</span>
                        <input
                          value={goalForm.amount}
                          onChange={(e) => setGoalForm({ amount: e.target.value })}
                          type="number"
                          min={0}
                          placeholder="บาท"
                          className="w-16 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
                        />
                        <button onClick={setSavingsGoalUI} className="shrink-0 px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 border border-gray-600 text-[11px]">ตั้งเป้าหมาย</button>
                        <button onClick={() => { setGoalForm({ amount: '0' }); setTimeout(setSavingsGoalUI, 0); }} className="text-[10px] text-gray-600 hover:text-gray-400 underline">ปิด</button>
                      </div>
                      {kidHome.piggy_txs.length > 0 && (
                        <div className="space-y-1 max-h-24 overflow-y-auto pr-1">
                          <div className="text-[10px] text-gray-500">ประวัติถัง:</div>
                          {kidHome.piggy_txs.slice(0, 6).map((t) => (
                            <div key={t.id} className="flex items-center justify-between gap-2 text-[11px] bg-gray-800/40 border border-gray-800 rounded px-2 py-1">
                              <span className="truncate text-gray-400">🐷 {t.note || (t.amount >= 0 ? 'ฝากเข้าถัง' : 'ถอนจากถัง')}</span>
                              <span className={`shrink-0 font-bold ${t.amount >= 0 ? 'text-amber-300' : 'text-gray-400'}`}>{t.amount >= 0 ? '+' : ''}{t.amount}฿</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* ── PIN ส่วนตัวของลูก — ให้เด็กกดเองได้ ── */}
                    <div className="bg-gray-950/50 border border-gray-800 rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold">🔐 PIN ของลูก</h3>
                        {kidHome.kid.has_pin ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-900/40 border border-green-700 text-green-400">ตั้งแล้ว — ต้องกรอกก่อนทำงานเสร็จ/แลกคูปอง</span>
                        ) : (
                          <span className="text-[10px] text-gray-500">ยังไม่ได้ตั้ง — ลูกกดเองได้เลย</span>
                        )}
                      </div>
                      <div className="flex gap-1.5 items-center">
                        <input
                          value={pinForm}
                          onChange={(e) => setPinForm(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && setPinUI()}
                          type="password"
                          inputMode="numeric"
                          maxLength={6}
                          placeholder={kidHome.kid.has_pin ? 'PIN ใหม่ (4-6 หลัก) หรือเว้นว่างเพื่อล้าง' : 'ตั้ง PIN 4-6 หลัก'}
                          className="flex-1 min-w-0 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
                        />
                        <button onClick={setPinUI} className="shrink-0 px-2.5 py-1 rounded bg-gray-800 hover:bg-gray-700 border border-gray-600 text-xs">💾 บันทึก</button>
                      </div>
                      <div className="text-[10px] text-gray-600 leading-relaxed">ตั้ง PIN แล้ว ลูกจะกรอกรหัสก่อนกด "✓ เสร็จ" และ "🎁 แลก" — ฝึกให้ลูกรับผิดชอบงานและคะแนนของตัวเอง</div>
                    </div>

                    {/* ── หุ้นจำลองของบ้าน — สอนลูกเรื่องการลงทุน ── */}
                    <div className="bg-gray-950/50 border border-gray-800 rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold">📈 หุ้นจำลองของบ้าน</h3>
                        <span className="text-[10px] text-gray-500">ราคาเปลี่ยนทุกวัน (ธีมเดียวกับบ้านเรา)</span>
                      </div>
                      {stocks.length > 0 && (
                        <div className="grid grid-cols-3 gap-1.5">
                          {stocks.map((s) => (
                            <div key={s.symbol} className={`rounded-lg border p-2 text-center cursor-pointer ${stockForm.symbol === s.symbol ? 'bg-emerald-900/30 border-emerald-600' : 'bg-gray-800/50 border-gray-700 hover:border-gray-500'}`} onClick={() => setStockForm((prev) => ({ ...prev, symbol: s.symbol }))}>
                              <div className="text-base">{s.emoji}</div>
                              <div className="text-[10px] text-gray-400 truncate">{s.name}</div>
                              <div className="text-sm font-bold text-emerald-300">{s.price.toFixed(2)}฿</div>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-1.5 items-center">
                        <input
                          value={stockForm.units}
                          onChange={(e) => setStockForm((prev) => ({ ...prev, units: e.target.value }))}
                          type="number"
                          min={1}
                          placeholder="หน่วย"
                          className="w-20 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
                        />
                        <button onClick={buyStockUI} disabled={(kidHome?.balance ?? 0) <= 0} className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold disabled:opacity-40">🛒 ซื้อ</button>
                      </div>
                      {kidHome.portfolio.holdings.length > 0 && (
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-[11px] bg-gray-800/40 border border-gray-800 rounded px-2 py-1.5">
                            <span className="text-gray-400">มูลค่าพอร์ตรวม</span>
                            <span className="font-bold text-gray-100">{kidHome.portfolio.value.toLocaleString()}฿</span>
                            <span className={kidHome.portfolio.totalProfit >= 0 ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                              {kidHome.portfolio.totalProfit >= 0 ? '+' : ''}{kidHome.portfolio.totalProfit.toLocaleString()}฿
                            </span>
                          </div>
                          {kidHome.portfolio.holdings.map((h) => (
                            <div key={h.symbol} className="flex items-center gap-2 text-[11px] bg-gray-800/40 border border-gray-800 rounded px-2 py-1.5">
                              <span className="shrink-0">{h.emoji}</span>
                              <span className="flex-1 truncate text-gray-400">{h.name} · {h.units} หน่วย</span>
                              <span className="shrink-0 text-gray-500">ต้นทุน {h.avg_cost}฿</span>
                              <span className={`shrink-0 font-bold ${h.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{h.profit >= 0 ? '+' : ''}{h.profit}฿ ({h.profitPct}%)</span>
                              <button onClick={() => sellStockUI(h.symbol, Math.min(1, h.units))} className="shrink-0 px-2 py-0.5 rounded bg-red-900/50 hover:bg-red-800 border border-red-800 text-[10px]">ขาย</button>
                            </div>
                          ))}
                        </div>
                      )}
                      {/* กราฟมูลค่าพอร์ตย้อนหลัง (SVG) */}
                      {kidHome.portfolio_history.length > 1 && (
                        <PortfolioHistoryChart data={kidHome.portfolio_history} />
                      )}

                      {/* ผลตอบแทน vs เงินฝาก + เป้าหมายรายเดือน */}
                      <div className="space-y-1.5">
                        <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                          <div className="bg-gray-800/40 border border-gray-800 rounded px-2 py-1.5">
                            <div className="text-gray-500">💰 เงินจริงที่พ่อแม่ฝาก</div>
                            <div className="font-bold text-gray-100">{kidHome.portfolio_performance.total_deposited.toLocaleString()}฿</div>
                          </div>
                          <div className="bg-gray-800/40 border border-gray-800 rounded px-2 py-1.5">
                            <div className="text-gray-500">📈 ผลตอบแทนรวม</div>
                            <div className={`font-bold ${kidHome.portfolio_performance.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {kidHome.portfolio_performance.profit >= 0 ? '+' : ''}{kidHome.portfolio_performance.profit.toLocaleString()}฿ ({kidHome.portfolio_performance.profit_pct}%)
                            </div>
                          </div>
                        </div>
                        <div className="bg-gray-800/40 border border-gray-800 rounded px-2 py-1.5">
                          <div className="flex items-center justify-between text-[10px]">
                            <span className="text-gray-500">🎯 ผลตอบแทนเดือนนี้: {kidHome.portfolio_performance.month_return_pct != null ? `${kidHome.portfolio_performance.month_return_pct >= 0 ? '+' : ''}${kidHome.portfolio_performance.month_return_pct}%` : 'ยังไม่มีข้อมูล'} · เป้าหมาย {kidHome.portfolio_performance.target_pct}%</span>
                            <span className={`font-bold ${(kidHome.portfolio_performance.month_return_pct ?? -999) >= kidHome.portfolio_performance.target_pct ? 'text-emerald-400' : 'text-amber-300'}`}>
                              {kidHome.portfolio_performance.month_return_pct != null && kidHome.portfolio_performance.target_pct > 0 ? ((kidHome.portfolio_performance.month_return_pct ?? 0) >= kidHome.portfolio_performance.target_pct ? '✓ ถึงเป้า' : 'ยังไม่ถึง') : ''}
                            </span>
                          </div>
                          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden mt-1">
                            <div className="h-full bg-gradient-to-r from-amber-500 to-yellow-400" style={{ width: `${Math.min(100, kidHome.portfolio_performance.target_pct > 0 ? ((kidHome.portfolio_performance.month_return_pct ?? 0) / kidHome.portfolio_performance.target_pct) * 100 : 0)}%` }} />
                          </div>
                          <div className="flex gap-1.5 mt-1.5">
                            <input
                              value={targetPctForm.pct}
                              onChange={(e) => setTargetPctForm({ pct: e.target.value })}
                              type="number"
                              min={0}
                              max={100}
                              step={0.5}
                              placeholder="% ต่อเดือน"
                              className="w-24 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-[10px]"
                            />
                            <button onClick={setTargetUI} className="px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 border border-gray-600 text-[10px]">🎯 ตั้งเป้า</button>
                          </div>
                        </div>
                        {/* ฝากเงินจริงเข้าพอร์ต */}
                        <div className="flex gap-1.5 items-center pt-0.5">
                          <input
                            value={depositForm.amount}
                            onChange={(e) => setDepositForm((p) => ({ ...p, amount: e.target.value }))}
                            type="number"
                            min={1}
                            placeholder="จำนวน (฿)"
                            className="w-24 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-[11px]"
                          />
                          <input
                            value={depositForm.note}
                            onChange={(e) => setDepositForm((p) => ({ ...p, note: e.target.value }))}
                            placeholder="หมายเหตุ เช่น เงินออมจากค่าขนม"
                            className="flex-1 min-w-0 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-[11px]"
                          />
                          <button onClick={addDepositUI} className="shrink-0 px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-500 text-[11px] font-bold">💵 เติมเงินจริง</button>
                        </div>
                        {kidHome.portfolio_deposits.length > 0 && (
                          <div className="text-[10px] text-gray-500 space-y-0.5 max-h-16 overflow-y-auto pr-1">
                            {kidHome.portfolio_deposits.slice(0, 5).map((d) => (
                              <div key={d.id} className="flex justify-between">
                                <span className="truncate">💵 {d.note}</span>
                                <span className="shrink-0 font-bold text-amber-300">+{d.amount}฿</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 pt-0.5">
                        <span className="text-[9px] text-gray-600 leading-relaxed">💡 ซื้อถูก-ขายแพง เก็บเงินส่วนหนึ่งเข้าถังเสมอ — อยากรู้วิธี ไปให้ AI สอนลูก:</span>
                        <button
                          onClick={() => { setShowKidHome(false); setTeachTopic('การออมเงิน หุ้น และการลงทุนสำหรับเด็ก'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                          className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-900/40 border border-emerald-700 text-emerald-300 hover:bg-emerald-800"
                        >
                          🧑‍🏫 สอนเรื่องออม/หุ้น
                        </button>
                      </div>
                    </div>

                    {/* ── ประวัติการใช้งาน (audit log) ── */}
                    <div className="bg-gray-950/50 border border-gray-800 rounded-lg p-3 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold">📜 ประวัติการใช้งานของลูก</h3>
                        <span className="text-[10px] text-gray-500">{auditLoading ? 'กำลังโหลด...' : `${audit.length} รายการ`}</span>
                      </div>
                      {audit.length === 0 ? (
                        <div className="text-[11px] text-gray-600">ยังไม่มีประวัติ — กิจกรรมของลูก (ทำงานเสร็จ/จ่ายบิล/แลกคูปอง/ตั้ง PIN/ซื้อขายหุ้น) จะบันทึกที่นี่</div>
                      ) : (
                        <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                          {audit.slice(0, 15).map((a) => (
                            <div key={a.id} className="flex items-center gap-2 text-[11px] bg-gray-800/40 border border-gray-800 rounded px-2 py-1">
                              <span className="shrink-0">{AUDIT_LABELS[a.action] || a.action}</span>
                              <span className="flex-1 truncate text-gray-400">{a.detail}</span>
                              <span className="shrink-0 text-[9px] px-1 py-0.5 rounded ${a.actor === 'kid' ? 'bg-cyan-900/40 text-cyan-300' : 'bg-gray-700 text-gray-400'}">{a.actor === 'kid' ? 'ลูก' : 'ผู้ใหญ่'}</span>
                              <span className="shrink-0 text-gray-600">{fmtDate(a.created_at)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* ── คูปองรางวัล — ลูกแลกด้วยคะแนนจากการทำงานบ้าน ── */}
                    <div className="bg-gray-950/50 border border-gray-800 rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold">🎟️ คูปองรางวัล</h3>
                        <span className="text-[10px] text-gray-500">แลกด้วยคะแนนที่หาได้จากงานบ้าน</span>
                      </div>
                      <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                        {kidHome.coupons.length === 0 && <div className="text-[11px] text-gray-600">ยังไม่มีคูปอง — สร้างรางวัลพิเศษ เช่น "เล่นเกม 30 นาที" แล้วให้ลูกทำงานสะสมคะแนนมาแลก</div>}
                        {kidHome.coupons.map((c) => (
                          <div key={c.id} className={`flex items-center gap-2 text-xs rounded px-2 py-1.5 border ${c.status === 'redeemed' ? 'bg-gray-800/40 border-gray-800 text-gray-500' : 'bg-violet-900/10 border-violet-800/60 text-violet-200'}`}>
                            <span className="shrink-0">{c.emoji || '🎟️'}</span>
                            <span className={`flex-1 truncate ${c.status === 'redeemed' ? 'line-through' : ''}`}>{c.title}</span>
                            <span className="shrink-0 font-bold text-amber-300">{c.cost} แต้ม</span>
                            {c.status === 'available' ? (
                              <button
                                onClick={() => redeemCouponUI(c)}
                                disabled={kidHome.balance < c.cost}
                                title={kidHome.balance < c.cost ? `คะแนนไม่พอ (มี ${kidHome.balance})` : 'แลกเลย'}
                                className="shrink-0 px-2 py-0.5 rounded bg-violet-600 hover:bg-violet-500 text-[10px] disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                🎁 แลก
                              </button>
                            ) : (
                              <span className="shrink-0 text-[10px] text-green-500">✓ แลกแล้ว</span>
                            )}
                            <button onClick={() => deleteCouponUI(c)} title="ลบ" className="shrink-0 text-red-400 hover:text-red-300 text-[10px]">✕</button>
                          </div>
                        ))}
                      </div>
                      <div className="space-y-1.5 pt-1">
                        <div className="flex gap-1.5">
                          <input
                            value={couponForm.title}
                            onChange={(e) => setCouponForm({ ...couponForm, title: e.target.value })}
                            onKeyDown={(e) => e.key === 'Enter' && addCouponUI()}
                            placeholder="รางวัล เช่น เล่นเกม 30 นาที"
                            className="flex-1 min-w-0 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
                          />
                          <input
                            value={couponForm.cost}
                            onChange={(e) => setCouponForm({ ...couponForm, cost: e.target.value })}
                            type="number"
                            min={1}
                            placeholder="แต้ม"
                            className="w-16 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
                          />
                          <select
                            value={couponForm.emoji}
                            onChange={(e) => setCouponForm({ ...couponForm, emoji: e.target.value })}
                            className="w-12 bg-gray-800 border border-gray-600 rounded px-1 py-1 text-xs"
                          >
                            {COUPON_EMOJIS.map((e) => <option key={e} value={e}>{e}</option>)}
                          </select>
                          <button onClick={addCouponUI} className="shrink-0 px-2.5 py-1 rounded bg-violet-600 hover:bg-violet-500 text-xs font-semibold">＋ เพิ่มคูปอง</button>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {COUPON_PRESETS.map((p) => (
                            <button
                              key={p}
                              onClick={() => setCouponForm((prev) => ({ ...prev, title: p }))}
                              className="text-[9px] px-1.5 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-gray-500 hover:border-violet-600 hover:text-violet-300"
                            >
                              {p}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* ── กระเป๋าเงิน + ประวัติ ── */}
                    <div className="bg-gray-950/50 border border-gray-800 rounded-lg p-3 space-y-2">
                      <h3 className="text-sm font-bold">💰 กระเป๋าเงิน</h3>
                      <div className="flex gap-1.5 flex-wrap items-center">
                        {WALLET_PRESETS.map((p) => (
                          <button key={p} onClick={() => setWalletAmount(String(p))} className={`px-2 py-0.5 rounded text-[10px] border ${walletAmount === String(p) ? 'bg-green-600 border-green-600 text-white' : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'}`}>{p}฿</button>
                        ))}
                        <input
                          value={walletAmount}
                          onChange={(e) => setWalletAmount(e.target.value)}
                          type="number"
                          min={1}
                          placeholder="บาท"
                          className="w-20 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
                        />
                        <input
                          value={walletNote}
                          onChange={(e) => setWalletNote(e.target.value)}
                          placeholder="หมายเหตุ เช่น เงินเดือนประจำสัปดาห์"
                          className="flex-1 min-w-32 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs"
                        />
                        <button onClick={() => adjustWalletUI(1)} className="px-2.5 py-1 rounded bg-green-600 hover:bg-green-500 text-xs font-semibold">＋ เติม</button>
                        <button onClick={() => adjustWalletUI(-1)} className="px-2.5 py-1 rounded bg-red-700 hover:bg-red-600 text-xs font-semibold">－ หัก</button>
                      </div>
                      {kidHome.balance < 0 && (
                        <div className="text-[11px] text-red-400 bg-red-900/20 border border-red-800 rounded p-1.5">⚠️ ติดลบ {Math.abs(kidHome.balance)}฿ — สอนลูกเรื่องการจัดสรรเงินก่อนจ่ายบิลเกินตัว</div>
                      )}
                      {kidHome.txs.length > 0 && (
                        <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                          <div className="text-[10px] text-gray-500">ประวัติล่าสุด:</div>
                          {kidHome.txs.slice(0, 8).map((t) => (
                            <div key={t.id} className="flex items-center justify-between gap-2 text-[11px] bg-gray-800/40 border border-gray-800 rounded px-2 py-1">
                              <span className="truncate text-gray-400">
                                {t.category === 'chore' ? '🧹 ทำงาน' : t.category === 'bill' ? '🧾 จ่ายบิล' : t.category === 'allowance' ? '💰 ค่าขนม' : t.category === 'coupon' ? '🎟️ แลกคูปอง' : '💸 ปรับยอด'}
                                {t.note ? ` · ${t.note}` : ''}
                              </span>
                              <span className={`shrink-0 font-bold ${t.amount >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {t.amount >= 0 ? '+' : ''}{t.amount.toLocaleString()}฿
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── บทเรียน AI สอนลูก ── */}
            {lesson && (
              <div className="bg-gray-900 border border-green-800 rounded-xl p-5 space-y-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="text-[10px] text-green-500 font-bold">🧑‍🏫 AI สอนลูก · {teachAgeLabel(lesson.age_range || teachAge)}</div>
                    <h2 className="text-lg font-bold text-gray-100 mt-0.5">{lesson.title}</h2>
                    {lesson.summary && <p className="text-sm text-gray-400 mt-1 leading-relaxed">{lesson.summary}</p>}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => printLesson(lesson)} className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded">🖨️ พิมพ์/PDF</button>
                    {lessonSaving ? (
                      <span className="text-xs px-2 py-1 bg-gray-700 rounded">💾 กำลังเก็บ...</span>
                    ) : (
                      <button onClick={saveGeneratedLesson} className="text-xs px-2 py-1 bg-green-600 hover:bg-green-500 rounded font-semibold">💾 เก็บไว้ในคลังความรู้</button>
                    )}
                    <button
                      onClick={() => { setLesson(null); setTeachError(''); }}
                      className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded"
                    >✕ ปิด</button>
                  </div>
                </div>

                {!lessonUsedKnowledge && (
                  <div className="text-xs text-amber-300 bg-amber-900/30 border border-amber-700 rounded p-3 leading-relaxed">
                    ⚠️ ไม่พบข้อมูลในคลังความรู้ที่ตรงกับหัวข้อนี้ — AI สร้างบทเรียนจากความรู้ทั่วไป อยากได้บทเรียนจากข้อมูลที่เก็บไว้ เปลี่ยนหัวข้อ หรือเพิ่มข้อมูลในคลังความรู้ก่อน
                  </div>
                )}

                {/* เนื้อหาบทเรียน */}
                {lesson.sections.length > 0 && (
                  <div className="space-y-3">
                    {lesson.sections.map((s, i) => (
                      <div key={i} className="bg-gray-950/50 border border-gray-800 rounded-lg p-3">
                        {s.heading && <h3 className="text-sm font-bold text-green-400 mb-1">{s.heading}</h3>}
                        <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{s.content}</p>
                      </div>
                    ))}
                  </div>
                )}

                {lesson.key_points.length > 0 && (
                  <div className="bg-gray-950/50 border border-gray-800 rounded-lg p-3">
                    <h3 className="text-sm font-bold text-green-400 mb-1">⭐ จุดสำคัญที่ต้องจำ</h3>
                    <ul className="space-y-1">
                      {lesson.key_points.map((k, i) => (
                        <li key={i} className="text-sm text-gray-300 flex gap-2"><span className="text-green-500">•</span>{k}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* แบบทดสอบ */}
                {lesson.quiz.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold">🧩 แบบทดสอบ</h3>
                      <button onClick={resetQuiz} className="text-[11px] px-2 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded">🔄 ทำใหม่</button>
                    </div>
                    {lesson.quiz.map((q, qi) => {
                      const picked = quizAnswers[qi] ?? -1;
                      const answeredQ = picked >= 0;
                      const isCorrect = answeredQ && picked === q.answer;
                      return (
                        <div key={qi} className="bg-gray-950/50 border border-gray-800 rounded-lg p-3 space-y-2">
                          <div className="text-sm font-semibold text-gray-100">
                            {qi + 1}. {q.question}
                            {answeredQ && <span className={`ml-2 text-xs ${isCorrect ? 'text-green-400' : 'text-red-400'}`}>{isCorrect ? '✔ ถูกต้อง!' : '✘ ยังไม่ถูก'}</span>}
                          </div>
                          <div className="space-y-1">
                            {q.options.map((opt, oi) => {
                              let cls = 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-500';
                              if (answeredQ) {
                                if (oi === q.answer) cls = 'bg-green-900/40 border-green-600 text-green-300';
                                else if (oi === picked) cls = 'bg-red-900/40 border-red-600 text-red-300';
                                else cls = 'bg-gray-800/50 border-gray-800 text-gray-500';
                              }
                              return (
                                <button
                                  key={oi}
                                  onClick={() => pickQuizOption(qi, oi)}
                                  disabled={answeredQ}
                                  className={`block w-full text-left px-3 py-1.5 rounded text-sm border transition ${cls} disabled:cursor-default`}
                                >
                                  {answeredQ && oi === q.answer ? '✔ ' : answeredQ && oi === picked ? '✘ ' : `${oi + 1}. `}{opt}
                                </button>
                              );
                            })}
                          </div>
                          {answeredQ && q.explanation && (
                            <div className="text-xs text-gray-400 bg-gray-800/50 border border-gray-700 rounded p-2 leading-relaxed">💡 {q.explanation}</div>
                          )}
                        </div>
                      );
                    })}
                    {quizAnswers.every((a) => a >= 0) && lesson.quiz.length > 0 && (
                      <div className="p-3 rounded-lg bg-green-900/30 border border-green-700 text-sm text-green-300">
                        🎉 ได้ {lesson.quiz.filter((_, i) => quizAnswers[i] === lesson.quiz[i].answer).length}/{lesson.quiz.length} คะแนน — {lesson.quiz.filter((_, i) => quizAnswers[i] === lesson.quiz[i].answer).length === lesson.quiz.length ? 'เก่งมาก! เรียนจบบทนี้แล้ว 🏆' : 'ลองทบทวนเนื้อหาด้านบนแล้วทำใหม่นะ'}
                        {activeKidId && kids.find((k) => k.id === activeKidId) && ` — บันทึกคะแนนให้ ${kids.find((k) => k.id === activeKidId)!.name} แล้ว`}
                      </div>
                    )}
                  </div>
                )}

                {/* แหล่งข้อมูลที่ใช้ */}
                {lesson.sources.length > 0 && (
                  <div className="text-[10px] text-gray-600 leading-relaxed">
                    📚 อ้างอิงจากคลังความรู้: {lesson.sources.filter((s, i, arr) => arr.indexOf(s) === i).join(' · ')}
                  </div>
                )}
              </div>
            )}

            {/* ผลค้นหา */}
            {searchResults !== null && (
              <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold">ผลการค้นหา ({searchResults.length})</h3>
                  <button onClick={() => setSearchResults(null)} className="text-xs text-gray-500 hover:text-gray-300">✕ ปิด</button>
                </div>
                {searchResults.length === 0 ? (
                  <div className="text-gray-500 text-sm">ไม่พบข้อมูลที่เกี่ยวข้อง</div>
                ) : (
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {searchResults.map((r, i) => (
                      <div key={i} className="bg-gray-800 rounded-lg p-3 border border-gray-700">
                        <div className="flex items-center justify-between mb-1 text-[10px] text-gray-500">
                          <span>{r.source === 'semantic' ? '🧠 semantic' : '🔤 keyword'} · {r.file} · ความใกล้เคียง {r.score}</span>
                          <button onClick={() => openSearchResult(r)} className="text-blue-400 hover:underline">เปิด</button>
                        </div>
                        <p className="text-xs text-gray-300 whitespace-pre-wrap line-clamp-4">{r.content}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* รายการคลังความรู้ */}
            {loading ? (
              <div className="text-gray-500 text-sm text-center py-10">⏳ กำลังโหลดคลังความรู้...</div>
            ) : filtered.length === 0 ? (
              <div className="bg-gray-900 border border-dashed border-gray-700 rounded-xl p-10 text-center space-y-2">
                <div className="text-4xl">📚</div>
                <div className="text-gray-400 text-sm">ยังไม่มีข้อมูลในคลังความรู้</div>
                <div className="text-gray-600 text-xs">
                  เก็บได้ทั้ง ลิงก์เว็บ คลิปวิดีโอ ไฟล์ PDF/TXT บันทึกส่วนตัว — กด "➕ เพิ่มข้อมูล" เพื่อเริ่ม
                  <br />ข้อมูลที่รวบรวมไว้จะใช้ค้นหา (semantic search) และเป็นฐานความรู้สำหรับ AI ต่าง ๆ ในอนาคต (เช่น AI สอนลูก)
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filtered.map((item) => {
                  const meta = TYPE_META[item.type];
                  return (
                    <button
                      key={item.id}
                      onClick={() => openItem(item)}
                      className={`text-left bg-gray-900 border rounded-xl p-4 space-y-2 transition hover:border-gray-500 ${selected?.id === item.id ? 'border-green-500' : 'border-gray-700'}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xl">{meta.icon}</span>
                          <div className="min-w-0">
                            <div className="font-bold text-sm text-gray-100 truncate">{item.title}</div>
                            {item.url && <div className="text-[10px] text-blue-400 truncate">{item.url}</div>}
                          </div>
                        </div>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold shrink-0 ${meta.color}`}>{meta.label}</span>
                      </div>
                      {item.preview && <div className="text-xs text-gray-500 line-clamp-2">{item.preview}</div>}
                      {item.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {item.tags.map((t) => (
                            <span key={t} className="text-[9px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">#{t}</span>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center justify-between text-[10px] text-gray-600">
                        <span>{fmtDate(item.created_at)}</span>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); deleteItem(item); }}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); deleteItem(item); } }}
                          className="text-red-400 hover:text-red-300"
                        >
                          🗑️
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* ตัวแสดงผลละเอียด */}
            {selected && (
              <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-xs text-gray-500">{TYPE_META[selected.type].icon} {TYPE_META[selected.type].label} · {fmtDate(selected.created_at)}</div>
                    <h2 className="text-lg font-bold text-gray-100 mt-0.5">{selected.title}</h2>
                    {selected.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {selected.tags.map((t) => <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">#{t}</span>)}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {selected.url && (
                      <a href={selected.url} target="_blank" rel="noopener noreferrer" className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded">🔗 เปิดต้นทาง</a>
                    )}
                    <button onClick={() => setSelected(null)} className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded">✕ ปิด</button>
                  </div>
                </div>

                {/* วิดีโอ */}
                {selected.type === 'VIDEO' && embed && (
                  <div className="aspect-video bg-black rounded-lg overflow-hidden">
                    <iframe src={embed} className="w-full h-full" allowFullScreen title={selected.title} />
                  </div>
                )}
                {selected.type === 'VIDEO' && !embed && (
                  <div className="text-sm text-amber-300 bg-amber-900/30 border border-amber-700 rounded p-3">
                    ไม่รู้จักรูปแบบวิดีโอนี้ (รองรับ YouTube / Vimeo) — เปิดลิงก์ต้นทางแทน
                  </div>
                )}

                {/* PDF */}
                {selected.type === 'PDF' && selected.file_path && (
                  <div className="bg-black rounded-lg overflow-hidden" style={{ height: '480px' }}>
                    <iframe
                      src={`${process.env.NEXT_PUBLIC_API_URL}/api/knowledge/uploads/${encodeURIComponent(selected.file_path.split('/').pop() || '')}`}
                      className="w-full h-full"
                      title={selected.title}
                    />
                  </div>
                )}

                {/* เนื้อหา */}
                {selected.content && selected.type !== 'PDF' && (
                  <pre className="text-xs text-gray-300 bg-gray-950/60 border border-gray-800 rounded-lg p-3 max-h-96 overflow-y-auto whitespace-pre-wrap font-mono leading-relaxed">
                    {selected.content}
                  </pre>
                )}
                {selected.type === 'PDF' && !selected.content && (
                  <div className="text-xs text-gray-500">📄 ไม่มีข้อความที่สกัดได้ (อาจเป็นภาพสแกน) — เปิดไฟล์ PDF ด้านบนดูเอง หรือเพิ่มบันทึก</div>
                )}

                {selected.notes && (
                  <div className="text-xs text-gray-400 bg-gray-800/50 border border-gray-700 rounded p-3">
                    📝 {selected.notes}
                  </div>
                )}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
