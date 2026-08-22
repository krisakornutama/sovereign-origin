import type { Express } from 'express';
import { config } from './config';
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
import dimeRoutes from './modules/dime/dime.routes';
import healingRoutes from './modules/healing/healing.routes';
import codingRoutes from './modules/coding/coding.routes';
import workspaceRoutes from './modules/coding/workspace.routes';
import skillsRoutes from './modules/coding/skills.routes';
import notesRoutes from './modules/notes/notes.routes';
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
import livestockRoutes from './modules/livestock/livestock.routes';
import propertyRoutes from './modules/property/property.routes';
import restaurantRoutes from './modules/restaurant/restaurant.routes';
import govsimRoutes from './modules/govsim/govsim.routes';
import governorRoutes from './modules/governor/governor.routes';
import warRoomRoutes from './modules/war-room/war-room.routes';
import actuationRoutes from './modules/actuation/actuation.routes';
import dmsRoutes from './modules/dms/dms.routes';
import featureRoutes from './modules/features/feature.routes';
import dashboardRoutes from './modules/dashboard/dashboard.routes';
import usersRoutes from './modules/users/users.routes';
import auditRoutes from './modules/audit/audit.routes';
import systemRoutes, { livenessRouter } from './modules/system/system.routes';
import automationAlertsRoutes from './modules/automation/alerts.routes';
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
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
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

  // ── เดิมเป็น inline routes ใน server.ts — แยกเป็น module แล้ว (mount ต่อท้ายตามลำดับเดิม) ──
  app.use('/api', dashboardRoutes); // GET /api/modules + /api/dashboard/stats
  app.use('/api/sensors', sensorDataRoutes); // /data /metrics /all DELETE /:metric — หลัง sensor.routes เสมอ
  app.use('/api/ai', aiChatRoutes); // POST /chat — หลัง ai.routes เสมอ
  app.use('/api/users', usersRoutes); // จัดการ user (SUPERADMIN)
  app.use('/api/audit', auditRoutes); // ดู audit log (SUPERADMIN)
  app.use('/api/knowledge', knowledgeFilesRoutes); // ไฟล์ .txt/.md — หลัง search/knowledge/teach เสมอ
  app.use(livenessRouter); // GET /healthz (Docker healthcheck + watchdog — ไม่มี auth)
  app.use('/api/system', systemRoutes); // /health /processes /processes/kill
  app.use('/api/automation', automationAlertsRoutes); // GET /alerts — หลัง automation.routes เสมอ
}
