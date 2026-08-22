// ── สร้าง HTML สำหรับรายงานรายสัปดาห์ (พิมพ์/PDF) — กราฟคะแนนเป็น SVG inline ──
// (ย้ายมาจาก src/pages/knowledge.tsx — verbatim)
import { fmtLocale } from '../../lib/formatDate';
import { WeeklyReportKid, WEEKDAY_LABELS } from './knowledge-types';

export function buildWeeklyReportHtml(kids: WeeklyReportKid[], generatedAt: string | undefined, t: (path: string, fallback?: string, vars?: Record<string, string | number>) => string): string {
  const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const pct = (p: { score: number; total: number }) => (p.total > 0 ? Math.round((p.score / p.total) * 100) : 0);
  const fmtD = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(fmtLocale(), { day: '2-digit', month: '2-digit' });
    } catch {
      return iso;
    }
  };

  // กราฟคะแนน (SVG) ของคนเดียว — เส้นตามเวลา
  const scoreSvg = (k: WeeklyReportKid) => {
    const pts = k.progress.map((p) => ({ time: new Date(p.completed_at).getTime(), pct: pct(p) }));
    if (pts.length === 0) return `<p class="muted">${t('knowledge.report.noQuizScores', 'ยังไม่มีคะแนนแบบทดสอบใน 7 วันนี้')}</p>`;
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
    const xTicks = Array.from({ length: 5 }, (_, i) => tMin + ((tMax - tMin) * i) / 4).map((tm) =>
      `<text x="${x(tm).toFixed(1)}" y="${H - 7}" text-anchor="middle" font-size="8" fill="#94a3b8">${fmtD(new Date(tm).toISOString())}</text>`
    ).join('');
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">${grid}${xTicks}${line}${dots}</svg>`;
  };

  const txs = (k: WeeklyReportKid) => {
    if (k.txs.length === 0) return `<p class="muted">${t('knowledge.report.noTxs', 'ไม่มีรายรับ-รายจ่ายใน 7 วันนี้')}</p>`;
    const cat: Record<string, string> = {
      chore: t('knowledge.home.txChore', 'ทำงาน'),
      bill: t('knowledge.home.txBill', 'จ่ายบิล'),
      manual: t('knowledge.home.txManual', 'ปรับยอด'),
      allowance: t('knowledge.home.txAllowance', 'ค่าขนม'),
      coupon: t('knowledge.home.txCoupon', 'แลกคูปอง'),
    };
    return `<ul class="tight">${k.txs.slice(0, 12).map((tx) =>
      `<li><b>${tx.amount >= 0 ? '+' : ''}${tx.amount}฿</b> — ${cat[tx.category] || tx.category}${tx.note ? ` · ${esc(tx.note)}` : ''} <span class="muted">(${fmtD(tx.created_at)})</span></li>`
    ).join('')}</ul>`;
  };

  const kidHtml = kids.map((k) => {
    const st = k.stats;
    const choresDone = k.chores.filter((c) => c.status === 'done').length;
    const choresPending = k.chores.filter((c) => c.status === 'pending').length;
    const billsUnpaid = k.bills.filter((b) => b.status === 'unpaid').length;
    const allow = k.allowance_amount != null ? `<p class="muted">${t('knowledge.report.allowance', 'ค่าขนม: ทุกวัน{day} {amount}฿/สัปดาห์', { day: t(`knowledge.weekday.${k.allowance_day ?? 0}`, WEEKDAY_LABELS[k.allowance_day ?? 0]), amount: k.allowance_amount })}</p>` : '';
    return `<section class="kid">
<h2>${k.emoji || '🧒'} ${esc(k.name)}${k.age != null ? ` <span class="muted">(${t('knowledge.home.age', '{n} ปี', { n: k.age })})</span>` : ''}</h2>
<div class="chips">
<span>${t('knowledge.report.lessonsDone', 'เรียนจบ 7 วัน:')} <b>${k.progress.length}</b> ${t('knowledge.report.lessons', 'บทเรียน')}</span>
<span>${t('knowledge.report.avg', 'เฉลี่ย:')} <b>${st.avg ?? 0}%</b></span>
<span>${t('knowledge.report.best', 'ดีที่สุด:')} <b>${st.best ?? 0}%</b></span>
<span>${t('knowledge.report.choresLabel', 'งาน:')} <b>${choresDone}</b> ${t('knowledge.report.done', 'เสร็จ')} / <b>${choresPending}</b> ${t('knowledge.report.pending', 'ค้าง')}</span>
<span>${t('knowledge.report.billsUnpaid', 'บิลค้าง:')} <b>${billsUnpaid}</b> ${t('knowledge.report.billsCount', 'ใบ')}</span>
<span>${t('knowledge.report.balance', 'ยอดเงิน:')} <b>${k.balance.toLocaleString()}฿</b></span>
</div>
${allow}
<h3>${t('knowledge.report.quizChart', 'คะแนนแบบทดสอบตามเวลา')}</h3>
${scoreSvg(k)}
${k.progress.length ? `<ul class="tight">${k.progress.slice(-10).map((p) => `<li>${esc(p.lesson_title)} — <b>${p.score}/${p.total}</b> (${pct(p)}%) <span class="muted">${fmtD(p.completed_at)}</span></li>`).join('')}</ul>` : ''}
<h3>${t('knowledge.report.txsTitle', 'รายรับ-รายจ่าย (7 วัน)')}</h3>
${txs(k)}
<h3>${t('knowledge.report.chores', 'งานบ้าน')}</h3>
${k.chores.length ? `<ul class="tight">${k.chores.slice(0, 10).map((c) => `<li>${c.emoji || '📋'} ${esc(c.title)} — <b>${c.reward}฿</b> ${c.status === 'done' ? '<span style="color:#16a34a">${t("knowledge.home.done", "✓ เสร็จ")}</span>' : '<span style="color:#d97706">${t("knowledge.report.pending", "ค้าง")}</span>'}</li>`).join('')}</ul>` : `<p class="muted">${t('knowledge.report.noChores', 'ไม่มีงานบ้าน')}</p>`}
<h3>${t('knowledge.report.bills', 'บิล')}</h3>
${k.bills.length ? `<ul class="tight">${k.bills.slice(0, 10).map((b) => `<li>${b.emoji || '🧾'} ${esc(b.title)} — <b>${b.amount.toLocaleString()}฿</b> ${b.period === 'monthly' ? '<span class="muted">(${t("knowledge.home.monthly", "รายเดือน")})</span> ' : ''}${b.status === 'paid' ? '<span style="color:#16a34a">${t("knowledge.home.paid", "✓ จ่ายแล้ว")}</span>' : '<span style="color:#dc2626">${t("knowledge.report.billUnpaid", "ยังไม่จ่าย")}</span>'}</li>`).join('')}</ul>` : `<p class="muted">${t('knowledge.report.noBills', 'ไม่มีบิล')}</p>`}
</section>`;
  }).join('');

  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8"/>
<title>${t('knowledge.report.docTitle', 'รายงานความก้าวหน้าลูก รายสัปดาห์')}</title>
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
<h1>${t('knowledge.report.mainTitle', 'รายงานความก้าวหน้าของลูก (7 วัน)')}</h1>
<div class="meta">${t('knowledge.report.generatedAt', 'สร้างเมื่อ {date}', { date: generatedAt ? new Date(generatedAt).toLocaleString(fmtLocale(), { dateStyle: 'long', timeStyle: 'short' }) : '' })} · Sovereign OS — ${t('knowledge.teach.title', 'AI สอนลูก')}</div>
${kidHtml}
</body>
</html>`;
}
