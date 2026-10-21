"use client";

/**
 * QuickDeck — แผงทางลัดงานประจำบนแดชบอร์ด (Liquid Glass, ไม่ใช้ WebGL)
 *
 * เหตุผล (คำสั่งเจ้าของ 21/10/69: "ทำกราฟิก พร้อมกับปรับปรุง ทำให้ใช้งานได้เร็วเข้า"):
 *   • งานที่ทำบ่อยที่สุดต้องอยู่ "บนสุด" — ไม่ต้องเลื่อนผ่านวิดเจ็ต 8 ตัวก่อน
 *   • หนึ่งคลิกต่อหนึ่งงาน (เป้าหมาย ≥ 56px สูง — กดด้วยนิ้วบนจอสัมผัสได้)
 *   • ใช้ GlassSurface (SVG displacement) แทน WebGL ⇒ ต้นทุน GPU ต่ำ วางบนหน้าจริงได้
 *     (ของ WebGL ยังอยู่ที่ /hover-cards ตามกติกา J8g)
 *
 * เพิ่ม/ลดทางลัด: แก้ที่ ACTIONS ด้านล่าง — เทสต์ `tools/test/quick-deck.test.mjs`
 * ตรวจว่า href ทุกตัวมีไฟล์หน้าจริง และจำนวนต้องอยู่ระหว่าง 4–5 ปุ่ม
 */
import Link from 'next/link';
import GlassSurface from '../glass/GlassSurface';
import Icon from './Icon';
import { useLanguageStore } from '../../stores/useLanguageStore';

type QuickAction = {
  href: string;
  icon: string;
  titleKey: string;
  title: string;
  hintKey: string;
  hint: string;
  /** ไล่เฉดของวงไอคอน — ใช้สีต่ำ饱和度เพื่อไม่แย่งสายตากับข้อมูล */
  accent: string;
  iconColor: string;
  /** บนมือถือให้กินสองคอลัมน์ (ใช้กับปุ่มสุดท้ายที่เหลือเศษ) */
  span?: string;
};

const ACTIONS: QuickAction[] = [
  {
    href: '/business',
    icon: 'portfolio',
    titleKey: 'quickdeck.sell',
    title: 'ขาย / หน้าร้าน',
    hintKey: 'quickdeck.sellHint',
    hint: 'ออเดอร์ · รับชำระ · สลิป',
    accent: 'from-emerald-400/25 to-teal-500/5',
    iconColor: 'text-emerald-300',
  },
  {
    href: '/inventory',
    icon: 'inventory',
    titleKey: 'quickdeck.stock',
    title: 'สินค้า / สต็อก',
    hintKey: 'quickdeck.stockHint',
    hint: 'เพิ่ม · นับ · Lot',
    accent: 'from-sky-400/25 to-blue-500/5',
    iconColor: 'text-sky-300',
  },
  {
    href: '/restaurant/kds',
    icon: 'automation',
    titleKey: 'quickdeck.kds',
    title: 'จอครัว (KDS)',
    hintKey: 'quickdeck.kdsHint',
    hint: 'คิวออเดอร์สด',
    accent: 'from-amber-400/25 to-orange-500/5',
    iconColor: 'text-amber-300',
  },
  {
    href: '/treasury',
    icon: 'reports',
    titleKey: 'quickdeck.money',
    title: 'เงิน / ภาษี',
    hintKey: 'quickdeck.moneyHint',
    hint: 'รายรับ · ภ.พ.30',
    accent: 'from-violet-400/25 to-purple-500/5',
    iconColor: 'text-violet-300',
  },
  {
    href: '/farm',
    icon: 'farm',
    titleKey: 'quickdeck.farm',
    title: 'ฟาร์ม',
    hintKey: 'quickdeck.farmHint',
    hint: 'แปลง · รอบเก็บเกี่ยว',
    accent: 'from-lime-400/25 to-green-500/5',
    iconColor: 'text-lime-300',
    span: 'col-span-2 sm:col-span-1',
  },
];

export default function QuickDeck() {
  const t = useLanguageStore((s) => s.t);

  return (
    <section aria-label={t('quickdeck.aria', 'ทางลัดงานประจำ')} className="relative mb-3" data-testid="quick-deck">
      {/* แสงออโรร่าบาง ๆ ใต้กระจก — CSS ล้วน ไม่มี canvas/WebGL */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-x-1 -top-6 h-24 bg-[radial-gradient(60%_100%_at_50%_0%,rgba(16,185,129,0.16),transparent_70%)] blur-xl"
      />

      <GlassSurface radius={20} tone="panel" blur={12} className="relative p-2.5">
        <div className="flex items-end justify-between gap-2 px-1.5 pb-2">
          <div>
            <div className="text-[9px] font-semibold uppercase tracking-[0.22em] text-emerald-200/70">Quick Deck</div>
            <div className="text-[10px] text-gray-400">{t('quickdeck.subtitle', 'งานประจำ · คลิกเดียว')}</div>
          </div>
          <div className="hidden sm:flex items-center gap-1.5 text-[9px] font-mono text-gray-500">
            <kbd className="rounded border border-gray-700/70 bg-gray-900/70 px-1.5 py-0.5">Ctrl</kbd>
            <span>+</span>
            <kbd className="rounded border border-gray-700/70 bg-gray-900/70 px-1.5 py-0.5">K</kbd>
            <span>{t('quickdeck.searchHint', 'ค้นหาทุกหน้า')}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          {ACTIONS.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              prefetch
              className={`group flex min-h-[56px] items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2 transition-colors hover:border-emerald-300/30 hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 ${action.span || ''}`}
            >
              <span
                className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-gradient-to-br ${action.accent} ${action.iconColor}`}
              >
                <Icon name={action.icon} size={16} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-semibold leading-tight text-gray-100">
                  {t(action.titleKey, action.title)}
                </span>
                <span className="mt-0.5 block truncate text-[10px] leading-tight text-gray-400">
                  {t(action.hintKey, action.hint)}
                </span>
              </span>
              <Icon
                name="arrow-right"
                size={12}
                className="shrink-0 text-gray-600 transition-transform group-hover:translate-x-0.5 group-hover:text-emerald-300"
              />
            </Link>
          ))}
        </div>
      </GlassSurface>
    </section>
  );
}
