import type { Express } from 'express';
import { join } from 'node:path';
import { readFile as readFileCb } from 'node:fs';
import { config } from './config';
import { getSelfFingerprint, getLoadedCodeDirLabel } from './lib/runtime-fingerprint';
import { buildOpsSummary } from './services/ops-summary.service';
import { prisma } from './lib/prisma';

// อ่านไฟล์ JSON แบบ "ไม่มีก็ได้" — ใช้กับ data/system-truth.json (ผลเกตล่าสุดที่ verify เขียน)
const readJsonIfExists = async (p: string): Promise<unknown | null> =>
  new Promise((resolve) => {
    readFileCb(p, 'utf8', (err, data) => {
      if (err) return resolve(null);
      try { resolve(JSON.parse(data)); } catch { resolve(null); }
    });
  });
import authRoutes from './modules/auth/auth.routes';
import nodeRoutes from './modules/nodes/node.routes';
import deviceRoutes from './modules/devices/device.routes';
import telemetryRoutes from './modules/telemetry/telemetry.routes';
import whisperRoutes from './modules/whisper/whisper.routes';
import visionRoutes from './modules/vision/vision.routes';
import ttsRoutes from './modules/tts/tts.routes';
import automationRoutes from './modules/automation/automation.routes';
import sensorRoutes from './modules/sensors/sensor.routes';
import sensorDataRoutes from './modules/sensors/sensor-data.routes';
import { securityEventsSse } from './modules/security/nextgen.routes';
import securityRoutes from './modules/security/security.routes';
import nextgenRoutes from './modules/security/nextgen.routes';
import aiRoutes from './modules/ai/ai.routes';
import aiChatRoutes from './modules/ai/ai-chat.routes';
import relayRoutes from './modules/relay/relay.routes';
import telegramRoutes from './modules/telegram/telegram.routes';
import timescaleRoutes from './modules/timescale/timescale.routes';
import reportRoutes from './modules/reports/reports.routes';
import backupRoutes from './modules/backup/backup.routes';
import meshRoutes from './modules/mesh/mesh.routes';
import energyRoutes from './modules/energy/energy.routes';
import otaRoutes from './modules/ota/ota.routes';
import searchRoutes from './modules/search/search.routes';
import knowledgeRoutes from './modules/knowledge/knowledge.routes';
import teachRoutes from './modules/knowledge/teach.routes';
import knowledgeFilesRoutes from './modules/knowledge/knowledge-files.routes';
import agentTeamRoutes from './modules/agent/agent.routes';
import visionRuleRoutes from './modules/vision/vision-rule.routes';
import portfolioRoutes from './modules/portfolio/portfolio.routes';
import treasuryRoutes from './modules/treasury/treasury.routes';
import selfrelianceRoutes from './modules/selfreliance/selfreliance.routes';
import dimeRoutes from './modules/dime/dime.routes';
import healingRoutes from './modules/healing/healing.routes';
import codingRoutes from './modules/coding/coding.routes';
import workspaceRoutes from './modules/coding/workspace.routes';
import skillsRoutes from './modules/coding/skills.routes';
import notesRoutes from './modules/notes/notes.routes';
import paymentsRoutes from './modules/payments/payments.routes';
import cloneRoutes from './modules/clone/clone.routes';
import riskRoutes from './modules/risk/risk.routes';
import predictiveRoutes from './modules/predictive/predictive.routes';
import healthRoutes from './modules/health/health.routes';
import healthReadingsRoutes from './modules/health/health-readings.routes';
import infrastructureRoutes from './modules/infrastructure/infrastructure.routes';
import { lifestyleRoutes } from './modules/lifestyle/lifestyle.routes';
import inventoryRoutes from './modules/inventory/inventory.routes';
import documentsRoutes from './modules/documents/documents.routes';
import farmRoutes from './modules/farm/farm.routes';
import cropRecommendRoutes from './modules/farm/crop-recommend.routes'; // I5b: /api/farm/crops/recommend (mount แยก — router หลักอยู่ที่ /plots)
import livestockRoutes from './modules/livestock/livestock.routes';
import compostRoutes from './modules/compost/compost.routes';
import wasteRoutes from './modules/waste/waste.routes';
import propertyRoutes from './modules/property/property.routes';
import restaurantRoutes from './modules/restaurant/restaurant.routes';
import govsimRoutes from './modules/govsim/govsim.routes';
import governorRoutes from './modules/governor/governor.routes';
import warRoomRoutes from './modules/war-room/war-room.routes';
import actuationRoutes from './modules/actuation/actuation.routes';
import dmsRoutes from './modules/dms/dms.routes';
import aiModelsRoutes from './modules/ai-models/ai-models.routes';
import featureRoutes from './modules/features/feature.routes';
import skillMatrixRoutes from './modules/skillmatrix/skillmatrix.routes';
import crisisRoutes from './modules/crisis/crisis.routes';
import dashboardRoutes from './modules/dashboard/dashboard.routes';
import learningRoutes from './modules/learning/learning.routes';
import usersRoutes from './modules/users/users.routes';
import auditRoutes from './modules/audit/audit.routes';
import systemRoutes, { livenessRouter } from './modules/system/system.routes';
import clientMonitorRoutes from './modules/system/client-monitor.routes';
import automationAlertsRoutes from './modules/automation/alerts.routes';
import businessRoutes from './modules/business/business.routes';
import businessShopRoutes from './modules/business/business-shop.routes';
import traceRoutes from './modules/trace/trace.routes';
import demoRoutes from './modules/demo/demo.routes';
import feedbackRoutes from './modules/feedback/feedback.routes';
import analyticsRoutes from './modules/analytics/analytics.routes';
import partnersRoutes from './modules/partners/partners.routes';
import softwareRoutes from './modules/software/software.routes';
import { featureGuard } from './services/feature-grant.service';

// ────────────────────────────────────────────────────────────────────────────
// mountRoutes — จุดรวมเสียบ route ทั้งหมด (ย้ายมาจาก server.ts)
// ลำดับมีความสำคัญ: Express จับ path ตามลำดับที่ mount — ห้ามสลับ
// (เช่น sensor.routes ต้องมาก่อน sensor-data.routes เพื่อให้ /devices จับก่อน /:metric,
//   และ GET /api/health ต้องมาก่อน mount health module กันโดน featureGuard ตี 401)
// ────────────────────────────────────────────────────────────────────────────
export function mountRoutes(app: Express): void {
  // ── สิทธิ์ฟังก์ชั่นต่อคน: แต่ละหน้า mount พร้อม featureGuard(featureKey) —
  // SUPERADMIN ผ่านเสมอ, สมาชิกต้องได้รับ grant ในตาราง user_feature_grants
  // (หน้า auth/devices/telemetry/sensors เป็นโครงสร้างพื้นฐาน — ใคร login แล้วใช้ได้)
  app.use('/api/auth', authRoutes);
  app.use('/api/shop', businessShopRoutes); // PUBLIC SHOP — หน้าร้านสาธารณะ (rate limit ใน router — ต้องมาก่อน /api/business)
  app.use('/api/trace', traceRoutes); // TRACEABILITY — ตามรอยล็อตผลผลิต (public ตามรหัส + login จัดการล็อต)
  app.use('/api/demo', demoRoutes); // PUBLIC DEMO SANDBOX — สนามทดลองสาธารณะ (ข้อมูลเดโม่คงตัว — ไม่แตะ DB จริง)
  app.use('/api/feedback', feedbackRoutes); // PUBLIC FEEDBACK — ปุ่มฟีดแบ็ก (POST สาธารณะ · admin จัดการ)
  app.use('/api', analyticsRoutes); // VISITOR TRACKING (P10) — POST /api/track สาธารณะ · GET /api/analytics/summary admin
  app.use('/api/partners', partnersRoutes); // PARTNER NETWORK (P16) — POST สมัครสาธารณะ · GET แผนที่ ACTIVE · admin อนุมัติ
  app.use('/api/software', softwareRoutes); // SOFTWARE CATALOG — ขายซอฟต์แวร์แยกชิ้น (admin: scan/publish/unpublish)
  app.use('/api/business', businessRoutes); // BUSINESS PLATFORM — ธุรกิจขายสินค้า IoT (สิทธิ์ต่อธุรกิจใน router)
  app.use('/api/nodes', nodeRoutes);
  app.use('/api/devices', deviceRoutes);
  app.use('/api/telemetry', telemetryRoutes);
  app.use('/api/whisper', whisperRoutes);
  if (config.modules.isEnabled('vision')) {
    app.use('/api/vision', visionRoutes); // P3 Vision AI
  }
  app.use('/api/tts', ttsRoutes);
  app.use('/api/automation', featureGuard('/automation'), automationRoutes);
  app.use('/api/sensors', sensorRoutes);
  // SSE ต้องอยู่ก่อน mount /api/security ทั้งคู่ (featureGuard=header-auth จะ block request ที่ไม่มี Bearer header)
  app.get('/api/security/nextgen/events', securityEventsSse);
  app.use('/api/security', featureGuard('/security'), securityRoutes);
  app.use('/api/security/nextgen', featureGuard('/security'), nextgenRoutes); // Next-Gen Security: Threat Intel / Pi-hole / IDS / ClamAV / App Control / AI Analyst
  app.use('/api/ai', featureGuard('/ai'), aiRoutes); // agent policy + approvals (blockIP/unblockIP/killProcess)
  app.use('/api/relay', featureGuard('/relay'), relayRoutes);
  app.use('/api/telegram', telegramRoutes);
  app.use('/api/timescale', timescaleRoutes);
  app.use('/api/reports', featureGuard('/reports'), reportRoutes);
  app.use('/api/backup', featureGuard('/backup'), backupRoutes);
  app.use('/api/mesh', featureGuard('/backup'), meshRoutes); // Mesh Lite — สำรองนอกสถานที่แบบเข้ารหัส
  app.use('/api/energy', featureGuard('/energy'), energyRoutes);
  app.use('/api/ota', featureGuard('/ota'), otaRoutes);
  app.use('/api/knowledge', featureGuard('/knowledge'), searchRoutes); // semantic search + index (POST /search, POST /index)
  app.use('/api/knowledge', featureGuard('/knowledge'), knowledgeRoutes); // Knowledge Base 2.0 — items / import / upload
  app.use('/api/knowledge', featureGuard('/knowledge'), teachRoutes); // AI สอนลูก — POST /teach/generate, POST /teach/save
  app.use('/api/agent', featureGuard('/ai-agent'), agentTeamRoutes); // Agentic AI team — บทบาท + งานเบื้องหลัง
  app.use('/api/vision', featureGuard('/vision'), visionRuleRoutes); // Vision AI คนแปลกหน้า
  app.use('/api/portfolio', featureGuard('/portfolio'), portfolioRoutes); // Phase 4: Wealth & Asset Tracker
  app.use('/api/treasury', featureGuard(['/treasury', '/portfolio']), treasuryRoutes); // LIFE & FINANCE: Treasury & Wealth Engine (Net Worth / Runway / 5 Families)
  app.use('/api/selfreliance', selfrelianceRoutes); // วันรอด (Days of Autonomy) — น้ำ/อาหาร/ไฟ/เงิน + จุดอ่อนบ้าน
  app.use('/api/skill-matrix', skillMatrixRoutes); // S5: Skills Matrix — คน×ทักษะ 1-5 + summary
  app.use('/api/crisis', crisisRoutes); // S6: Crisis Playbooks — flood / blackout / security (one active at a time)
  app.use('/api/learning', learningRoutes); // Self-Learning Data Lake + Engine — A/B/C/D ทั้งหมดเรียนรู้ต่อจากอดีต
    app.use('/api/dime', featureGuard(['/treasury', '/portfolio']), dimeRoutes); // Dime! Statement — IMAP + PDF → อัปเดตพอร์ตอัตโนมัติ
  app.use('/api/healing', featureGuard('/healing'), healingRoutes); // Sovereign Buddhist Healing Module
  app.use('/api/coding', featureGuard('/ai-agent'), codingRoutes); // Coding Agent
  app.use('/api/coding', featureGuard('/ai-agent'), workspaceRoutes); // Coding Agent — workspace (ตำแหน่งโปรเจ็ก/ไฟล์/เทอร์มินัล)
  app.use('/api/coding', featureGuard('/ai-agent'), skillsRoutes); // Coding Agent — skill queue (คิวทักษะ + ระดับอัตโนมัติ)
  app.use('/api/notes', featureGuard('/ai-agent'), notesRoutes); // Note — ปุ่มโน้ต
  app.use('/api/payments', paymentsRoutes); // PAYMENTS — Checkout Session (THB) · transport เป็นของปลอมจนกว่าจะเปิด STRIPE_LIVE_ENABLED
  app.use('/api/clone', featureGuard('/settings'), cloneRoutes); // Export & Clone
  app.use('/api/risk-monitor', featureGuard('/risk-monitor'), riskRoutes);
  app.use('/api/predictive', featureGuard('/predictive'), predictiveRoutes); // Phase 4: Risk Monitor + DEFCON  // Health check — Public (ไม่ต้อง auth) — frontend hook ใช้ poll endpoint นี้
  // (ต้องอยู่ก่อน mount health module: featureGuard+authenticate จะ 401 ทุก request ที่ไม่มี token)
  // สัญญาเดิมคงไว้: { status:'ok' } — เพิ่ม build fingerprint + db migrationHead (ความจริงว่า
  // "prod รันโค้ดชุดไหน" ใช้โดย tools/prod-truth.mjs) · fingerprint แคช background ไม่ชาร์จทุก poll
  let healthExtras: Promise<object> | null = null;
  const healthExtrasLazy = () => {
    if (!healthExtras) {
      healthExtras = (async () => {
        const [fp, migrationHead] = await Promise.all([
          getSelfFingerprint(),
          prisma
            .$queryRawUnsafe<Array<{ migration_name: string }>>(
              'SELECT migration_name FROM "_prisma_migrations" ORDER BY migration_name DESC LIMIT 1'
            )
            .catch(() => null as Array<{ migration_name: string }> | null),
        ]);
        return {
          build: { fingerprint: fp.fingerprint, files: fp.files, loadedDir: getLoadedCodeDirLabel() },
          db: { migrationHead: migrationHead?.[0]?.migration_name ?? null },
        };
      })();
      // ล้ม = รีเซ็ตให้ลองใหม่ request ถัดไป (เช่น DB ยังบูตไม่เสร็จ)
      healthExtras.catch(() => { healthExtras = null; });
    }
    return healthExtras;
  };
  app.get('/api/health', async (_req, res) => {
    try {
      const extras = await healthExtrasLazy();
      res.json({ status: 'ok', ...extras });
    } catch {
      res.json({ status: 'ok' }); // enrich ล้ม = ยอมรับเฉย ๆ — สัญญา status:'ok' ต้องไม่พัง
    }
  });

  // ── GET /api/health/truth — ความจริง runtime ฉบับเดียวสำหรับหน้า /system-health ──
  // รวม 3 แหล่ง: (1) fingerprint ของ dist ที่โปรเซสนี้โหลดจริง (2) migration head จริงจาก DB
  // (3) data/system-truth.json = ผลเกต (arch-gate 4 กฎ + prod-truth) ล่าสุดที่ verify เขียนไว้
  // Public เหมือน /api/health (ไม่มี token ก็ดูสุขภาพความจริงได้) — ไม่เปิดเผยความลับใด ๆ
  app.get('/api/health/truth', async (_req, res) => {
    try {
      const [fp, migrationHead, gateRaw, nightlyHist] = await Promise.all([
        getSelfFingerprint(),
        prisma
          .$queryRawUnsafe<Array<{ migration_name: string }>>(
            'SELECT migration_name FROM "_prisma_migrations" ORDER BY migration_name DESC LIMIT 1'
          )
          .catch(() => null as Array<{ migration_name: string }> | null),
      readJsonIfExists(join(process.cwd(), 'data', 'system-truth.json')).catch(() => null),
      readJsonIfExists(join(process.cwd(), 'data', 'nightly-history.json')).catch(() => null),
      ]);
      const ops = await buildOpsSummary().catch(() => null);
      const gate = gateRaw as {
        writtenAt?: string; steps?: Array<{ name?: string; ok?: boolean; skipped?: boolean }>;
        prodTruth?: { ok?: boolean; diskFingerprint?: string; diskFiles?: number; diskDir?: string };
      } | null;
      const runtimeFp = fp.fingerprint;
      const diskFp = gate?.prodTruth?.diskFingerprint ?? null;
      const gateSteps = (gate?.steps ?? []).map((s) => ({ name: s.name ?? '?', ok: !!s.ok, skipped: !!s.skipped }));
      res.json({
        runtime: { fingerprint: runtimeFp, files: fp.files, loadedDir: getLoadedCodeDirLabel() },
        db: { migrationHead: migrationHead?.[0]?.migration_name ?? null },
        lastGateRun: gate
          ? { writtenAt: gate.writtenAt ?? null, ok: gateSteps.length > 0 && gateSteps.every((s) => s.ok || s.skipped), steps: gateSteps }
          : null,
        disk: gate?.prodTruth ? { fingerprint: diskFp, files: gate.prodTruth.diskFiles ?? null, dir: gate.prodTruth.diskDir ?? null } : null,
        codeMatch: diskFp ? diskFp === runtimeFp : null, // null = ยังไม่มีข้อมูลเทียบ (verify ยังไม่เคยรันบนเครื่องนี้)
        // Phase 4: แนวโน้มผล verify ย้อน 30 วันจาก nightly (ok/duration/machine — ตามวันที่)
        nightlyHistory: Array.isArray(nightlyHist) ? (nightlyHist as Array<Record<string, unknown>>) : null,
        // สะพาน ops (P0 ใช้งานง่าย 27/9): อายุ backup สด + ผล task/nightly จาก snapshot ฝั่ง host
        ops,
      });
    } catch {
      res.status(503).json({ error: 'truth unavailable' });
    }
  });
  app.use('/api/health', featureGuard('/health'), healthRoutes); // Phase 5: Health Screening
  app.use('/api/health/readings', featureGuard('/health'), healthReadingsRoutes); // P6: Health Reading Tracker + AI trend
  app.use('/api/infrastructure', featureGuard('/infrastructure'), infrastructureRoutes); // Phase 5: Off-Grid Infrastructure Hub
  app.use('/api/lifestyle', featureGuard('/lifestyle'), lifestyleRoutes); // Phase 5: Embracing Chaos — จังหวะธรรมชาติ / Living Mode / Manual Day / Maintenance Radar

  // ── Feature Modules (ENABLED_MODULES) ──
  // เปิด-ปิดกลุ่ม API ระดับโมดูลผ่าน infra/.env — ปิดแล้ว route ไม่ถูก mount (404)
  if (config.modules.isEnabled('inventory')) {
    app.use('/api/inventory', featureGuard('/inventory'), inventoryRoutes); // Water & Food Inventory + วันหมดอายุ
    app.use('/api/inventory', featureGuard('/inventory'), wasteRoutes); // S4: ขยะร้าน → ปุ๋ยหมัก — move-to-waste
  }
  // S4: Compost loop — ขยะร้าน → ปุ๋ยหมัก → แปลงเกษตร
  app.use('/api/compost', featureGuard('/farm'), compostRoutes);
  if (config.modules.isEnabled('documents')) {
    app.use('/api/documents', featureGuard('/inventory'), documentsRoutes); // P5 Document Understanding
  }
  if (config.modules.isEnabled('farm')) {
    app.use('/api/farm/plots', featureGuard('/farm'), farmRoutes); // Farm Plot Manager
    app.use('/api/farm/crops', featureGuard('/farm'), cropRecommendRoutes); // I5b: Crop Recommendation API
  app.use('/api/livestock', featureGuard('/livestock'), livestockRoutes); // Sovereign Livestock Engine
  }
  app.use('/api/property', featureGuard('/property'), propertyRoutes); // แผนที่ที่ดิน 3 มิติ + จุดยุทธศาสตร์
  if (config.modules.isEnabled('restaurant')) {
    app.use('/api/restaurant', featureGuard('/restaurant'), restaurantRoutes); // จักรวรรดิร้านอาหาร — Farm→Inventory→Menu→Order
  }
  app.use('/api/govsim', govsimRoutes); // Governance & Socio-Political Simulation (War Room)
  app.use('/api/governor', governorRoutes); // Governor AI — คุมเมืองอัตโนมัติ + มนุษย์ approve เรื่องใหญ่
  app.use('/api/war-room', warRoomRoutes); // War Room Activity Gate — ข้อ 3: simulation หลับ-ตื่น
  app.use('/api/actuation', actuationRoutes); // Phase 7: Closed-Loop Actuation Sandbox — Safety Envelope + Mapper + Verifier
  app.use('/api/v1/dms', dmsRoutes); // Series 🔴: External Dead-Man Switch — ping (HMAC-only, ไม่มี featureGuard) + status
  app.use('/api/v1/ai', aiModelsRoutes); // AI Model Manager — Ollama Control System (auth+SUPERADMIN ใน router)

  // ── สิทธิ์ฟังก์ชั่นต่อคน: API ตั้งสิทธิ์ (catalog / me / users/:id) ──
  app.use('/api/features', featureRoutes);

  // ── เดิมเป็น inline routes ใน server.ts — แยกเป็น module แล้ว (mount ต่อท้ายตามลำดับเดิม) ──
  app.use('/api', dashboardRoutes); // GET /api/modules + /api/dashboard/stats
  app.use('/api/sensors', sensorDataRoutes); // /data /metrics /all DELETE /:metric — หลัง sensor.routes เสมอ
  app.use('/api/ai', aiChatRoutes); // POST /chat — หลัง ai.routes เสมอ
  app.use('/api/users', usersRoutes); // จัดการ user (SUPERADMIN)
  app.use('/api/audit', auditRoutes); // ดู audit log (SUPERADMIN)
  app.use('/api/knowledge', knowledgeFilesRoutes); // ไฟล์ .txt/.md — หลัง search/knowledge/teach เสมอ
  app.use(livenessRouter); // GET /healthz (Docker healthcheck + watchdog — ไม่มี auth)
  app.use('/api/system', systemRoutes); // /health /processes /processes/kill
  // Client Error Monitoring — รับ error จาก browser ผู้ใช้ (สาธารณะ+rate limit — error ก่อน login ก็ต้องเห็น)
  if (process.env.CLIENT_ERROR_ENABLED !== 'false') {
    app.use('/api/client-monitor', clientMonitorRoutes);
  }
  app.use('/api/automation', automationAlertsRoutes); // GET /alerts — หลัง automation.routes เสมอ
}
