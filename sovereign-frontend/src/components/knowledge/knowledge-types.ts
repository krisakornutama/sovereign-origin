// ── ประเภท/ค่าคงที่/helper ที่ใช้ร่วมกันระหว่างหน้า knowledge และ component ย่อย ──
// (แยกมาจาก src/pages/knowledge.tsx — ย้าย verbatim ไม่แก้ logic)
import { fmtLocale } from '../../lib/formatDate';

export type ItemType = 'LINK' | 'VIDEO' | 'PDF' | 'TXT' | 'WEBPAGE' | 'NOTE';

export interface KnowledgeItem {
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

export const TYPE_META: Record<ItemType, { icon: string; label: string; color: string }> = {
  LINK: { icon: 'external', label: 'ลิงก์', color: 'border-blue-500/30 bg-blue-500/15 text-blue-300' },
  VIDEO: { icon: 'play', label: 'วิดีโอ', color: 'border-red-500/30 bg-red-500/15 text-red-300' },
  PDF: { icon: 'file', label: 'PDF', color: 'border-orange-500/30 bg-orange-500/15 text-orange-300' },
  TXT: { icon: 'note', label: 'ไฟล์ข้อความ', color: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300' },
  WEBPAGE: { icon: 'globe', label: 'เว็บเพจ', color: 'border-cyan-500/30 bg-cyan-500/15 text-cyan-300' },
  NOTE: { icon: 'book', label: 'บันทึก', color: 'border-violet-500/30 bg-violet-500/15 text-violet-300' },
};

export const TYPE_ORDER: ItemType[] = ['LINK', 'VIDEO', 'PDF', 'TXT', 'WEBPAGE', 'NOTE'];

// ── AI สอนลูก — บทเรียน + แบบทดสอบที่สร้างจากคลังความรู้ ──
export interface TeachQuizQuestion {
  question: string;
  options: string[];
  answer: number; // index ของตัวเลือกที่ถูก
  explanation: string;
}

export interface TeachLesson {
  title: string;
  age_range: string;
  summary: string;
  sections: { heading: string; content: string }[];
  key_points: string[];
  quiz: TeachQuizQuestion[];
  sources: string[];
}

export const AGE_OPTIONS = [
  { id: '3-5', label: '3-5 ปี (อนุบาล)' },
  { id: '6-8', label: '6-8 ปี (ประถมต้น)' },
  { id: '9-12', label: '9-12 ปี (ประถมปลาย)' },
  { id: '13-15', label: '13-15 ปี (มัธยมต้น)' },
  { id: '16+', label: '16 ปีขึ้นไป (มัธยมปลาย)' },
];

export const LESSON_TAG = 'บทเรียน'; // แท็กของบทเรียนที่เก็บในคลังความรู้

// ── โปรไฟล์เด็ก — เก็บคะแนน/บทเรียนที่เรียนจบของแต่ละคน ──
export interface KidProfile {
  id: string;
  name: string;
  age: number | null;
  emoji: string | null;
  color: string | null;
}

export interface KidStats {
  attempts: number;
  totalCorrect: number;
  totalQuestions: number;
  best: number | null;
  avg: number | null;
}

export interface KidProgressRow {
  id: string;
  lesson_item_id: string | null;
  lesson_title: string;
  score: number;
  total: number;
  completed_at: string;
}

// ── หน้าที่ของลูก — งานบ้าน / บิล / กระเป๋าเงิน ──
export interface KidChore {
  id: string;
  title: string;
  reward: number;
  emoji: string | null;
  status: string; // pending | done
  repeat: string; // none | daily
  completed_at: string | null;
}

export interface KidBill {
  id: string;
  title: string;
  amount: number;
  emoji: string | null;
  period: string; // one-time | monthly
  status: string; // unpaid | paid
}

export interface KidWalletTx {
  id: string;
  amount: number;
  note: string;
  category: string;
  created_at: string;
}

export interface KidCoupon {
  id: string;
  title: string;
  cost: number;
  emoji: string | null;
  status: string; // available | redeemed
  redeemed_at: string | null;
}

export interface KidHome {
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
export interface KidStock {
  symbol: string;
  name: string;
  emoji: string;
  base: number;
  price: number;
}

// ── Audit log ของลูก ──
export interface KidAuditRow {
  id: string;
  action: string;
  detail: string | null;
  actor: string;
  created_at: string;
}

export const AUDIT_LABELS: Record<string, string> = {
  coupon_redeem: 'แลกคูปอง',
  pin_set: 'ตั้ง PIN',
  pin_clear: 'ล้าง PIN',
  chore_complete: 'ทำงานเสร็จ',
  bill_pay: 'จ่ายบิล',
  stock_buy: 'ซื้อหุ้น',
  stock_sell: 'ขายหุ้น',
  allowance_pay: 'ค่าขนม',
};

// ── ประวัติค่าขนมของทุกคน (จ่ายย้อนหลังได้) ──
export interface AllowanceHistoryKid {
  id: string;
  name: string;
  emoji: string | null;
  allowance_day: number | null;
  allowance_amount: number | null;
  allowance_last_paid: string | null;
  txs: { id: string; amount: number; note: string; created_at: string }[];
}

export const CHORE_EMOJIS = ['🧹', '🧽', '🧺', '🍳', '🚰', '🐶', '🪴', '🗑️', '🛏️', '💪'];
export const BILL_EMOJIS = ['💡', '🚿', '🏠', '📱', '📺', '🌐', '🚗', '🧾'];
export const WALLET_PRESETS = [10, 20, 50, 100];
export const WEEKDAY_LABELS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
export const COUPON_EMOJIS = ['🎮', '📺', '🍦', '🎁', '🎬', '📱', '🏞️', '🧸', '🎨', '🏊'];
export const COUPON_PRESETS = ['เล่นเกม 30 นาที', 'ดูทีวี 1 ชั่วโมง', 'ไอศกรีม 1 ถ้วย', 'ออกไปเล่นนอกบ้าน', 'เลือกเมนูอาหารเย็น', 'เงินค่าแป้งพิเศษ'];
export const PIGGY_PRESETS = [10, 20, 50, 100];

// ── รายงานรายสัปดาห์ (PDF) — โครงสร้างจาก GET /teach/report/weekly ──
export interface WeeklyReportKid {
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

export const KID_EMOJIS = ['🧒', '👧', '👦', '🧑', '👶', '🦁', '🐯', '🐰', '🦊', '🐼', '🦄', '🤖'];
export const ACTIVE_KID_KEY = 'sovereign-active-kid'; // localStorage

// ── Sovereign Curriculum — หลักสูตรสร้างยอดคน (โฮมสคูล) ──
export interface CurriculumItemI {
  id: string;
  title: string;
  description: string | null;
  stage: number;
  sequence: number;
}
export interface CurriculumTrackI {
  id: string;
  code: string;
  title: string;
  description: string | null;
  emoji: string;
  color: string;
  sort_order: number;
  items: CurriculumItemI[];
}
export interface CurriculumOverview {
  tracks: CurriculumTrackI[];
  kids: Array<{
    id: string;
    name: string;
    emoji: string | null;
    color: string | null;
    per_track: Record<string, { done: string[]; total: number; completed: boolean }>;
    completed_tracks: string[];
  }>;
  certificates: Array<{ id: string; kid_id: string; title: string; detail: string | null; created_at: string }>;
}

// ดึง YouTube / Vimeo video id สำหรับ embed
export function videoEmbedUrl(url: string): string | null {
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const vm = url.match(/vimeo\.com\/(\d+)/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  return null;
}

export function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(fmtLocale(), { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

// จ่ายค่าขนมครบสัปดาห์นี้หรือยัง? (เทียบ anchor = ครั้งล่าสุดของวันจ่าย)
export function isPaidThisWeek(day: number | null, lastPaid: string | null, now = new Date()): boolean {
  if (day == null || !lastPaid) return false;
  const diff = (now.getDay() - day + 7) % 7;
  const anchor = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff);
  return new Date(lastPaid) >= anchor;
}

export function teachAgeLabel(id: string): string {
  return AGE_OPTIONS.find((a) => a.id === id)?.label || id;
}
