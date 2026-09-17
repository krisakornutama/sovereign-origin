import { Router } from 'express';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { threatIntel } from '../../services/threat-intel.service';
import { piHole } from '../../services/pihole.service';
import { idsReader } from '../../services/ids-reader.service';
import { hashEngine } from '../../services/hash-engine.service';
import { appControl } from '../../services/app-control.service';
import { aiAnalyst } from '../../services/ai-analyst.service';
import { aiKillSwitch } from '../../services/ai-kill-switch.service';
import { securityStream } from '../../services/security-stream.service';
import { firstResponder } from '../../services/first-responder.service';
import { realityCheck } from '../../services/reality-check.service';
import { runChaosDrill, lastDrillReport } from '../../services/chaos-drill.service';
import { timeConsensus } from '../../services/time-consensus.service';
import { config } from '../../config';
import { warRoomSessionClosed, warRoomSessionOpened } from '../../services/war-room.service';
import { hardenUpload } from '../../lib/harden-upload';

const router = Router();
// harden: memory mode (ไม่ลงดิสก์) + whitelist .pdf/.txt/.md + จำกัด 25MB
// (เดิมไม่มี filter เลย — ตัวนี้ยิงเข้า hashEngine ตรง ๆ ซึ่งมี magic-byte sniff รองรับเอง)
const upload = hardenUpload({
  mode: 'memory',
  allowedExtensions: ['.pdf', '.txt', '.md', '.markdown'],
  maxSizeMB: 25,
});

// ═══ STATUS — เช็คทุกเครื่องมือในครั้งเดียว ═══
router.get('/status', authenticate, async (_req, res) => {
  const [piholeStatus, idsStats, avStatus, intelStats, aiLast] = await Promise.all([
    piHole.status().catch(() => ({ connected: false, error: 'pi-hole client error' })),
    idsReader.stats(),
    Promise.resolve(hashEngine.status()),
    threatIntel.stats(),
    aiAnalyst.last(),
  ]);
  // ntopng — แค่เช็คว่า reachable หรือไม่
  let ntopng = { configured: false, reachable: false, error: null as string | null };
  if (config.nextgen.ntopngUrl) {
    try {
      await axios.get(config.nextgen.ntopngUrl.replace(/\/+$/, '') + '/lua/rest', {
        timeout: config.nextgen.ntopngTimeoutMs,
        validateStatus: () => true,
      });
      ntopng = { configured: true, reachable: true, error: null };
    } catch {
      ntopng = { configured: true, reachable: false, error: 'เชื่อมต่อ ntopng ไม่ได้' };
    }
  }
  res.json({
    threatIntel: { total: intelStats.total, active: intelStats.active, domains: intelStats.byType?.DOMAIN || 0, ips: intelStats.byType?.IP || 0, totalHits: intelStats.totalHits, lastFeedRun: intelStats.lastFeedRun, lastFeedError: intelStats.lastFeedError },
    pihole: { connected: piholeStatus.connected, mode: piholeStatus.mode, error: piholeStatus.error, summary: piholeStatus.summary || null },
    ids: idsStats,
    clamav: avStatus,
    ntopng,
    appControl: { catalog: appControl.allApps().length, blockedApps: appControl.allApps().filter((a) => a.blocked).length, blockedDomains: appControl.blockedCount(), customDomains: appControl.customDomains.length },
    aiAnalyst: { enabled: config.nextgen.aiAnalystEnabled, connected: !!aiLast, lastRunAt: aiLast?.generatedAt || null, summary: aiLast?.summary?.slice(0, 200) || null, telegram: config.nextgen.aiAnalystTelegram },
  });
});

// ═══ 1. THREAT INTELLIGENCE ═══
router.get('/intel', authenticate, async (req, res) => {
  try {
    const { type, category, q, active, take } = req.query;
    const data = await threatIntel.list({
      type: type ? String(type) : undefined,
      category: category ? String(category) : undefined,
      q: q ? String(q) : undefined,
      active: active === 'all' ? undefined : active === 'true' ? true : active === 'false' ? false : undefined,
      take: take ? parseInt(String(take), 10) : 100,
    });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'intel list failed' });
  }
});

router.get('/intel/stats', authenticate, async (req, res) => {
  res.json(await threatIntel.stats());
});

router.post('/intel', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    const { type, value, category, note, source } = req.body || {};
    if (!type || !['IP', 'DOMAIN'].includes(type)) return res.status(400).json({ error: 'type ต้องเป็น IP หรือ DOMAIN' });
    const item = await threatIntel.add({ type, value, category, note, source });
    securityStream.push('INTEL_UPDATE', { action: 'add', item });
    res.status(201).json(item);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'add failed' });
  }
});

router.put('/intel/:id/toggle', authenticate, requireRole('SUPERADMIN', 'NODE_ADMIN'), async (req, res) => {
  try {
    const item = await threatIntel.setActive(req.params.id, req.body?.active !== false);
    res.json(item);
  } catch {
    res.status(500).json({ error: 'toggle failed' });
  }
});

router.delete('/intel/:id', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    await threatIntel.remove(req.params.id);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'delete failed' });
  }
});

router.post('/intel/update-feeds', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  const result = await threatIntel.updateFromFeeds();
  res.json(result);
});

router.post('/intel/check', authenticate, async (req, res) => {
  const { domains = [], ips = [] } = req.body || {};
  const [matchedDomains, matchedIps] = await Promise.all([
    threatIntel.matchDomains(Array.isArray(domains) ? domains : []),
    threatIntel.matchIps(Array.isArray(ips) ? ips : []),
  ]);
  res.json({ matchedDomains, matchedIps, total: matchedDomains.length + matchedIps.length });
});

// ═══ 2. PI-HOLE (DNS Filter) ═══
router.get('/dns/stats', authenticate, async (req, res) => {
  const status = await piHole.status().catch(() => ({ connected: false, error: 'error' }));
  res.json(status);
});

router.get('/dns/top-blocked', authenticate, async (req, res) => {
  const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 10;
  res.json(await piHole.topBlocked(limit));
});

router.get('/dns/clients', authenticate, async (req, res) => {
  res.json(await piHole.topClients(15));
});

router.get('/dns/queries', authenticate, async (req, res) => {
  const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 30;
  res.json(await piHole.recentQueries(limit));
});

// block: ไป Pi-hole blacklist + ลง Threat DB ด้วย
router.post('/dns/block', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  const domain = String(req.body?.domain || '').trim().toLowerCase();
  if (!domain || !domain.includes('.')) return res.status(400).json({ error: 'โดเมนไม่ถูกต้อง' });
  const dns = await piHole.addBlacklist(domain);
  let intelItem = null as any;
  try {
    intelItem = await threatIntel.add({ type: 'DOMAIN', value: domain, source: 'manual', note: 'block จาก Next-Gen UI' });
  } catch {}
  res.json({ ok: dns.ok, dnsError: dns.error, intel: intelItem });
  if (dns.ok) securityStream.push('DNS_BLOCK', { domain, intel: intelItem });
});

router.post('/dns/allow', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  const domain = String(req.body?.domain || '').trim().toLowerCase();
  if (!domain) return res.status(400).json({ error: 'โดเมนไม่ถูกต้อง' });
  const dns = await piHole.removeBlacklist(domain);
  res.json({ ok: dns.ok, error: dns.error });
  if (dns.ok) securityStream.push('DNS_ALLOW', { domain });
});

// ═══ 3. IDS (Suricata) ═══
router.get('/ids/alerts', authenticate, async (req, res) => {
  const take = req.query.take ? parseInt(String(req.query.take), 10) : 40;
  res.json({ alerts: await idsReader.recentAlerts(take), stats: await idsReader.stats() });
});

// ═══ 4. LITE AV (SHA-256 Checksum Engine — แทน ClamAV daemon) ═══
router.get('/av/status', authenticate, async (_req, res) => {
  res.json(hashEngine.status());
});

router.post('/av/scan', authenticate, requireRole('SUPERADMIN'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'ไม่พบไฟล์ (multipart field: file)' });
  const result = await hashEngine.scanBuffer(req.file.buffer, { originalName: req.file.originalname });
  res.json({ fileName: req.file.originalname, ...result });
});

// ═══ 5. APP CONTROL (DPI/Application Blocking) ═══
router.get('/apps', authenticate, async (req, res) => {
  res.json({ apps: appControl.allApps(), customDomains: appControl.customDomains, blockedCount: appControl.blockedCount() });
});

router.put('/apps/:id', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  const blocked = Boolean(req.body?.blocked);
  const ok = appControl.setBlocked(req.params.id, blocked);
  if (!ok) return res.status(404).json({ error: 'ไม่พบแอป' });
  securityStream.push('APP_CONTROL', { action: 'toggle', appId: req.params.id, blocked });
  res.json({ ok: true, blocked, blockedCount: appControl.blockedCount() });
});

router.put('/apps/category/:category', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  const blocked = Boolean(req.body?.blocked);
  const n = appControl.setCategoryBlocked(req.params.category, blocked);
  res.json({ ok: true, count: n, blockedCount: appControl.blockedCount() });
});

router.post('/apps/custom', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  const ok = appControl.addCustomDomain(String(req.body?.domain || ''));
  if (!ok) return res.status(400).json({ error: 'โดเมนซ้ำ/ไม่ถูกต้อง' });
  res.json({ ok: true, customDomains: appControl.customDomains });
});

router.delete('/apps/custom', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  const ok = appControl.removeCustomDomain(String(req.body?.domain || ''));
  if (!ok) return res.status(404).json({ error: 'ไม่พบโดเมน' });
  res.json({ ok: true, customDomains: appControl.customDomains });
});

router.get('/apps/blocklist', authenticate, async (req, res) => {
  res.type('text/plain').send(appControl.toHostsFile());
});

// ส่ง blocklist ทั้งหมดเข้า Pi-hole blacklist แบบ batch
router.post('/apps/sync-pihole', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  const domains = appControl.blockedDomains();
  let okCount = 0;
  const errors: string[] = [];
  for (const d of domains) {
    const r = await piHole.addBlacklist(d);
    if (r.ok) okCount++;
    else errors.push(`${d}: ${r.error}`);
  }
  res.json({ okCount, total: domains.length, errors: errors.slice(0, 10) });
});

// ═══ 6. NETWORK VISIBILITY ═══
router.get('/network/devices', authenticate, async (req, res) => {
  const [clients, summary] = await Promise.all([
    piHole.topClients(15).catch(() => []),
    piHole.getSummary().catch(() => null),
  ]);
  res.json({ devices: clients, summary });
});

// ═══ 7. AI ANALYST ═══
router.get('/ai/last', authenticate, async (req, res) => {
  res.json({ report: await aiAnalyst.last(), error: aiAnalyst.lastError, lastRunAt: aiAnalyst.lastRunAt });
});

router.post('/ai/analyze', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  const report = await aiAnalyst.analyzeNow();
  securityStream.push('AI_ANALYSIS', {
    summary: report?.summary?.slice(0, 200) || null,
    stats: report?.stats || null,
  });
  res.json(report);
});

// ═══ 8. EMERGENCY KILL-SWITCH (AI Agent Global Override) ═══
router.get('/kill-switch', authenticate, async (_req, res) => {
  res.json(aiKillSwitch.status());
});

router.put('/kill-switch', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  const { active, reason } = req.body || {};
  const state = aiKillSwitch.set(
    Boolean(active),
    typeof reason === 'string' ? reason : '',
    (req as any).user?.username || req.user?.id || 'unknown'
  );
  res.json(state);
});

// ═══ 10. FIRST-RESPONDER MODE (SOS) ═══
router.get('/first-responder', authenticate, async (_req, res) => {
  res.json(firstResponder.status());
});

router.put('/first-responder', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  const { active, note } = req.body || {};
  const state = await firstResponder.set(Boolean(active), req.user?.id || 'unknown', typeof note === 'string' ? note : '');
  res.json(state);
});

// ═══ 11. REALITY-CHECK / PARANOIA INDEX ═══
router.get('/reality', authenticate, async (_req, res) => {
  res.json(await realityCheck.stats());
});

router.post('/reality/correct', authenticate, requireRole('SUPERADMIN', 'NODE_ADMIN', 'OPERATOR'), async (req, res) => {
  const { kind, note, source_type, source_event_id } = req.body || {};
  if (!kind || !['false_positive', 'false_negative', 'context'].includes(kind)) {
    return res.status(400).json({ error: 'kind ต้องเป็น false_positive / false_negative / context' });
  }
  const stats = await realityCheck.addCorrection(kind, String(note || ''), req.user?.id || 'unknown', {
    type: source_type ? String(source_type) : undefined,
    eventId: source_event_id ? String(source_event_id) : undefined,
  });
  res.status(201).json(stats);
});

// ═══ 12. CHAOS DRILL (ซ้อมรับวิกฤต) ═══
router.get('/drill', authenticate, async (_req, res) => {
  res.json({ report: lastDrillReport() });
});

router.post('/drill', authenticate, requireRole('SUPERADMIN'), async (_req, res) => {
  const report = await runChaosDrill();
  res.json(report);
});

// ═══ 12b. TIME-CONSENSUS (Phase 6 — Byzantine Time Drift & NTP Poisoning) ═══
router.get('/time-consensus', authenticate, async (_req, res) => {
  const status = timeConsensus.status();
  if (status.lastCheckAt === null) {
    const found = await timeConsensus.check();
    res.json({ ...timeConsensus.status(), justChecked: found });
    return;
  }
  res.json(status);
});

router.post('/time-consensus/check', authenticate, requireRole('SUPERADMIN'), async (_req, res) => {
  const found = await timeConsensus.check();
  res.json({ ...timeConsensus.status(), found });
});

// ═══ 9. REAL-TIME EVENT STREAM (SSE) ═══
// EventSource ไม่สามารถตั้ง header ได้ → รับ JWT ผ่าน query param `?token=...`
// ใช้ verify แบบเดียวกับ authenticate (ต้องผ่าน MFA ด้วย) — ห้าม log URL
// หมายเหตุ: ลงทะเบียนเป็น app.get ใน server.ts ก่อน featureGuard (header-auth
// ของ featureGuard จะ block HTTP request ที่ไม่มี Authorization header)
export async function securityEventsSse(req: any, res: any) {
  const token = String(req.query.token || '');
  if (!token) return res.status(401).json({ error: 'Missing token' });
  let user: { id: string; role: string; mfa_verified: boolean } | null = null;
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as any;
    if (!decoded.mfa_verified) return res.status(403).json({ error: 'MFA verification required' });
    user = { id: decoded.userId, role: decoded.role, mfa_verified: true };
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  warRoomSessionOpened(); // ข้อ 3: Security stream เปิด = War Room ตื่น

  const send = (name: string, payload: any) => {
    res.write(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`);
  };
  send('hello', { user: user.id, role: user.role, replay: securityStream.replay(), ts: Date.now() });

  const unsub = securityStream.subscribe((evt) => send(evt.type, evt));
  const heartbeat = setInterval(() => send('ping', { ts: Date.now() }), 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsub();
    warRoomSessionClosed();
  });
}

export default router;