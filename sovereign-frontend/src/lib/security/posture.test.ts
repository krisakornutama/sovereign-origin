// security posture (frontend) — "ภาพรวมความปลอดภัย" ต้องไม่เขียวเกินจริง
//
// เทสต์นี้คุม 3 เรื่อง:
// 1) parsePosture ต้องคำนวณ overall จาก state ของแต่ละแหล่งเอง (ไม่เชื่อตัวเลขที่เซิร์ฟเวอร์สรุปมา)
// 2) แหล่งที่ unavailable ต้องไม่มี metrics หรือเหตุผลว่างเปล่า และต้องกลายเป็นรายการ "ต้องจัดการ"
// 3) คีย์ i18n ต้องมีครบทั้ง th/en (คีย์ขาด = หน้าขึ้น fallback ไทยในโหมด EN)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  POSTURE_SOURCES,
  parsePosture,
  postureAttention,
  overallVariant,
  sourceVariant,
  type SecurityPosture,
} from './posture';
import thSecurity from '../../i18n/th/pages/security';
import enSecurity from '../../i18n/en/pages/security';

const ok = (metrics: Record<string, unknown>) => ({
  state: 'ok',
  reason: null,
  code: null,
  detail: null,
  metrics,
});
const down = (reason = 'อ่านข้อมูลจากฐานข้อมูลไม่ได้', code = 'P2010') => ({
  state: 'unavailable',
  reason,
  code,
  detail: 'connect ECONNREFUSED',
  metrics: null,
});

function payload(overrides: Record<string, unknown> = {}, top: Record<string, unknown> = {}) {
  return {
    checkedAt: '2026-11-18T03:04:05.000Z',
    overall: 'ok',
    available: 6,
    unavailable: 0,
    sources: {
      accounts: ok({ total: 4, withoutMfa: 2, mustChangePassword: 1 }),
      bruteForce24h: ok({ blocks: 3 }),
      securityEvents24h: ok({ critical: 0, warning: 2, total: 5 }),
      firewall: ok({ rulesEnabled: 7, rulesTotal: 8, defaultPolicy: 'DENY' }),
      threatIntel: ok({ active: 12, lastUpdated: '2026-11-16T00:00:00.000Z' }),
      auditTrail: ok({ entries: 42, oldest: '2025-01-01T00:00:00.000Z' }),
      ...overrides,
    },
    ...top,
  };
}

describe('parsePosture — ไม่เชื่อสรุปจากเซิร์ฟเวอร์', () => {
  test('payload ครบ: อ่านได้และคงตัวเลขจริงไว้', () => {
    const p = parsePosture(payload());
    assert.ok(p);
    assert.equal(p!.overall, 'ok');
    assert.equal(p!.sources.accounts.metrics?.withoutMfa, 2);
    assert.equal(p!.sources.firewall.metrics?.defaultPolicy, 'DENY');
    assert.equal(p!.checkedAt, '2026-11-18T03:04:05.000Z');
  });

  test('เซิร์ฟเวอร์บอก "ok" แต่มีแหล่งล้ม → ต้องเป็น degraded', () => {
    const p = parsePosture(payload({ firewall: down() }, { overall: 'ok', available: 6, unavailable: 0 }));
    assert.ok(p);
    assert.equal(p!.overall, 'degraded');
    assert.equal(p!.available, 5);
    assert.equal(p!.unavailable, 1);
  });

  test('ทุกแหล่งล้ม → unavailable (ไม่ใช่ ok)', () => {
    const all = Object.fromEntries(POSTURE_SOURCES.map((k) => [k, down()]));
    const p = parsePosture(payload(all, { overall: 'ok' }));
    assert.ok(p);
    assert.equal(p!.overall, 'unavailable');
    assert.equal(p!.unavailable, 6);
  });

  test('แหล่งที่ unavailable ต้อง metrics = null เสมอ (แม้ payload จะแถมมา)', () => {
    const p = parsePosture(payload({ threatIntel: { ...down(), metrics: { active: 99 } } }));
    assert.ok(p);
    assert.equal(p!.sources.threatIntel.metrics, null, 'ห้ามโชว์ตัวเลขจากแหล่งที่อ่านไม่ได้');
    assert.equal(p!.sources.threatIntel.reason, 'อ่านข้อมูลจากฐานข้อมูลไม่ได้');
  });

  test('payload ผิดรูป → null (ให้ UI ขึ้น "อ่านไม่ได้" ไม่ใช่เดาค่า)', () => {
    assert.equal(parsePosture(null), null);
    assert.equal(parsePosture({}), null);
    assert.equal(parsePosture({ sources: {} }), null);
    assert.equal(parsePosture(payload({ accounts: { state: 'weird', metrics: {} } })), null);
    assert.equal(parsePosture('<!DOCTYPE html>'), null);
  });
});

describe('postureAttention — ใช้ตัวเลขจริงเท่านั้น', () => {
  const clean = () =>
    parsePosture(
      payload({
        accounts: ok({ total: 4, withoutMfa: 0, mustChangePassword: 0 }),
        bruteForce24h: ok({ blocks: 0 }),
        securityEvents24h: ok({ critical: 0, warning: 0, total: 0 }),
        firewall: ok({ rulesEnabled: 2, rulesTotal: 2, defaultPolicy: 'DENY' }),
        threatIntel: ok({ active: 1, lastUpdated: null }),
        auditTrail: ok({ entries: 10, oldest: null }),
      })
    )!;

  test('ทุกอย่างเรียบร้อย = ไม่มีรายการ', () => {
    assert.deepEqual(postureAttention(clean()), []);
  });

  test('แหล่งล้มต้องขึ้นเป็นรายการระดับ err เสมอ', () => {
    const p = parsePosture(payload({ firewall: down() }))!;
    const items = postureAttention(p);
    const found = items.find((i) => i.key === 'sourceDown');
    assert.ok(found, 'ต้องมี sourceDown');
    assert.equal(found!.severity, 'err');
    assert.equal(found!.vars?.source, 'firewall');
  });

  test('บัญชีไม่มี MFA / รหัสชั่วคราว / critical event ต้องเตือน', () => {
    const p = parsePosture(payload({ securityEvents24h: ok({ critical: 2, warning: 0, total: 2 }) }))!;
    const keys = postureAttention(p).map((i) => i.key);
    assert.ok(keys.includes('withoutMfa'));
    assert.ok(keys.includes('mustChangePassword'));
    assert.ok(keys.includes('criticalEvents'));
  });

  test('audit ว่าง = err (ไม่เหลือหลักฐานให้ตรวจย้อน)', () => {
    const p = parsePosture(payload({ auditTrail: ok({ entries: 0, oldest: null }) }))!;
    const item = postureAttention(p).find((i) => i.key === 'auditEmpty');
    assert.ok(item);
    assert.equal(item!.severity, 'err');
  });

  test('variant ของ overall ต้องไม่เขียวเมื่อมีแหล่งล้ม', () => {
    assert.equal(overallVariant('ok'), 'ok');
    assert.equal(overallVariant('degraded'), 'warn');
    assert.equal(overallVariant('unavailable'), 'err');
    assert.equal(sourceVariant('ok'), 'ok');
    assert.equal(sourceVariant('unavailable'), 'err');
  });
});

describe('i18n — คีย์ posture ครบทั้งไทย/อังกฤษ', () => {
  const flatten = (obj: unknown, prefix = ''): string[] => {
    if (obj == null || typeof obj !== 'object') return [prefix];
    return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
      flatten(v, prefix ? `${prefix}.${k}` : k)
    );
  };

  test('ชุดคีย์เท่ากันทุกตัว', () => {
    const th = flatten((thSecurity as any).posture).sort();
    const en = flatten((enSecurity as any).posture).sort();
    assert.ok(th.length > 10, 'ต้องมีคีย์ posture จริง (ไม่ใช่ {} ว่าง)');
    assert.deepEqual(en, th, 'คีย์ EN ต้องตรงกับ TH');
  });

  test('ทุกคีย์มีข้อความจริง ไม่ปล่อยว่าง', () => {
    for (const [lang, dict] of [
      ['th', thSecurity as any],
      ['en', enSecurity as any],
    ] as const) {
      const walk = (obj: any, path: string) => {
        for (const [k, v] of Object.entries(obj ?? {})) {
          const p = `${path}.${k}`;
          if (typeof v === 'string') assert.ok(v.trim().length > 0, `${lang}: ${p} ว่าง`);
          else if (v && typeof v === 'object') walk(v, p);
          else assert.fail(`${lang}: ${p} ไม่ใช่ string/object`);
        }
      };
      walk(dict.posture, `${lang}.posture`);
    }
  });
});
