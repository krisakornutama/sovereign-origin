"use client";

/**
 * แท็บของ "ศูนย์" ที่รวมหน้าเดิมไว้ด้วยกัน (19/10/69)
 *
 * ทำไมอยู่ที่ PageHeader: ทุกหน้าภายในใช้หัวหน้าเดียวกันอยู่แล้ว
 * → เพิ่มแท็บที่เดียว = ทุกหน้าในศูนย์ได้แท็บครบ โดยไม่ต้องแก้ทีละหน้า
 * (หน้าไหนไม่ได้อยู่ในศูนย์ → ไม่แสดงอะไรเลย)
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { normalizeNavHref, sectionForPath } from '../../lib/navigation';
import { useLanguageStore } from '../../stores/useLanguageStore';
import { useFeatureStore } from '../../stores/useFeatureStore';
import { useIsSuperadmin } from '../../lib/roles';
import Icon from './Icon';

export default function SectionTabs() {
  const pathname = usePathname() || '/';
  const t = useLanguageStore((s) => s.t);
  const hasFeature = useFeatureStore((s) => s.has);
  const isSuperadmin = useIsSuperadmin();
  const section = sectionForPath(pathname);
  const current = normalizeNavHref(pathname);

  // เคารพสิทธิ์รายหน้าเหมือน Sidebar — SUPERADMIN เห็นครบ, คนอื่นเห็นเฉพาะที่มีสิทธิ์
  // (has() คืน true ระหว่างที่ยังไม่รู้สิทธิ์ = ไม่กระพริบ)
  const tabs = section
    ? isSuperadmin
      ? section.tabs
      : section.tabs.filter((tab) => hasFeature(tab.href.split('#')[0]))
    : [];

  // ศูนย์ที่มีหน้าเดียวหรือไม่ใช่เส้นทางของศูนย์ = ไม่ต้องมีแถบแท็บ
  if (!section || tabs.length < 2) return null;

  return (
    <nav
      aria-label={t(section.titleKey, section.title)}
      className="mt-4 flex gap-1.5 overflow-x-auto pb-1 -mb-1"
    >
      {tabs.map((tab) => {
        const active = normalizeNavHref(tab.href) === current;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            scroll={false}
            aria-current={active ? 'page' : undefined}
            className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] border transition-colors ${
              active
                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30 shadow-[0_0_12px_rgba(52,211,153,0.12)]'
                : 'text-gray-400 border-gray-800 bg-gray-900/40 hover:text-gray-200 hover:border-gray-700'
            }`}
          >
            <Icon name={tab.icon} size={13} className={active ? 'glow-text' : 'opacity-60'} />
            <span className="whitespace-nowrap">{t(tab.labelKey, tab.label)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
