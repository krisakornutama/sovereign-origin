import { Router } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { HealthCategory, HealthFlagStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';

const router = Router();

// ─────────────────────────────────────────────────────────────
// Module 5: Herbal Safety & Action Engine
// เกณฑ์: อาการซ้ำ ≥ 3 ครั้ง ในรอบ 14 วัน → แนะนำสมุนไพรปรับสมดุล
// พร้อม Medical Contraindication Check (ห้ามขมิ้นชันในโรคไต/ท่อน้ำดี,
// ห้ามขิงเข้มข้นในผู้ใช้ยาละลายลิ่มเลือด …)
// ─────────────────────────────────────────────────────────────

const HERBAL_REMEDIES: Record<HealthCategory, { herb: string; herbId: string; note: string }> = {
  URINATION: {
    herb: 'กระเจี๊ยบแดง',
    herbId: 'hibiscus',
    note: 'ช่วยขับปัสสาวะและปรับสมดุลของเหลว เตือนให้ดื่มน้ำให้เพียงพอระหว่างวัน',
  },
  SLEEP: {
    herb: 'ดอกคำฝอย',
    herbId: 'safflower',
    note: 'ช่วยผ่อนคลายและส่งเสริมการนอนหลับ ควรดื่มก่อนนอน 1 ชั่วโมง',
  },
  APPETITE: {
    herb: 'ขิง',
    herbId: 'ginger',
    note: 'ช่วยเจริญอาหารและกระตุ้นการย่อยอาหาร ใช้ในปริมาณพอเหมาะ',
  },
  FATIGUE: {
    herb: 'บัวบก',
    herbId: 'gotu-kola',
    note: 'ช่วยฟื้นฟูความอ่อนเพลียและเพิ่มความสดชื่น ควรพักผ่อนให้เพียงพอร่วมด้วย',
  },
  FEVER: {
    herb: 'ฟ้าทะลายโจร',
    herbId: 'andrographis',
    note: 'ช่วยบรรเทาอาการไข้หวัด ใช้เฉพาะเมื่อมีอาการ และไม่ควรใช้ติดต่อกันเกิน 5 วัน',
  },
  DIGESTION: {
    herb: 'ขมิ้นชัน',
    herbId: 'turmeric',
    note: 'ช่วยลดท้องอืดและอาการไม่ย่อย ใช้ครั้งละเล็กน้อย',
  },
  MOOD: {
    herb: 'มะขามป้อม',
    herbId: 'amla',
    note: 'ช่วยปรับอารมณ์และลดความเครียด ควรหาเวลาพักผ่อนและพูดคุยกับคนใกล้ชิด',
  },
  OTHER: {
    herb: '—',
    herbId: 'none',
    note: 'ไม่มีคำแนะนำสมุนไพรสำหรับหมวดนี้อัตโนมัติ — ปรึกษาแพทย์/เภสัชกร',
  },
};

// รหัสข้อห้าม: ตรงกับรหัสใน health_profiles.conditions / medications
// kidney_disease = โรคไต, gallbladder = โรคท่อน้ำดี/ถุงน้ำดี,
// anticoagulant = ยาละลายลิ่มเลือด, pregnancy = ตั้งครรภ์, hypotension = ความดันต่ำ
const CONTRAINDICATIONS: Record<string, string[]> = {
  turmeric: ['kidney_disease', 'gallbladder', 'anticoagulant', 'pregnancy'],
  andrographis: ['pregnancy', 'hypotension'],
  ginger: ['anticoagulant', 'pregnancy'],
  hibiscus: ['hypotension', 'pregnancy'],
  safflower: ['anticoagulant', 'pregnancy'],
  'gotu-kola': ['pregnancy'],
};

const CONDITION_LABELS: Record<string, string> = {
  kidney_disease: 'โรคไต',
  gallbladder: 'โรคท่อน้ำดี/ถุงน้ำดี',
  anticoagulant: 'ใช้ยาละลายลิ่มเลือด',
  pregnancy: 'ตั้งครรภ์',
  hypotension: 'ความดันโลหิตต่ำ',
  diabetes: 'เบาหวาน',
  hypertension: 'ความดันโลหิตสูง',
};

const CATEGORY_LABELS: Record<HealthCategory, string> = {
  URINATION: 'ปัสสาวะผิดปกติ',
  SLEEP: 'การนอนหลับ',
  APPETITE: 'ความอยากอาหาร',
  FATIGUE: 'ความอ่อนเพลีย',
  FEVER: 'ไข้',
  DIGESTION: 'ระบบย่อยอาหาร',
  MOOD: 'อารมณ์/ความเครียด',
  OTHER: 'อื่น ๆ',
};

const VALID_CATEGORIES = Object.keys(CATEGORY_LABELS) as HealthCategory[];

function resolveOwnerId(req: any): string {
  if (req.user?.role === 'SUPERADMIN' && typeof req.query.userId === 'string' && req.query.userId.trim()) return req.query.userId.trim();
  return req.user?.id || '';
}

/** ตรวจข้อห้าม (contraindication) ระหว่างสมุนไพรกับประวัติผู้ใช้ */
function checkContraindications(
  herbId: string,
  profile: { conditions: string[]; medications: string[] }
): { blocked: boolean; reasons: string[] } {
  const forbidden = CONTRAINDICATIONS[herbId] || [];
  const reasons: string[] = [];
  for (const code of forbidden) {
    if (profile.conditions.includes(code) || profile.medications.includes(code)) {
      reasons.push(CONDITION_LABELS[code] || code);
    }
  }
  return { blocked: reasons.length > 0, reasons };
}

/** รวมการนับอาการรายหมวดใน 14 วัน + flag สถานะ — core ของ Stage 3 */
async function buildCategoryCounts(): Promise<
  Array<{
    category: HealthCategory;
    count: number;
    threshold: number;
    triggered: boolean;
    herb: string;
    herbId: string;
    blocked: boolean;
    reasons: string[];
    pendingFlag: boolean;
  }>
> {
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const [rows, profile, pendingFlags] = await Promise.all([
    prisma.healthObservation.groupBy({
      by: ['category'],
      where: { observed_at: { gte: since } },
      _count: { _all: true },
    }),
    prisma.healthProfile.findFirst(),
    prisma.healthFlag.findMany({ where: { status: HealthFlagStatus.PENDING } }),
  ]);

  const counts = new Map<HealthCategory, number>();
  for (const r of rows) counts.set(r.category, r._count._all);
  const profileData = {
    conditions: Array.isArray(profile?.conditions) ? (profile.conditions as string[]) : [],
    medications: Array.isArray(profile?.medications) ? (profile.medications as string[]) : [],
  };
  const flagCategories = new Set(pendingFlags.map((f) => f.category));

  return VALID_CATEGORIES.map((category) => {
    const count = counts.get(category) || 0;
    const triggered = count >= 3;
    const remedy = HERBAL_REMEDIES[category];
    const { blocked, reasons } = checkContraindications(remedy.herbId, profileData);
    return {
      category,
      count,
      threshold: 3,
      triggered,
      herb: remedy.herb,
      herbId: remedy.herbId,
      blocked,
      reasons,
      pendingFlag: flagCategories.has(category),
    };
  });
}

// ── Overview ──

// GET /api/health/overview
router.get('/overview', authenticate, async (req, res) => {
  try {
    const [counts, observations, flags, consents, profile] = await Promise.all([
      buildCategoryCounts(),
      prisma.healthObservation.findMany({ orderBy: { observed_at: 'desc' }, take: 20 }),
      prisma.healthFlag.findMany({ orderBy: { created_at: 'desc' }, take: 20 }),
      prisma.healthConsent.findMany(),
      prisma.healthProfile.findFirst(),
    ]);
    res.json({
      counts,
      observations,
      flags,
      consents,
      profile: profile ?? { conditions: [], medications: [] },
    });
  } catch (err) {
    console.error('Health overview error:', err);
    res.status(500).json({ error: 'Failed to load health overview' });
  }
});

// ── Module 2/4: Observations (Encrypted Health Log) ──

// POST /api/health/observations — บันทึกอาการ (จากบทสนทนา/เซ็นเซอร์/ผู้ใช้)
router.post('/observations', authenticate, async (req, res) => {
  try {
    const { category, detail, severity, source, observed_at } = req.body || {};
    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` });
    }
    const observation = await prisma.healthObservation.create({
      data: {
        category,
        detail: typeof detail === 'string' ? detail.slice(0, 500) : null,
        severity: Math.min(5, Math.max(1, Number(severity) || 1)),
        source: typeof source === 'string' && source.trim() ? source.trim().slice(0, 30) : 'manual',
        observed_at: observed_at ? new Date(observed_at) : new Date(),
      },
    });

    // Stage 3: อาการสะสม ≥ 3 ใน 14 วัน → สร้าง flag (ถ้ายังไม่มี pending สำหรับหมวดนี้)
    const counts = await buildCategoryCounts();
    const entry = counts.find((c) => c.category === category as HealthCategory);
    let flag = null;
    if (entry && entry.triggered && !entry.pendingFlag) {
      flag = await prisma.healthFlag.create({
        data: {
          flag_type: `CHECK_${category}`,
          category,
          note: `พบ ${CATEGORY_LABELS[category as HealthCategory]} ซ้ำ ${entry.count} ครั้งใน 14 วัน`,
        },
      });
    }

    res.status(201).json({ observation, flag, ...entry });
  } catch (err) {
    console.error('Record observation error:', err);
    res.status(500).json({ error: 'Failed to record observation' });
  }
});

// GET /api/health/observations?limit=&category=
router.get('/observations', authenticate, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
    const category = (req.query.category as string) || '';
    const where = VALID_CATEGORIES.includes(category as HealthCategory) ? { category: category as HealthCategory } : {};
    const rows = await prisma.healthObservation.findMany({ where, orderBy: { observed_at: 'desc' }, take: limit });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load observations' });
  }
});

// DELETE /api/health/observations/:id
router.delete('/observations/:id', authenticate, async (req, res) => {
  try {
    await prisma.healthObservation.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(404).json({ error: 'Observation not found' });
  }
});

// ── Stage 2/3: Flags (Micro-Triage) ──

// GET /api/health/flags
router.get('/flags', authenticate, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
    const status = (req.query.status as string) || '';
    const where =
      status === 'PENDING' || status === 'CLEARED' || status === 'ADDRESSED'
        ? { status: status as HealthFlagStatus }
        : {};
    const rows = await prisma.healthFlag.findMany({ where, orderBy: { created_at: 'desc' }, take: limit });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load flags' });
  }
});

// POST /api/health/flags — สร้าง flag ด้วยมือ (เช่น จาก AI Agent หลัง Stage 1)
router.post('/flags', authenticate, async (req, res) => {
  try {
    const { flag_type, category, note } = req.body || {};
    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: 'invalid category' });
    }
    const flag = await prisma.healthFlag.create({
      data: {
        flag_type: typeof flag_type === 'string' ? flag_type.slice(0, 50) : `CHECK_${category}`,
        category,
        note: typeof note === 'string' ? note.slice(0, 300) : null,
      },
    });
    res.status(201).json(flag);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create flag' });
  }
});

// POST /api/health/flags/:id/clear — ผู้ใช้ตอบรับ/ปฏิเสธ → ล้าง flag
router.post('/flags/:id/clear', authenticate, async (req, res) => {
  try {
    const flag = await prisma.healthFlag.update({
      where: { id: req.params.id },
      data: { status: HealthFlagStatus.CLEARED, cleared_at: new Date() },
    });
    res.json(flag);
  } catch (err) {
    res.status(404).json({ error: 'Flag not found' });
  }
});

// POST /api/health/flags/:id/address — ผู้ใช้ตอบรับว่าเป็นปัญหา → เปลี่ยนเป็น ADDRESSED
router.post('/flags/:id/address', authenticate, async (req, res) => {
  try {
    const flag = await prisma.healthFlag.update({
      where: { id: req.params.id },
      data: { status: HealthFlagStatus.ADDRESSED, cleared_at: new Date() },
    });
    res.json(flag);
  } catch (err) {
    res.status(404).json({ error: 'Flag not found' });
  }
});

// ── Module 3: Privacy Control (Category-based Consent) ──

// GET /api/health/consents
router.get('/consents', authenticate, async (req, res) => {
  try {
    let consents = await prisma.healthConsent.findMany();
    // default: ทุกหมวดอนุญาต — ถ้ายังไม่เคยตั้งค่าให้สร้างเริ่มต้น
    const DEFAULT_CATEGORIES = ['telemetry', 'conversation', 'export'];
    const existing = new Set(consents.map((c) => c.category));
    for (const category of DEFAULT_CATEGORIES) {
      if (!existing.has(category)) {
        consents.push(
          await prisma.healthConsent.create({ data: { category, granted: true } })
        );
      }
    }
    res.json(consents);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load consents' });
  }
});

// PUT /api/health/consents — { "telemetry": true, "conversation": false }
router.put('/consents', authenticate, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    const updates = req.body || {};
    const results = [];
    for (const [category, granted] of Object.entries(updates)) {
      if (typeof granted !== 'boolean') continue;
      if (userId) {
        results.push(
          await prisma.healthConsent.upsert({
            where: { user_id_category: { user_id: userId, category } },
            update: { granted },
            create: { user_id: userId, category, granted },
          })
        );
      } else {
        results.push(
          await prisma.healthConsent.upsert({
            where: { category } as any,
            update: { granted },
            create: { category, granted } as any,
          })
        );
      }
    }
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update consents' });
  }
});

// ── Health Profile (ข้อมูลสำหรับ contraindication check) ──

// GET /api/health/profile
router.get('/profile', authenticate, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    const where = userId ? { user_id: userId } : {};
    const profile = await prisma.healthProfile.findFirst({ where } as any);
    res.json(profile ?? { conditions: [], medications: [] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

// PUT /api/health/profile — { conditions: ["kidney_disease"], medications: ["anticoagulant"] }
router.put('/profile', authenticate, async (req, res) => {
  try {
    const userId = (req as any).user?.id as string | undefined;
    const { conditions, medications } = req.body || {};
    const data: any = {
      conditions: Array.isArray(conditions) ? conditions.slice(0, 50) : [],
      medications: Array.isArray(medications) ? medications.slice(0, 50) : [],
    };
    if (userId) data.user_id = userId;
    const where = userId ? { user_id: userId } : {};
    const existing = await prisma.healthProfile.findFirst({ where } as any);
    const profile = existing
      ? await prisma.healthProfile.update({ where: { id: existing.id }, data })
      : await prisma.healthProfile.create({ data });
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save profile' });
  }
});

// ── Module 5: Herbal Recommendation (พร้อม contraindication check) ──

// GET /api/health/herbal-recommendations
router.get('/herbal-recommendations', authenticate, async (req, res) => {
  try {
    const counts = await buildCategoryCounts();
    const recommendations = counts
      .filter((c) => c.triggered && c.herbId !== 'none')
      .map((c) => ({
        category: c.category,
        categoryLabel: CATEGORY_LABELS[c.category],
        count: c.count,
        threshold: c.threshold,
        herb: c.herb,
        herbId: c.herbId,
        note: HERBAL_REMEDIES[c.category].note,
        recommended: !c.blocked,
        blockedReasons: c.reasons,
        disclaimer:
          '⚠️ นี่คือคำแนะนำเบื้องต้นจากข้อมูลอาการสะสมเท่านั้น ไม่ใช่การวินิจฉัยโรค — ปรึกษาแพทย์หรือเภสัชกรก่อนใช้สมุนไพรทุกครั้ง โดยเฉพาะผู้ที่มีโรคประจำตัวหรือใช้ยาประจำ',
      }));
    res.json({ recommendations, generatedAt: new Date() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to build recommendations' });
  }
});

// ── Module 6: Clinical Export (30 วัน) — CSV หรือ HTML (print → PDF) ──

// GET /api/health/export?format=csv|html&days=30
router.get('/export', authenticate, async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days as string) || 30, 1), 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const [observations, counts] = await Promise.all([
      prisma.healthObservation.findMany({
        where: { observed_at: { gte: since } },
        orderBy: { observed_at: 'asc' },
      }),
      buildCategoryCounts(),
    ]);
    const format = (req.query.format as string) || 'html';

    if (format === 'csv') {
      const header = 'observed_at,category,severity,source,detail';
      const lines = observations.map((o) =>
        [
          new Date(o.observed_at).toISOString(),
          o.category,
          o.severity,
          `"${(o.source || '').replace(/"/g, '""')}"`,
          `"${(o.detail || '').replace(/"/g, '""')}"`,
        ].join(',')
      );
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="health-report-${days}d.csv"`);
      return res.send([header, ...lines].join('\n'));
    }

    const categoryRows = counts
      .filter((c) => c.count > 0)
      .map((c) => `<tr><td>${CATEGORY_LABELS[c.category]}</td><td>${c.count}</td><td>${c.triggered ? '⚠️ ถึงเกณฑ์' : 'ปกติ'}</td><td>${c.herb}${c.blocked ? ' (ห้ามใช้: ' + c.reasons.join(', ') + ')' : ''}</td></tr>`)
      .join('');
    const html = `<!DOCTYPE html>
<html lang="th">
<head><meta charset="utf-8"><title>รายงานสุขภาพ ${days} วัน</title>
<style>
  body{font-family:'Segoe UI',Tahoma,sans-serif;margin:32px;color:#111}
  h1{font-size:20px}h2{font-size:15px;margin-top:24px}
  table{border-collapse:collapse;width:100%;font-size:13px}
  th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}
  th{background:#f0f0f0}.muted{color:#555;font-size:12px}
</style></head>
<body>
  <h1>🏥 รายงานสุขภาพย้อนหลัง ${days} วัน</h1>
  <p class="muted">สร้างเมื่อ ${new Date().toLocaleString('th-TH')} · Sovereign OS Health Screening</p>
  <h2>สรุปอาการรายหมวด (เกณฑ์ ≥ 3 ครั้ง / 14 วัน)</h2>
  <table><tr><th>หมวด</th><th>ครั้ง</th><th>สถานะ</th><th>คำแนะนำสมุนไพร</th></tr>${categoryRows || '<tr><td colspan="4">ไม่มีข้อมูล</td></tr>'}</table>
  <h2>รายละเอียดอาการ (${observations.length} รายการ)</h2>
  <table><tr><th>เวลา</th><th>หมวด</th><th>ความรุนแรง</th><th>แหล่ง</th><th>รายละเอียด</th></tr>
  ${observations
    .map(
      (o) =>
        `<tr><td>${new Date(o.observed_at).toLocaleString('th-TH')}</td><td>${CATEGORY_LABELS[o.category]}</td><td>${o.severity}/5</td><td>${o.source}</td><td>${o.detail || ''}</td></tr>`
    )
    .join('')}
  </table>
  <p class="muted">⚠️ ข้อมูลนี้บันทึกในเครื่องเท่านั้น (Local-First) — ใช้ประกอบการปรึกษาแพทย์ ไม่ใช่การวินิจฉัย</p>
  <script>window.print();</script>
</body></html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="health-report-${days}d.html"`);
    res.send(html);
  } catch (err) {
    console.error('Health export error:', err);
    res.status(500).json({ error: 'Failed to export report' });
  }
});

export default router;
