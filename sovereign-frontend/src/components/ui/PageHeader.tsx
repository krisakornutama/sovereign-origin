"use client";

/**
 * หัวหน้าเพจมาตรฐาน — ใช้แทนการเขียน header ซ้ำ ๆ กันทุกหน้า
 * eyebrow = กลุ่มของหน้า (เช่น "ชีวิต & การเงิน"), title = ชื่อหน้า
 * theme = บรรยากาศของงาน ("power" | "wellness" | "lotus" | "nature" | "guard" | "wealth" | "kitchen" | "system")
 *         หรือ "circadian" = ตามเวลาของวัน (เช้า/สาย/เย็น/กลางคืนโทนฐาน)
 *         — ถ้าไม่ส่งมา ระบบเดาจากเส้นทางปัจจุบัน (auto) หรือส่ง "none" เพื่อบังคับค่าเดิม
 */
import { usePathname } from 'next/navigation';
import { circadianClass } from '../../lib/useCircadian';

export type PageTheme =
  | 'auto' | 'none' | 'circadian'
  | 'power' | 'wellness' | 'lotus' | 'nature' | 'guard' | 'wealth' | 'kitchen' | 'system' | 'mind';
type Atmosphere = Exclude<PageTheme, 'auto' | 'none' | 'circadian'>;

/** แผนที่เส้นทาง → ธีมบรรยากาศ (ใช้เมื่อไม่ได้ส่ง theme มาให้) */
const ROUTE_THEMES: Array<{ atmo: Atmosphere; re: RegExp }> = [
  { atmo: 'power', re: /^\/(energy|sensors|relay|automation|ota|infrastructure|predictive|ai|ai-agent|learning|governance-sim)(\/|$)/ },
  { atmo: 'wellness', re: /^\/(health|health-export|selfreliance|skills|lifestyle|crisis)(\/|$)/ },
  { atmo: 'mind', re: /^\/mbti(\/|$)/ },
  { atmo: 'lotus', re: /^\/healing(\/|$)/ },
  { atmo: 'nature', re: /^\/(farm|livestock|inventory|research|terrain-demo)(\/|$)/ },
  { atmo: 'guard', re: /^\/(security|vision|property|alerts|risk-monitor)(\/|$)/ },
  { atmo: 'wealth', re: /^\/(treasury|reports|knowledge|history)(\/|$)/ },
  { atmo: 'kitchen', re: /^\/restaurant(\/|$)/ },
  { atmo: 'system', re: /^\/(business|system|backup|users|audit|settings|change-password|hover-cards)(\/|$)/ },
];

export function themeClassForPath(pathname: string): string {
  for (const { atmo, re } of ROUTE_THEMES) {
    if (re.test(pathname || '/')) return `atmo-${atmo}`;
  }
  return '';
}

export default function PageHeader({
  eyebrow,
  title,
  subtitle,
  icon,
  actions,
  theme = 'auto',
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  theme?: PageTheme;
}) {
  const pathname = usePathname() || '/';
  const resolved =
    theme === 'auto' ? themeClassForPath(pathname)
    : theme === 'none' ? ''
    : theme === 'circadian' ? circadianClass()
    : `atmo-${theme}`;

  return (
    <header className={`flex flex-wrap items-end justify-between gap-4 mb-7 ${resolved}`}>
      <div className="min-w-0 flex-1">
        {eyebrow && (
          <div className="flex items-center gap-2 mb-1.5">
            <span className="w-6 h-px bg-gradient-to-r from-emerald-500/60 to-transparent" />
            <span className="eyebrow">{eyebrow}</span>
          </div>
        )}
        <h1 className="text-[22px] md:text-2xl font-bold text-gray-50 tracking-tight flex items-center gap-3 glow-text leading-none">
          {icon && (
            <span className="page-badge w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.15)]">
              {icon}
            </span>
          )}
          {title}
        </h1>
        {subtitle && <p className="text-[13px] text-gray-400 mt-1.5 leading-relaxed max-w-2xl">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap shrink-0">{actions}</div>}
    </header>
  );
}