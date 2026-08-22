import express from 'express';
import http from 'http';
import https from 'https';
import cors from 'cors';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Server as SocketIOServer } from 'socket.io';
import bcrypt from 'bcryptjs';
import path from 'path';
import os from 'os';
import timescaleRoutes from './modules/timescale/timescale.routes';
import { config } from './config';
import { MqttIngestionWorker, systemEvents } from './workers/mqttIngest';
import { aiAgent } from './services/AiAgentService';
import { appendExchange } from './services/chat-memory.service';
import { relayScheduler } from './services/relay-scheduler.service';
import { reportService } from './services/report.service';
import { backupService } from './services/backup.service';
import { authenticate, requireRole, auditStateChange } from './middleware/auth.middleware';
import { PrismaClient, Prisma } from '@prisma/client';

import authRoutes from './modules/auth/auth.routes';
import nodeRoutes from './modules/nodes/node.routes';
import deviceRoutes from './modules/devices/device.routes';
import telemetryRoutes from './modules/telemetry/telemetry.routes';
import ttsRoutes from './modules/tts/tts.routes';
import automationRoutes from './modules/automation/automation.routes';
import sensorRoutes from './modules/sensors/sensor.routes';
import securityRoutes from './modules/security/security.routes';
import nextgenRoutes, { securityEventsSse } from './modules/security/nextgen.routes';
import { threatIntel } from './services/threat-intel.service';
import { idsReader } from './services/ids-reader.service';
import { aiAnalyst } from './services/ai-analyst.service';
import { appControl } from './services/app-control.service';
import { aiKillSwitch } from './services/ai-kill-switch.service';
import { firstResponder } from './services/first-responder.service';
import { realityCheck } from './services/reality-check.service';
import { livingMode } from './services/living-mode.service';
import { manualDay } from './services/manual-day.service';
import { maintenanceRadar } from './services/maintenance-radar.service';
import { timeConsensus } from './services/time-consensus.service';
import { runBitRotScan } from './services/data-integrity.service';
import govsimRoutes from './modules/govsim/govsim.routes';
import governorRoutes from './modules/governor/governor.routes';
import warRoomRoutes from './modules/war-room/war-room.routes';
import { warRoomActive, warRoomSessionClosed, warRoomSessionOpened } from './services/war-room.service';
import actuationRoutes from './modules/actuation/actuation.routes';
import aiRoutes from './modules/ai/ai.routes';
import whisperRoutes from './modules/whisper/whisper.routes';
import visionRoutes from './modules/vision/vision.routes';
import documentsRoutes from './modules/documents/documents.routes';
import relayRoutes from './modules/relay/relay.routes';
import telegramRoutes, { sendTelegram, sendTelegramPhoto } from './modules/telegram/telegram.routes';
import { buildSnapshotForAlert } from './services/chart-snapshot.service';
import reportRoutes from './modules/reports/reports.routes';
import backupRoutes from './modules/backup/backup.routes';
import meshRoutes from './modules/mesh/mesh.routes';
import { meshLiteService } from './services/mesh-lite.service';
import energyRoutes from './modules/energy/energy.routes';
import otaRoutes from './modules/ota/ota.routes';
import searchRoutes from './modules/search/search.routes';
import knowledgeRoutes from './modules/knowledge/knowledge.routes';
import teachRoutes from './modules/knowledge/teach.routes';
import agentTeamRoutes from './modules/agent/agent.routes';
import visionRuleRoutes from './modules/vision/vision-rule.routes';
import { payWeeklyAllowances, archiveOldItems, resetDailyChores, buildDailySummary, formatDailySummary, snapshotAllPortfolios } from './services/teach-kids.service';
import { seedDefaultRoles, processAgentQueue, runMorningReports } from './services/agent-team.service';
import { processCodingQueue } from './services/coding-agent.service';
import { initGovernor, runGovernorCycle } from './services/governor.service';
import { runVisionCheck } from './services/vision-rule.service';
import { knowledgeDir } from './services/knowledge-dir.service';
import healthReadingsRoutes from './modules/health/health-readings.routes';
import { OtaStatusService } from './services/ota-status.service';
import { threatDetector, threatEmitter } from './services/threat-detection.service';
import { agentActions } from './services/agent-actions.service';
import { listProcesses } from './services/system-processes.service';
import { systemMonitor, getDiskInfo } from './services/system-monitor.service';
import { actuationService } from './services/actuation.service';
import { telegramAgentBot } from './services/telegram-agent-bot.service';
import { PowerGuardWorker } from './services/power-guard.service';
import { UpsMonitorWorker, fetchNutVars } from './services/ups-monitor.service';
import { UpsShutdownService } from './services/ups-shutdown.service';
import { flushTelemetryNow } from './workers/mqttIngest';
import { securityStream } from './services/security-stream.service';
import { sendTelegramAlert } from './services/telegram-alert.service';
import { createWealthWorker, wealthEmitter } from './services/wealth.service';
import { createRiskWorker, riskEmitter } from './services/risk-monitor.service';
import { createDefconEngine, defconEmitter, type DefconAction, type DefconLevel } from './services/defcon-engine.service';
import { runDefconAction } from './services/defcon-actions.service';
import portfolioRoutes from './modules/portfolio/portfolio.routes';
import treasuryRoutes from './modules/treasury/treasury.routes';
import healingRoutes from './modules/healing/healing.routes';
import codingRoutes from './modules/coding/coding.routes';
import workspaceRoutes from './modules/coding/workspace.routes';
import skillsRoutes from './modules/coding/skills.routes';
import notesRoutes from './modules/notes/notes.routes';
import cloneRoutes from './modules/clone/clone.routes';
import riskRoutes from './modules/risk/risk.routes';
import healthRoutes from './modules/health/health.routes';
import infrastructureRoutes from './modules/infrastructure/infrastructure.routes';
import { lifestyleRoutes } from './modules/lifestyle/lifestyle.routes';
import inventoryRoutes from './modules/inventory/inventory.routes';
import farmRoutes from './modules/farm/farm.routes';
import livestockRoutes from './modules/livestock/livestock.routes';
import propertyRoutes from './modules/property/property.routes';
import restaurantRoutes from './modules/restaurant/restaurant.routes';
import predictiveRoutes from './modules/predictive/predictive.routes';
import featureRoutes from './modules/features/feature.routes';
import { featureGuard } from './services/feature-grant.service';
import dmsRoutes from './modules/dms/dms.routes';
import { dmsService } from './services/dms.service';
import { predictiveWorker } from './services/predictive.service';
import dimeRoutes from './modules/dime/dime.routes';
import { startDimeScheduler } from './services/dime.service';
import './services/livestock-cron.service'; // ปลดล็อก withdrawal + เตือนวัคซีน รายวัน
import mqtt from 'mqtt';

const execAsync = promisify(exec);
const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, { cors: { origin: '*' } });
const prisma = new PrismaClient();
const KNOWLEDGE_DIR = knowledgeDir();

// Resolve a requested file name to an absolute path and ensure it stays
// inside KNOWLEDGE_DIR. Prevents path-traversal (e.g. `../../etc/passwd`).
function resolveKnowledgePath(file: string): string | null {
  if (!file) return null;
  const root = path.resolve(KNOWLEDGE_DIR);
  const resolved = path.resolve(root, file);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return null;
  }
  return resolved;
}

app.disable('x-powered-by');
// อยู่หลัง proxy (nginx/caddy) → rate-limit นับ IP จริงได้
app.set('trust proxy', 1);
app.use(cors({
  origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(','),
  // เปิดให้ browser อ่าน Retry-After ได้ (ใช้แสดง countdown ตอนโดน rate limit)
  exposedHeaders: ['Retry-After'],
}));
app.use(express.json({ limit: '25mb' })); // 25MB — รองรับแพ็กเกจ Export & Clone (ฐานข้อมูลเต็ม) + การนำเข้า
app.use(auditStateChange);

// Mount route modules
// ── สิทธิ์ฟังก์ชั่นต่อคน: แต่ละหน้า mount พร้อม requireFeature(featureKey) —
// SUPERADMIN ผ่านเสมอ, สมาชิกต้องได้รับ grant ในตาราง user_feature_grants
// (หน้า auth/devices/telemetry/sensors เป็นโครงสร้างพื้นฐาน — ใคร login แล้วใช้ได้)
app.use('/api/auth', authRoutes);
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
  app.use('/api/dime', featureGuard(['/treasury', '/portfolio']), dimeRoutes); // Dime! Statement — IMAP + PDF → อัปเดตพอร์ตอัตโนมัติ
app.use('/api/healing', featureGuard('/healing'), healingRoutes); // Sovereign Buddhist Healing Module
app.use('/api/coding', featureGuard('/ai-agent'), codingRoutes); // Coding Agent
app.use('/api/coding', featureGuard('/ai-agent'), workspaceRoutes); // Coding Agent — workspace (ตำแหน่งโปรเจ็ก/ไฟล์/เทอร์มินัล)
app.use('/api/coding', featureGuard('/ai-agent'), skillsRoutes); // Coding Agent — skill queue (คิวทักษะ + ระดับอัตโนมัติ)
app.use('/api/notes', featureGuard('/ai-agent'), notesRoutes); // Note — ปุ่มโน้ต
app.use('/api/clone', featureGuard('/settings'), cloneRoutes); // Export & Clone
app.use('/api/risk-monitor', featureGuard('/risk-monitor'), riskRoutes);
app.use('/api/predictive', featureGuard('/predictive'), predictiveRoutes); // Phase 4: Risk Monitor + DEFCON
// Health check — Public (ไม่ต้อง auth) — frontend hook ใช้ poll endpoint นี้
// (ต้องอยู่ก่อน mount health module: featureGuard+authenticate จะ 401 ทุก request ที่ไม่มี token)
app.get('/api/health', (_, res) => res.json({ status: 'ok' }));
app.use('/api/health', featureGuard('/health'), healthRoutes); // Phase 5: Health Screening
app.use('/api/health/readings', featureGuard('/health'), healthReadingsRoutes); // P6: Health Reading Tracker + AI trend
app.use('/api/infrastructure', featureGuard('/infrastructure'), infrastructureRoutes); // Phase 5: Off-Grid Infrastructure Hub
app.use('/api/lifestyle', featureGuard('/lifestyle'), lifestyleRoutes); // Phase 5: Embracing Chaos — จังหวะธรรมชาติ / Living Mode / Manual Day / Maintenance Radar

// ── Feature Modules (ENABLED_MODULES) ──
// เปิด-ปิดกลุ่ม API ระดับโมดูลผ่าน infra/.env — ปิดแล้ว route ไม่ถูก mount (404)
if (config.modules.isEnabled('inventory')) {
  app.use('/api/inventory', featureGuard('/inventory'), inventoryRoutes); // Water & Food Inventory + วันหมดอายุ
}
if (config.modules.isEnabled('documents')) {
  app.use('/api/documents', featureGuard('/inventory'), documentsRoutes); // P5 Document Understanding
}
if (config.modules.isEnabled('farm')) {
  app.use('/api/farm/plots', featureGuard('/farm'), farmRoutes); // Farm Plot Manager
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

// ── สิทธิ์ฟังก์ชั่นต่อคน: API ตั้งสิทธิ์ (catalog / me / users/:id) ──
app.use('/api/features', featureRoutes);

// GET /api/modules — รายชื่อโมดูลที่เปิดใช้งาน (ฝั่ง UI ใช้ซ่อนเมนูที่ไม่เปิด)
app.get('/api/modules', (_, res) => {
  res.json({
    available: config.modules.available,
    enabled: config.modules.available.filter((m) => config.modules.isEnabled(m)),
  });
});

// Dashboard stats
app.get('/api/dashboard/stats', authenticate, async (req, res) => {
  try {
    const nodeId = req.user?.assigned_node_id || '11111111-1111-1111-1111-111111111111';
    const result = await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT DISTINCT ON (metric) metric, value
       FROM sensor_telemetry
       WHERE node_id = $1::uuid
       ORDER BY metric, time DESC`,
      nodeId
    );
    const metrics: Record<string, number> = {};
    for (const row of result) {
      metrics[row.metric] = row.value;
    }
    res.json({ metrics });
  } catch (err) {
    console.error('Dashboard stats error:', err);
    // Never return fabricated data – report the error so the UI can show
    // "no data" instead of presenting fake readings as real.
    res.status(500).json({ error: 'Failed to load dashboard stats' });
  }
});

// Manual sensor data insertion (for UI)
app.post('/api/sensors/data', authenticate, async (req, res) => {
  try {
    const { node_id, device_id, metric, value } = req.body;
    const nodeId = node_id || req.user?.assigned_node_id || '11111111-1111-1111-1111-111111111111';
    const deviceId = device_id || 'manual-input';
    await prisma.$queryRawUnsafe(
      `INSERT INTO sensor_telemetry (time, node_id, device_id, metric, value)
       VALUES (NOW(), $1::uuid, $2, $3, $4)`,
      nodeId, deviceId, metric, value
    );
    res.status(201).json({ success: true, message: `เพิ่ม ${metric} = ${value} สำเร็จ` });
  } catch (err) {
    console.error('Add sensor error:', err);
    res.status(500).json({ error: 'เพิ่มข้อมูลไม่สำเร็จ' });
  }
});

// Sensor metrics list
app.get('/api/sensors/metrics', authenticate, async (req, res) => {
  try {
    const result = await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT DISTINCT metric FROM sensor_telemetry ORDER BY metric`
    );
    res.json(result.map((r: any) => r.metric));
  } catch (err) {
    res.json([]);
  }
});

// Sensor data list
app.get('/api/sensors/all', authenticate, async (req, res) => {
  try {
    const { metric, limit } = req.query;
    let query = `SELECT time, node_id, device_id, metric, value FROM sensor_telemetry WHERE 1=1`;
    const params: any[] = [];
    if (metric && metric !== 'all') {
      query += ` AND metric = $${params.length + 1}`;
      params.push(metric);
    }
    query += ` ORDER BY time DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit as string) || 50);
    const result = await prisma.$queryRawUnsafe<Array<any>>(query, ...params);
    res.json(result);
  } catch (err) {
    res.status(500).json([]);
  }
});

// Delete sensor record
app.delete('/api/sensors/:metric', authenticate, async (req, res) => {
  try {
    const { metric } = req.params;
    const { device_id } = req.query;
    await prisma.$queryRawUnsafe(
      `DELETE FROM sensor_telemetry WHERE metric = $1 AND device_id = $2`,
      metric,
      device_id || 'manual-input'
    );
    res.json({ success: true, message: `ลบ ${metric} สำเร็จ` });
  } catch (err) {
    res.status(500).json({ error: 'ลบไม่สำเร็จ' });
  }
});

// Delete all records of a metric
app.delete('/api/sensors/:metric/all', authenticate, async (req, res) => {
  try {
    await prisma.$queryRawUnsafe(`DELETE FROM sensor_telemetry WHERE metric = $1`, req.params.metric);
    res.json({ success: true, message: `ลบ ${req.params.metric} ทั้งหมดสำเร็จ` });
  } catch (err) {
    res.status(500).json({ error: 'ลบไม่สำเร็จ' });
  }
});

// AI Chat (P1: บันทึกประวัติสนทนา — Conversational Memory) — รองรับแนบรูปภาพ (base64 → vision model)
app.post('/api/ai/chat', authenticate, async (req, res) => {
  const { message } = req.body;
  const imageBase64 = typeof req.body?.imageBase64 === 'string' ? req.body.imageBase64 : undefined;
  try {
    const reply = await aiAgent.processMessage(message, {
      actor: req.user?.id,
      source: 'chat',
      ip: req.ip,
    }, { imageBase64 });
    if (req.user?.id && typeof message === 'string') {
      await appendExchange(req.user.id, imageBase64 ? `[รูปภาพ] ${message}` : message, reply);
    }
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: 'AI service unavailable' });
  }
});

// User Management
app.get('/api/users', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, username: true, role: true, assigned_node_id: true, must_change_password: true },
    });
    res.json(users);
  } catch (err) {
    console.error('Users API error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
app.post('/api/users', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  const { username, password, role } = req.body;
  const hash = await bcrypt.hash(password, 12);
  await prisma.user.create({
    data: {
      username,
      password_hash: hash,
      role: role || 'OPERATOR',
      // สมาชิกใหม่ต้องเปลี่ยนรหัสผ่านหลัง login ครั้งแรก (รหัสแรกเข้าเป็นรหัสชั่วคราว)
      must_change_password: true,
    },
  });
  res.json({ success: true });
});
app.delete('/api/users/:id', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  await prisma.user.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});
app.put('/api/users/:id', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    const { role, assigned_node_id, must_change_password } = req.body;
    const VALID_ROLES = ['SUPERADMIN', 'NODE_ADMIN', 'OPERATOR', 'SYSTEM_AI'];
    if (role !== undefined && !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    const data: any = {};
    if (role !== undefined) data.role = role;
    if (assigned_node_id !== undefined) data.assigned_node_id = assigned_node_id || null;
    // บังคับ/ยกเลิกบังคับเปลี่ยนรหัสผ่าน (เช่น ลืมรหัส → ตั้งรหัสใหม่ + บังคับเปลี่ยน)
    if (must_change_password !== undefined) data.must_change_password = must_change_password === true;
    await prisma.user.update({ where: { id: req.params.id }, data });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
});

// Audit log viewer (SUPERADMIN only)
app.get('/api/audit', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const logs = await prisma.auditLog.findMany({
      orderBy: { timestamp: 'desc' },
      take: limit,
      include: { user: { select: { username: true } } },
    });
    res.json(logs);
  } catch (err) {
    console.error('Audit API error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Knowledge Base
app.get('/api/knowledge/files', authenticate, (req, res) => {
  try {
    const files = fs.readdirSync(KNOWLEDGE_DIR).filter(f => f.endsWith('.txt') || f.endsWith('.md'));
    res.json({ files });
  } catch (err) {
    res.status(500).json({ files: [] });
  }
});
app.get('/api/knowledge/file/:file', authenticate, (req, res) => {
  try {
    const filePath = resolveKnowledgePath(req.params.file);
    if (!filePath) return res.status(400).json({ error: 'Invalid file path' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    const content = fs.readFileSync(filePath, 'utf-8');
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: 'Read failed' });
  }
});
app.post('/api/knowledge/file/:file', authenticate, (req, res) => {
  try {
    const filePath = resolveKnowledgePath(req.params.file);
    if (!filePath) return res.status(400).json({ error: 'Invalid file path' });
    fs.writeFileSync(filePath, req.body.content);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Write failed' });
  }
});

// System Health
// ── Liveness probe (ไม่มี auth) — ใช้กับ Docker healthcheck + watchdog ──
app.get('/healthz', (req, res) => {
  res.json({ ok: true, uptime: Math.floor(process.uptime()) });
});

app.get('/api/system/health', authenticate, async (req, res) => {
  const uptime = os.uptime();
  const cpuUsage = (os.loadavg()[0] / os.cpus().length * 100).toFixed(1) + '%';
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const memory = ((totalMem - freeMem) / totalMem * 100).toFixed(1) + '%';
  let disk = 'N/A';
  try {
    const info = await getDiskInfo();
    if (info) disk = `${info.usedPct}% เต็ม · เหลือ ${(info.freeMb / 1024).toFixed(1)} GB / ${(info.totalMb / 1024).toFixed(1)} GB`;
  } catch {
    // ไม่ได้ข้อมูลดิสก์ = แสดง N/A
  }
  res.json({
    uptime: Math.floor(uptime / 3600) + 'h ' + Math.floor((uptime % 3600) / 60) + 'm',
    cpuUsage,
    memory,
    disk
  });
});

// GET /api/system/processes - รายการ process ที่รันอยู่ (สำหรับปุ่ม killProcess)
app.get('/api/system/processes', authenticate, async (req, res) => {
  try {
    res.json(await listProcesses());
  } catch (err) {
    console.error('List processes error:', err);
    res.status(500).json({ error: 'Failed to list processes' });
  }
});

// POST /api/system/processes/kill - kill ผ่าน guard + autonomy เดียวกับ AI agent
// 200 = สำเร็จ, 202 = รออนุมัติ (โหมด suggest), 403 = ถูกปฏิเสธ (view / guard)
app.post('/api/system/processes/kill', authenticate, async (req, res) => {
  const { pid, name } = req.body || {};
  const args: any = {};
  if (pid !== undefined && pid !== null && pid !== '') {
    args.pid = Number(pid);
  } else if (typeof name === 'string' && name.trim()) {
    args.name = name.trim();
  } else {
    return res.status(400).json({ error: 'pid or name is required' });
  }

  const result = await agentActions.executeAction('killProcess', args, {
    actor: req.user?.id,
    source: 'system-ui',
    ip: req.ip,
  });
  if (result.status === 'denied') return res.status(403).json(result);
  if (result.status === 'requires_approval') return res.status(202).json(result);
  return res.json(result);
});

// Automation Alerts – เก็บลงฐานข้อมูล (ประวัติถาวร, อยู่ข้าม restart)
app.get('/api/automation/alerts', authenticate, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const alerts = await prisma.automationAlert.findMany({
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
    // คืน shape เดิม (ruleId …) เพื่อให้ frontend ทำงานได้ไม่ต้องแก้
    res.json(
      alerts.map((a) => ({
        ruleId: a.rule_id,
        metric: a.metric,
        value: a.value,
        threshold: a.threshold,
        message: a.message,
        severity: a.severity,
        timestamp: a.timestamp,
      }))
    );
  } catch (err) {
    console.error('Load alerts error:', err);
    res.status(500).json({ error: 'Failed to load alerts' });
  }
});
// Provide a way to push alerts from automation engine
import { automationEmitter } from './services/automation.service';
automationEmitter.on('alert', async (alert) => {
  // บันทึกประวัติลง DB ก่อน (ล้มเหลวไม่ขัดขวางการแจ้งเตือน)
  try {
    await prisma.automationAlert.create({
      data: {
        rule_id: alert.ruleId,
        metric: alert.metric,
        value: alert.value,
        threshold: alert.threshold,
        message: alert.message,
        severity: alert.severity,
        timestamp: new Date(alert.timestamp),
      },
    });
  } catch (err) {
    console.error('Failed to save automation alert:', err);
  }

  io.emit('new_alert', alert);

  // ส่งแจ้งเตือนผ่าน Telegram (ผ่าน dispatcher: severity gate + dedup + rate-limit)
  const alertSeverity = alert.severity === 'critical' ? 'critical' : alert.severity === 'warning' ? 'warn' : 'info';
  await sendTelegramAlert({
    text: alert.message,
    severity: alertSeverity,
    eventKey: `automation:${alert.metric ?? 'alert'}`,
  });

  // Alert ระดับ critical → ส่งภาพกราฟแนวโน้ม metric 12 ชม. ไป Telegram ด้วย
  if (alert.severity === 'critical') {
    try {
      const png = await buildSnapshotForAlert(alert);
      if (png) {
        const caption = `📈 แนวโน้ม ${alert.metric} 12 ชม. — ค่าล่าสุด ${alert.value} (เกณฑ์ ${alert.threshold})`;
        await sendTelegramPhoto(png, caption);
      } else {
        console.warn('Chart snapshot skipped (insufficient telemetry data)');
      }
    } catch (err) {
      console.error('Failed to send chart snapshot to Telegram:', err);
    }
  }
});

// Start services
new MqttIngestionWorker();
relayScheduler.start();
startDimeScheduler(); // Dime! Statement — cron ตาม DIME_ENABLED/DIME_FETCH_CRON (default ปิด)

// ── Series 🔴: Dead-Man Switch (DMS) — ตรวจบันไดวิกฤต 90s/180s + WoL (ถ้าตั้ง) ──
// DMS_ENABLED=true + DMS_MASTER_SECRET ต้องตั้งพร้อมกัน (config.dms.enabled) — ปิดไว้โดย default
if (config.dms.enabled) {
  dmsService.init();
  dmsService.start(config.dms.checkIntervalMs);
  console.log(
    `🛡️ DMS monitor started (devices: ${config.dms.allowedDevices.join(', ')}, missed>${config.dms.missedMs}ms, failover>${config.dms.failoverMs}ms, autoFailover=${config.dms.autoFailover}, dry-run=${config.dms.dryRun})`
  );
} else {
  console.log('🛡️ DMS monitor disabled (set DMS_ENABLED=true + DMS_MASTER_SECRET to enable)');
}

// ── AI สอนลูก: จ่ายค่าขนมรายสัปดาห์อัตโนมัติ ── ตรวจทุก 30 นาที + ตอนเริ่มระบบ
// จ่ายเฉพาะคนที่ถึงกำหนด (กันจ่ายซ้ำด้วย allowance_last_paid) — บันทึกเป็น wallet tx
async function runAllowanceCheck() {
  try {
    const res = await payWeeklyAllowances();
    if (res.paid > 0) console.log(`💰 ค่าขนมรายสัปดาห์: จ่ายแล้ว ${res.paid} คน รวม ${res.total} บาท`);
  } catch (err) {
    console.error('Allowance worker error:', err instanceof Error ? err.message : err);
  }
}
runAllowanceCheck();
setInterval(runAllowanceCheck, 30 * 60 * 1000);

// ── AI สอนลูก: เก็บถาวรงาน/บิลที่จบแล้วเกิน 30 วัน ── ตรวจทุก 6 ชม. + ตอนเริ่มระบบ
async function runArchiveCheck() {
  try {
    const res = await archiveOldItems();
    if (res.chores > 0 || res.bills > 0) {
      console.log(`🗂️ เก็บถาวร: งาน ${res.chores} รายการ · บิล ${res.bills} รายการ (จบแล้วเกิน 30 วัน)`);
    }
  } catch (err) {
    console.error('Archive worker error:', err instanceof Error ? err.message : err);
  }
}
runArchiveCheck();
setInterval(runArchiveCheck, 6 * 60 * 60 * 1000);

// ── AI สอนลูก: รีเซ็ตงานบ้านรายวัน (เช็กลิสต์กลับมาเป็นค้างใหม่ทุกเช้า) ──
async function runDailyChoreReset() {
  try {
    const res = await resetDailyChores();
    if (res.reset > 0) console.log(`🔄 งานบ้านรายวัน: รีเซ็ตใหม่ ${res.reset} งาน (เช้านี้)`);
  } catch (err) {
    console.error('Daily chore reset error:', err instanceof Error ? err.message : err);
  }
}
runDailyChoreReset();
setInterval(runDailyChoreReset, 60 * 60 * 1000);

// ── AI สอนลูก: สรุปประจำวันส่ง Telegram (วันละครั้ง — กันซ้ำด้วย lastSentDate) ──
let lastDailySummarySent = '';
async function runDailySummarySend() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    if (lastDailySummarySent === today) return;
    const summary = await buildDailySummary();
    if (summary.kids.length === 0) return; // ยังไม่มีโปรไฟล์เด็ก → ข้าม
    const text = formatDailySummary(summary);
    if (!text) return;
    const ok = await sendTelegram(text);
    if (ok) {
      lastDailySummarySent = today;
      console.log(`📋 สรุปประจำวันส่ง Telegram แล้ว (${summary.kids.length} คน)`);
    }
  } catch (err) {
    console.error('Daily summary send error:', err instanceof Error ? err.message : err);
  }
}
runDailySummarySend();
setInterval(runDailySummarySend, 60 * 60 * 1000);

// ── Agentic AI team: seed บทบาทเริ่มต้น + เก็บงาน queued ค้างหลัง restart ──
seedDefaultRoles().catch((err) => console.error('Seed agent roles error:', err));
processAgentQueue().catch((err) => console.error('Agent queue boot error:', err));
setInterval(() => {
  processAgentQueue().catch((err) => console.error('Agent queue error:', err));
}, 30 * 1000);

// ── Coding Agent: เก็บงาน queued ค้างหลัง restart + รันงานเขียนโค้ดเบื้องหลัง ──
processCodingQueue().catch((err) => console.error('Coding queue boot error:', err));
setInterval(() => {
  processCodingQueue().catch((err) => console.error('Coding queue error:', err));
}, 15 * 1000);

// ── Governor AI: คุมเมืองอัตโนมัติ (loop ทุก GOVERNOR_INTERVAL_MS — เริ่มแบบปิด รอมนุษย์เปิดที่ War Room) ──
// ข้อ 3 (Event-Driven Simulation): Governor/GovSim "หลับ" เมื่อไม่มีมนุษย์เปิด War Room
// (warRoomActive() = มี SSE session + API activity ภายใน 10 นาที) — หลับ = ข้ามรอบ ไม่โหลด Ollama
// ตื่นทันทีเมื่อมี activity: เพิ่งตื่น → kick รอบทันที ไม่รอรอบถัดไป
initGovernor();
let warRoomWasAwake = true;
setInterval(() => {
  const awake = warRoomActive();
  if (!awake) {
    warRoomWasAwake = false; // War Room หลับ — ข้ามรอบ Governor (simulation หยุดพัก)
    return;
  }
  const justWoke = !warRoomWasAwake; // มนุษย์เพิ่งเปิดหน้า → รันรอบทันที
  warRoomWasAwake = true;
  runGovernorCycle().catch((err) => console.error('Governor cycle error:', err));
  if (justWoke) console.log('⚡ War Room ตื่น — Governor รันรอบทันที');
}, parseInt(process.env.GOVERNOR_INTERVAL_MS || '120000', 10));

// ── AI สอนลูก: บันทึกมูลค่าพอร์ตหุ้นรายวัน (snapshot ต่อคน) — วันละครั้ง + ตอนเริ่มระบบ ──
async function runPortfolioSnapshot() {
  try {
    const res = await snapshotAllPortfolios();
    if (res.saved > 0) console.log(`📈 บันทึกมูลค่าพอร์ตหุ้นรายวัน: ${res.saved} คน`);
  } catch (err) {
    console.error('Portfolio snapshot error:', err instanceof Error ? err.message : err);
  }
}
runPortfolioSnapshot();
setInterval(runPortfolioSnapshot, 6 * 60 * 60 * 1000);

// ── Agentic AI: สรุปประจำวันของแต่ละบทบาทส่ง Telegram ทุกเช้า (report_hour) ──
async function runAgentMorningReports() {
  try {
    const res = await runMorningReports();
    if (res.reported > 0) console.log(`🤖 สรุปรายวันส่ง Telegram แล้ว ${res.reported} บทบาท (ข้าม ${res.skipped})`);
  } catch (err) {
    console.error('Agent morning report error:', err instanceof Error ? err.message : err);
  }
}
runAgentMorningReports();
setInterval(runAgentMorningReports, 30 * 60 * 1000);

// ── Vision AI คนแปลกหน้า: ตรวจตามกฎ (ทุก 60 วิ — ตัวกฎกันการตรวจซ้ำด้วย interval_min) ──
async function runVisionCheckWorker() {
  try {
    const res = await runVisionCheck();
    if (res.alerted) console.log('🚨 Vision AI แจ้งเตือนคนแปลกหน้า');
  } catch (err) {
    console.error('Vision check error:', err instanceof Error ? err.message : err);
  }
}
setInterval(runVisionCheckWorker, 60 * 1000);
reportService.start();
backupService.startScheduler();
meshLiteService.start();
new OtaStatusService();
threatDetector.start();

// ── Next-Gen Security ──
// Pillar 1: Threat Intelligence — seed ฐาน IOC + cron อัปเดต feed (ทุก N ชม.)
appControl.init();
aiKillSwitch.init();
firstResponder.init();
realityCheck.init();
livingMode.init();
manualDay.init();
maintenanceRadar.init();
threatIntel.seedIfEmpty().then((n) => console.log(`🧬 Threat Intel: seed ${n} IOC รายการ`)).catch(() => {});
threatIntel.updateFromFeeds().then((r) => console.log(`🧬 Threat Intel: feed +${r.added} (รวม ${r.total})`)).catch(() => {});
setInterval(() => {
  if (threatIntel.shouldRunFeed()) {
    threatIntel.updateFromFeeds().catch(() => {});
  }
}, 6 * 3600 * 1000); // ตรวจทุก 6 ชม. ว่าถึงเวลาอัปเดต feed หรือยัง

// ── Phase 6: The Final Hardening (Epistemic Isolation) ──
// 1) Time-Consensus — เฝ้าเวลาทุก 60 วิ (clock jump / DB desync / non-causal logs)
timeConsensus.check().catch(() => {});
setInterval(() => timeConsensus.check().catch(() => {}), 60 * 1000);
// 2) Bit-Rot Scan — สแกน checksum ไฟล์ state ตอน boot + ทุกสัปดาห์
runBitRotScan().then((r) => {
  console.log(`💾 Bit-rot scan: ${r.scanned} ไฟล์ · ${r.ok} ok · baseline ${r.baselineCreated} · corrupt ${r.corrupt.length}`);
}).catch(() => {});
setInterval(() => runBitRotScan().catch(() => {}), 7 * 24 * 3600 * 1000);
// 3) System Monitor — ดิสก์/เมม/CPU (alert ก่อนตายเงียบ ๆ)
systemMonitor.start();

// Pillar 3: IDS reader (Suricata eve.json — opt-in: ตั้ง IDS_EVE_LOG เท่านั้น, ว่าง = ปิดเงียบ ไม่ใช้ทรัพยากร) + Pillar 6: AI Analyst
const idsStarted = idsReader.start();
if (idsStarted) console.log(`🛡️ IDS reader เริ่มติดตาม ${config.nextgen.idsEveLog}`);
const analystStarted = aiAnalyst.start();
if (analystStarted) console.log('🤖 AI Security Analyst เริ่มทำงาน (Ollama + Telegram)');

// ── Phase 4: Risk & Wealth Infrastructure ──

// Module 13: Wealth & Asset Tracker — cron job ดึงราคา (ทุก 1-4 ชม.) + คำนวณพอร์ต/เสบียง/runway
const wealthWorker = createWealthWorker(config.portfolio);
app.locals.wealthWorker = wealthWorker;
wealthWorker.start();

// Module 14 + 15: Risk Monitor (RSS + Ollama) → DEFCON Engine (physical actions)
// DEFCON actions: ต่อกับระบบเดิมที่มีอยู่ — MQTT relay control + backup + exec (เหมือน POWER_SHUTDOWN_CMD)
const defconMqtt = mqtt.connect({
  host: process.env.MQTT_HOST || 'localhost',
  port: Number(process.env.MQTT_PORT) || 1883,
  protocol: 'mqtt',
});
const DEFAULT_NODE_ID = '11111111-1111-1111-1111-111111111111';

// ── Phase 7: Closed-Loop Actuation Sandbox — ใส่ตัวอ่าน snapshot จริง (TimescaleDB) ──
actuationService.setDeps({
  loadSnapshot: async () => {
    try {
      const latestRows = await prisma.$queryRawUnsafe<Array<any>>(
        `SELECT DISTINCT ON (metric) metric, value
         FROM sensor_telemetry
         WHERE metric IN ('battery_soc', 'power_kw')
         ORDER BY metric, time DESC`
      );
      const latest: Record<string, number> = {};
      for (const r of latestRows) latest[r.metric] = Number(r.value);
      const tempRows = await prisma.$queryRawUnsafe<Array<any>>(
        `SELECT MAX(value) AS max_temp
         FROM sensor_telemetry
         WHERE metric IN ('temperature', 'temp', 'temp_c')
           AND time >= NOW() - INTERVAL '10 minutes'`
      );
      const occRows = await prisma.$queryRawUnsafe<Array<any>>(
        `SELECT value FROM sensor_telemetry
         WHERE metric IN ('presence', 'motion', 'occupancy')
           AND time >= NOW() - INTERVAL '30 minutes'
         ORDER BY time DESC LIMIT 1`
      );
      return {
        batterySoc: latest.battery_soc != null ? Number(latest.battery_soc) : null,
        powerKw: latest.power_kw != null ? Number(latest.power_kw) : null,
        tempC: tempRows[0]?.max_temp != null ? Number(tempRows[0].max_temp) : null,
        occupied: occRows.length ? Number(occRows[0].value) > 0 : false,
      };
    } catch (err) {
      console.error('Actuation: snapshot load failed:', err instanceof Error ? err.message : err);
      return { batterySoc: null, powerKw: null, tempC: null, occupied: false };
    }
  },
  publishReal: (actuatorId, state) => {
    defconMqtt.publish(`sovereign/${DEFAULT_NODE_ID}/relay/${actuatorId}`, state === 'on' ? '1' : '0');
  },
});

async function defconRunAction(level: DefconLevel, action: DefconAction): Promise<void> {
  // DEFCON_DRY_RUN=true (default): มาตรการทางกายภาพวิ่งผ่าน actuation sandbox — ดูผลใน history + envelope ทำงานจริง
  // DEFCON_DRY_RUN=false: พฤติกรรมเดิม — MQTT จริง + exec คำสั่ง
  const dryRun = process.env.DEFCON_DRY_RUN !== 'false';
  await runDefconAction(level, action, {
    dryRun,
    executeActuator: async (id, state, reason) => {
      const r = await actuationService.executeCommand({ actuatorId: id, desiredState: state, actor: 'system', reason });
      return { ok: r.ok, rule: r.rule };
    },
    backup: () => backupService.createBackup(),
    meshReplicate: () => meshLiteService.replicate(),
    sendTelegramMsg: (text) => sendTelegramAlert({ text, severity: 'critical', eventKey: `defcon:${level}` }).then((r) => r.sent),
    mqttRelay: (relayId, state) => defconMqtt.publish(`sovereign/${DEFAULT_NODE_ID}/relay/${relayId}`, state),
    execCmd: (cmd) => execAsync(cmd, { timeout: 15000 }),
    log: (detail) => console.log(`🛡️ DEFCON ${level}: ${action.id} — ${detail}`),
  });
}

const defconEngine = createDefconEngine({
  hysteresis: config.defcon.hysteresis,
  runAction: defconRunAction,
});
app.locals.defconEngine = defconEngine;

const riskWorker = createRiskWorker(config.risk);
app.locals.riskWorker = riskWorker;
riskWorker.start();

// Predictive — คาดการณ์แบต + ตรวจ anomaly ทุก 15 นาที (alert → automationEmitter
// → บันทึก DB + socket 'new_alert' + Telegram — จัดการที่ server.ts:429 แล้ว)
predictiveWorker.start();

// Power guard — เฝ้าดูแบตเตอรี่ แล้วแจ้งเตือน / สั่ง graceful shutdown
// (อ่านข้อมูลเดียวกันกับ /api/energy/summary — battery_soc + power_kw จาก TimescaleDB)
const powerGuard = new PowerGuardWorker(
  {
    loadSnapshot: async () => {
      try {
        const latestRows = await prisma.$queryRawUnsafe<Array<any>>(
          `SELECT DISTINCT ON (metric) metric, value
           FROM sensor_telemetry
           WHERE metric IN ('battery_soc', 'power_kw')
           ORDER BY metric, time DESC`
        );
        const latest: Record<string, number> = {};
        for (const r of latestRows) latest[r.metric] = Number(r.value);
        const avgRows = await prisma.$queryRawUnsafe<Array<any>>(
          `SELECT AVG(value) AS avg_power
           FROM sensor_telemetry
           WHERE metric = 'power_kw' AND time >= NOW() - INTERVAL '24 hours'`
        );
        const avgPower = avgRows[0]?.avg_power != null ? Number(avgRows[0].avg_power) : null;
        return {
          batterySoc: latest.battery_soc != null ? Number(latest.battery_soc) : null,
          avgPowerKw: avgPower,
        };
      } catch (err) {
        console.error('Power guard: cannot load energy state:', err instanceof Error ? err.message : err);
        return { batterySoc: null, avgPowerKw: null };
      }
    },
    notify: async (level, message) => {
      io.emit('critical_alert', { type: 'power_guard', level, message });
      const icon = level === 'critical' ? '🚨' : '⚠️';
      await sendTelegram(`${icon} ${message}`);
    },
    runShutdown: async (command) => {
      try {
        await execAsync(command, { timeout: 15000 });
        console.warn(`🔌 Power guard: executed shutdown command: ${command}`);
      } catch (err) {
        console.error('Power guard: shutdown command failed:', err instanceof Error ? err.message : err);
      }
    },
  },
  config.power
);
powerGuard.start();

// UPS monitor — อ่านค่า UPS ผ่าน NUT แล้ว push เข้า telemetry (UPS_ENABLED=true)
// ค่าที่เขียนลง sensor_telemetry: battery_soc / power_kw / voltage
// ข้อมูลจะไหลเข้าหน้า dashboard + /api/energy/summary + power guard โดยอัตโนมัติ
if (config.ups.enabled) {
  const upsMonitor = new UpsMonitorWorker(
    {
      fetchVars: () => fetchNutVars(config.ups.host, config.ups.port, config.ups.upsName),
      insertTelemetry: async (metric, value) => {
        await prisma.$queryRawUnsafe(
          `INSERT INTO sensor_telemetry (time, node_id, device_id, metric, value)
           VALUES (NOW(), $1::uuid, $2, $3, $4)`,
          config.ups.nodeId,
          'ups-monitor',
          metric,
          value
        );
      },
      emitTelemetryUpdate: (data) => {
        systemEvents.emit('telemetry_update', { node_id: config.ups.nodeId, ...data });
      },
      emitLowBattery: (snapshot) => {
        systemEvents.emit('alert:battery_low', {
          nodeId: config.ups.nodeId,
          deviceId: 'ups-monitor',
          battery_soc: snapshot.batteryCharge,
          message: `Critical: UPS battery SOC dropped to ${snapshot.batteryCharge}%`,
        });
      },
    },
    config.ups
  );
  upsMonitor.start();
  // UPS Graceful Shutdown — trigger เมื่อแบตเตอรี่ถึงขีด → CHECKPOINT → drain → bundle → audit → ปิดเครื่อง
  const upsShutdown = new UpsShutdownService(
    {
      readUps: () => fetchNutVars(config.ups.host, config.ups.port, config.ups.upsName),
      checkpointDb: async () => {
        try {
          await prisma.$executeRawUnsafe('CHECKPOINT;');
          console.log('🔌 [UPS] CHECKPOINT สำเร็จ (WAL ลง disk แล้ว)');
        } catch (err) {
          console.error('🔌 [UPS] CHECKPOINT ล้มเหลว:', err instanceof Error ? err.message : err);
        }
      },
      drainTelemetry: flushTelemetryNow,
      emergencyBackup: async () => {
        const info = meshLiteService.createBundle();
        if (info) console.log(`🔌 [UPS] Emergency bundle: ${info.file}`);
        else console.error('🔌 [UPS] Emergency bundle ล้มเหลว:', meshLiteService.status().lastError);
      },
      audit: async (payload) => {
        securityStream.push('SYSTEM', { event: 'ups_shutdown_initiated', ...payload.raw, at: new Date().toISOString() });
        await prisma.securityEvent.create({
          data: {
            event_type: 'SYSTEM_UPS_SHUTDOWN_INITIATED',
            severity: 'critical',
            description: `🔌 ${payload.text}`,
            raw_data: payload.raw as unknown as Prisma.InputJsonValue,
          },
        });
        sendTelegramAlert({ text: payload.text, severity: 'critical', eventKey: 'ups_shutdown' }).catch(() => {});
      },
      runShutdown: async (command) => {
        try {
          await execAsync(command);
          console.log(`🔌 [UPS] Shutdown command executed: ${command}`);
        } catch (err) {
          console.error('🔌 [UPS] Shutdown command failed:', err instanceof Error ? err.message : err);
        }
      },
    },
    {
      batteryPct: config.ups.shutdownBatteryPct,
      runtimeSec: config.ups.shutdownRuntimeSec,
      command: config.ups.shutdownCommand,
      dryRun: config.ups.dryRun,
      checkIntervalMs: config.ups.shutdownCheckIntervalMs,
    }
  );
  upsShutdown.start();
} else {
  console.warn('🔌 UPS monitor disabled — set UPS_ENABLED=true + NUT server to enable');
}

// Forward internal events to websocket clients
wealthEmitter.on('wealth_update', (data) => io.emit('wealth_update', data));
riskEmitter.on('risk_error', (err) => io.emit('risk_error', err));
riskEmitter.on('threat_update', (threat) => {
  io.emit('threat_update', threat);
  // DEFCON Engine: แปลง Threat Index → คำสั่งอุปกรณ์กายภาพ (Module 15)
  if (config.defcon.enabled) {
    defconEngine.check(threat.overall).catch((err) =>
      console.error('🛡️ DEFCON check error:', err instanceof Error ? err.message : err)
    );
  }
});
// ระดับ DEFCON เปลี่ยน (up/down) → push ให้ dashboard อัปเดตทันที
// payload: { level, direction, overall, from? }
defconEmitter.on('defcon', (data) => io.emit('defcon_update', data));
systemEvents.on('telemetry_update', (data) => io.emit('telemetry_update', data));
systemEvents.on('alert:battery_low', (alert) => {
  io.emit('critical_alert', alert);
  sendTelegramAlert({ text: `แบตเตอรี่ต่ำ: ${JSON.stringify(alert)}`, severity: 'warn', eventKey: 'battery_low' }).catch(() => {});
});
// Power guard alerts → หน้าเว็บ (Socket.IO) — Telegram ส่งที่ notify() ด้านบนแล้ว

// Threat detection → ส่งให้ UI + แจ้งเตือน Telegram (ผ่าน dispatcher — critical ส่งทันที, warn throttled)
threatEmitter.on('threat', (event) => {
  io.emit('security_alert', event);
  const sev = event.severity === 'critical' ? 'critical' : 'warn';
  sendTelegramAlert({
    text: `[${String(event.severity).toUpperCase()}] ${event.description}${event.blocked ? ' — 🚫 ได้ block IP แล้ว' : ''}`,
    severity: sev,
    eventKey: `threat:${event.rule_id ?? event.description}`,
  }).catch(() => {});
});

// AI agent approvals → แจ้งเตือน Telegram พร้อมปุ่ม อนุมัติ/ปฏิเสธ
// (บอทฟังคำสั่ง + callback จาก TELEGRAM_CHAT_ID เท่านั้น)
agentActions.onApprovalRequested((info) => {
  telegramAgentBot.notifyApprovalRequest(info);
});
if (telegramAgentBot.enabled) {
  telegramAgentBot.startPolling();
  console.log('🤖 Telegram agent bot polling started');
} else {
  console.warn('🤖 Telegram agent bot disabled — set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID to enable');
}

// ── HTTPS (production): ถ้าตั้ง TLS_CERT + TLS_KEY จะรันผ่าน TLS ──
function startListener() {
  if (config.tls.certPath && config.tls.keyPath) {
    const tlsOptions = {
      cert: fs.readFileSync(config.tls.certPath),
      key: fs.readFileSync(config.tls.keyPath),
    };
    const httpsServer = https.createServer(tlsOptions, app);
    io.attach(httpsServer); // websocket ผ่าน TLS ด้วย
    httpsServer.listen(config.port, () => {
      console.log(`🔒 Core API running on https://0.0.0.0:${config.port}`);
    });
    return;
  }
  server.listen(config.port, () => {
    console.log(`🚀 Core API running on port ${config.port}`);
  });
}

startListener();
console.log(`📡 WebSocket server ready (${config.isProduction ? 'production' : 'development'})`);

// ── Reliability: กัน request เดียวพังทั้งระบบ ──
// 1) error middleware — 500 ที่อ่านง่ายแทน crash
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error('❌ Unhandled route error:', err?.message || err);
  if (err?.stack) console.error(err.stack);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  } else {
    res.end();
  }
});

// 2) uncaughtException / unhandledRejection — log แล้วอยู่ต่อ (appliance ต้องไม่ตายง่าย)
process.on('uncaughtException', (err) => {
  console.error('❌ uncaughtException (kept alive):', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('❌ unhandledRejection (kept alive):', reason);
});