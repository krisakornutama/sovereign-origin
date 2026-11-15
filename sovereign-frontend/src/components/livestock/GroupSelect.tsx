"use client";
// ── GroupSelect — dropdown เลือกกลุ่มปศุสัตว์ ──
// ย้ายจาก pages/livestock.tsx ตามเดิมทุกบรรทัด (FE-003)
import type { Group } from '../../lib/livestock-helpers';

export default function GroupSelect({ groups, selId, onChange, t }: any) {
  return (
    <select value={selId} onChange={(e) => onChange(e.target.value)} className="input">
      <option value="">{t('livestock.finance.noGroup', 'ไม่ผูกกลุ่ม')}</option>
      {groups.map((g: Group) => <option key={g.id} value={g.id}>{g.code}{g.name ? ` — ${g.name}` : ''}</option>)}
    </select>
  );
}
