"use client";
// PosturePanel — ภาพรวมความปลอดภัยจาก 6 แหล่งจริงในฐานข้อมูล
//
// กติกาที่ห้ามละเมิด (SEC-041 / SEC-045):
//  · ทุกตัวเลขมาจาก GET /api/security/posture (อ่าน DB จริง) — ไม่มีค่าคงที่ในโค้ด
//  · แหล่งที่อ่านไม่ได้ต้องขึ้น "อ่านไม่ได้" + เหตุผล ไม่ใช่ 0 และไม่ใช่เขียว
//  · overall สรุปจาก state ของแต่ละแหล่ง (parsePosture) ไม่เชื่อตัวเลขที่เซิร์ฟเวอร์สรุปมา
//  · รายการ "ต้องจัดการ" ทุกใบอ้างตัวเลขจริง (ไม่มี = ไม่แสดง)
import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '../../lib/apiFetch';
import { fmtDate } from '../../lib/formatDate';
import { useLanguageStore } from '../../stores/useLanguageStore';
import StatusDot from '../ui/StatusDot';
import Icon from '../ui/Icon';
import {
  POSTURE_SOURCES,
  parsePosture,
  postureAttention,
  overallVariant,
  sourceVariant,
  type PostureSourceKey,
  type SecurityPosture,
} from '../../lib/security/posture';

type Translate = (path: string, fallback?: string, vars?: Record<string, string | number>) => string;

const SOURCE_FALLBACK: Record<PostureSourceKey, string> = {
  accounts: 'บัญชีผู้ใช้',
  bruteForce24h: 'บล็อก login 24 ชม.',
  securityEvents24h: 'เหตุการณ์ 24 ชม.',
  firewall: 'ไฟร์วอลล์',
  threatIntel: 'ฐานภัยคุกคาม',
  auditTrail: 'Audit trail',
};

const ATTENTION_FALLBACK: Record<string, string> = {
  sourceDown: 'อ่าน {source} ไม่ได้ — ตัวเลขส่วนนี้ไม่ถูกนับ',
  withoutMfa: 'บัญชี {n} บัญชี ยังไม่เปิด MFA',
  mustChangePassword: 'บัญชี {n} บัญชี ยังใช้รหัสชั่วคราว',
  criticalEvents: 'เหตุการณ์ระดับ critical {n} ครั้งใน 24 ชม.',
  bruteForce: 'บล็อกคำขอ login {n} ครั้งใน 24 ชม.',
  firewallDefaultAllow: 'นโยบายไฟร์วอลล์เริ่มต้นเป็น {policy} (ควรเป็น DENY)',
  firewallNoRules: 'ไม่มีกฎไฟร์วอลล์ที่เปิดใช้งาน (ทั้งหมด {total})',
  threatIntelEmpty: 'ฐานภัยคุกคามว่าง — ยังไม่มีข้อมูลให้เทียบ',
  auditEmpty: 'audit log ว่าง — ไม่มีหลักฐานให้ตรวจย้อน',
};

/** บรรทัดตัวเลขของแต่ละแหล่ง — ใช้เฉพาะ metrics ที่ parsePosture รับรองแล้ว */
function metricLine(key: PostureSourceKey, metrics: Record<string, any> | null, t: Translate): string {
  const unknown = t('security.posture.unknown', '—');
  const m = metrics ?? {};
  switch (key) {
    case 'accounts':
      return t('security.posture.metric.accounts', 'บัญชี {total} · ไม่เปิด MFA {withoutMfa} · รหัสชั่วคราว {mustChangePassword}', {
        total: m.total ?? 0,
        withoutMfa: m.withoutMfa ?? 0,
        mustChangePassword: m.mustChangePassword ?? 0,
      });
    case 'bruteForce24h':
      return t('security.posture.metric.bruteForce24h', 'บล็อก {blocks} ครั้ง', { blocks: m.blocks ?? 0 });
    case 'securityEvents24h':
      return t('security.posture.metric.securityEvents24h', 'critical {critical} · warning {warning} · รวม {total}', {
        critical: m.critical ?? 0,
        warning: m.warning ?? 0,
        total: m.total ?? 0,
      });
    case 'firewall':
      return t('security.posture.metric.firewall', 'กฎเปิด {rulesEnabled}/{rulesTotal} · นโยบายเริ่มต้น {defaultPolicy}', {
        rulesEnabled: m.rulesEnabled ?? 0,
        rulesTotal: m.rulesTotal ?? 0,
        defaultPolicy: m.defaultPolicy ?? unknown,
      });
    case 'threatIntel':
      return t('security.posture.metric.threatIntel', 'ใช้งาน {active} รายการ · อัปเดต {lastUpdated}', {
        active: m.active ?? 0,
        lastUpdated: m.lastUpdated ? fmtDate(m.lastUpdated) : unknown,
      });
    case 'auditTrail':
      return t('security.posture.metric.auditTrail', 'บันทึก {entries} รายการ', { entries: m.entries ?? 0 });
    default:
      return unknown;
  }
}

export default function PosturePanel() {
  const t = useLanguageStore((s) => s.t) as Translate;
  const [posture, setPosture] = useState<SecurityPosture | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`${process.env.NEXT_PUBLIC_API_URL}/api/security/posture`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = parsePosture(await res.json());
      if (!parsed) throw new Error(t('security.posture.loadFailed', 'อ่านภาพรวมความปลอดภัยไม่ได้'));
      setPosture(parsed);
    } catch (err) {
      // แสดง "อ่านไม่ได้" — ห้ามคงตัวเลขรอบก่อนไว้ให้เข้าใจว่ายังปกติ
      setPosture(null);
      setError(String((err as Error)?.message || t('security.posture.loadFailed', 'อ่านภาพรวมความปลอดภัยไม่ได้')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const attention = posture ? postureAttention(posture) : [];

  return (
    <div className="card panel-cyan p-4 space-y-3" data-testid="security-posture">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-semibold text-gray-200 glow-text flex items-center gap-2">
            <Icon name="shield" size={14} className="text-cyan-300" />
            {t('security.posture.title', 'Security Posture — ภาพรวมจากของจริง')}
          </h2>
          <p className="text-[10px] text-gray-500 mt-0.5">
            {t('security.posture.subtitle', 'รวม 6 แหล่งข้อมูลจากฐานข้อมูล · แหล่งที่อ่านไม่ได้จะไม่ถูกนับว่าปกติ')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {posture && (
            <StatusDot
              variant={overallVariant(posture.overall)}
              label={t(`security.posture.overall.${posture.overall}`, posture.overall)}
              pulse={posture.overall !== 'ok'}
            />
          )}
          <button onClick={() => void load()} disabled={loading} className="btn-secondary text-xs" title={t('security.posture.refresh', 'ตรวจใหม่')}>
            <Icon name="refresh" size={12} />
            {loading ? t('security.posture.refreshing', 'กำลังตรวจ...') : t('security.posture.refresh', 'ตรวจใหม่')}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-700 bg-rose-950/30 p-3 space-y-1">
          <div className="flex items-center gap-2 text-xs text-rose-300 font-semibold">
            <Icon name="bell" size={13} />
            {t('security.posture.loadFailed', 'อ่านภาพรวมความปลอดภัยไม่ได้')}
          </div>
          <div className="text-[10px] text-rose-200/80 break-all">{error}</div>
          <button onClick={() => void load()} className="text-[11px] underline text-rose-300 hover:text-rose-200">
            {t('security.posture.retry', 'ลองใหม่')}
          </button>
        </div>
      )}

      {loading && !posture && !error && (
        <div className="animate-pulse space-y-2" aria-busy="true">
          <div className="h-3 w-40 rounded bg-gray-700/60" />
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
            {POSTURE_SOURCES.map((k) => (
              <div key={k} className="h-16 rounded-lg bg-gray-800/60" />
            ))}
          </div>
          <p className="text-[10px] text-gray-500">{t('security.posture.loading', 'กำลังอ่านสถานะความปลอดภัย...')}</p>
        </div>
      )}

      {posture && (
        <>
          <div className="flex items-center justify-between flex-wrap gap-2 text-[10px] text-gray-500">
            <span>{t('security.posture.checkedAt', 'ตรวจล่าสุด {time}', { time: fmtDate(posture.checkedAt) })}</span>
            <span>{t('security.posture.counts', 'อ่านได้ {available}/{total}', { available: posture.available, total: POSTURE_SOURCES.length })}</span>
          </div>

          {posture.overall !== 'ok' && (
            <div
              className={`rounded-lg border p-2 text-[11px] ${
                posture.overall === 'degraded'
                  ? 'border-amber-700 bg-amber-950/30 text-amber-300'
                  : 'border-rose-700 bg-rose-950/30 text-rose-300'
              }`}
            >
              {posture.overall === 'degraded'
                ? t('security.posture.degradedHint', 'บางแหล่งอ่านไม่ได้ — ตัวเลขที่เห็นไม่ครบ ห้ามตีความว่าปกติ')
                : t('security.posture.unavailableHint', 'ไม่มีแหล่งไหนอ่านได้เลย — ภาพรวมนี้ยังไม่ยืนยันอะไรได้')}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
            {POSTURE_SOURCES.map((key) => {
              const src = posture.sources[key];
              const name = t(`security.posture.source.${key}`, SOURCE_FALLBACK[key]);
              return (
                <div key={key} className="rounded-lg border border-gray-700/70 bg-gray-900/40 p-3 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-gray-300">{name}</span>
                    <StatusDot
                      size="sm"
                      variant={sourceVariant(src.state)}
                      label={
                        src.state === 'ok'
                          ? t('security.posture.sourceOk', 'อ่านได้')
                          : t('security.posture.unavailableLabel', 'อ่านไม่ได้')
                      }
                    />
                  </div>
                  {src.state === 'unavailable' ? (
                    <div className="text-[10px] text-rose-300/90 space-y-0.5">
                      <div>{t('security.posture.reason', 'เหตุผล: {reason}', { reason: src.reason ?? '—' })}</div>
                      {src.code && <div className="text-gray-500">{t('security.posture.errorCode', 'รหัส: {code}', { code: src.code })}</div>}
                      {src.detail && <div className="text-gray-600 break-all">{src.detail}</div>}
                    </div>
                  ) : (
                    <div className="text-[11px] text-gray-400">{metricLine(key, src.metrics as Record<string, any> | null, t)}</div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="rounded-lg border border-gray-700/70 bg-gray-950/40 p-3 space-y-1.5">
            <div className="text-xs font-semibold text-gray-300">
              {t('security.posture.attentionTitle', 'ต้องจัดการ ({n})', { n: attention.length })}
            </div>
            {attention.length === 0 ? (
              <p className="text-[11px] text-emerald-300/90">{t('security.posture.attentionEmpty', 'ไม่พบสิ่งที่ต้องจัดการจากข้อมูลที่อ่านได้')}</p>
            ) : (
              <ul className="space-y-1">
                {attention.map((a) => {
                  const vars = a.vars ? { ...a.vars } : undefined;
                  if (vars && a.key === 'sourceDown') {
                    const raw = String(vars.source ?? '');
                    vars.source = t(`security.posture.source.${raw}`, SOURCE_FALLBACK[raw as PostureSourceKey] ?? raw);
                  }
                  const tone = a.severity === 'err' ? 'text-rose-300' : a.severity === 'warn' ? 'text-amber-300' : 'text-cyan-300';
                  return (
                    <li key={`${a.key}-${String(a.vars?.source ?? a.vars?.n ?? '')}`} className="flex items-start gap-2 text-[11px]">
                      <span className={`shrink-0 mt-0.5 ${tone}`}>
                        <Icon name={a.severity === 'err' ? 'bell' : a.severity === 'warn' ? 'alerts' : 'info'} size={12} />
                      </span>
                      <span className={tone}>
                        {t(`security.posture.attention.${a.key}`, ATTENTION_FALLBACK[a.key] ?? a.key, vars)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <p className="text-[10px] text-gray-600">
            {t('security.posture.footnote', 'ตัวเลขทั้งหมดอ่านจากฐานข้อมูลจริง · แหล่งที่อ่านไม่ได้จะแสดงเป็น "อ่านไม่ได้" ไม่ใช่ 0')}
          </p>
        </>
      )}
    </div>
  );
}
