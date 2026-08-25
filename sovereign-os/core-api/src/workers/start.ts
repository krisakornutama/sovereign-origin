import type { Express } from 'express';
import type { Server as SocketIOServer } from 'socket.io';
import { exec } from 'child_process';
import { promisify } from 'util';
import mqtt from 'mqtt';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import { MqttIngestionWorker, systemEvents, flushTelemetryNow } from './mqttIngest';
import { relayScheduler } from '../services/relay-scheduler.service';
import { startDimeScheduler } from '../services/dime.service';
import { dmsService } from '../services/dms.service';
import { payWeeklyAllowances, archiveOldItems, resetDailyChores, buildDailySummary, formatDailySummary, snapshotAllPortfolios } from '../services/teach-kids.service';
import { runSignalCheck } from '../services/portfolio-signal.service';
import { startWanMonitor } from '../services/wan-monitor.service';
import { seedDefaultRoles, processAgentQueue, runMorningReports } from '../services/agent-team.service';
import { processCodingQueue } from '../services/coding-agent.service';
import { initGovernor, runGovernorCycle } from '../services/governor.service';
import { warRoomActive } from '../services/war-room.service';
import { runVisionCheck } from '../services/vision-rule.service';
import { reportService } from '../services/report.service';
import { backupService } from '../services/backup.service';
import { meshLiteService } from '../services/mesh-lite.service';
import { OtaStatusService } from '../services/ota-status.service';
import { threatDetector, threatEmitter } from '../services/threat-detection.service';
import { appControl } from '../services/app-control.service';
import { aiKillSwitch } from '../services/ai-kill-switch.service';
import { firstResponder } from '../services/first-responder.service';
import { realityCheck } from '../services/reality-check.service';
import { livingMode } from '../services/living-mode.service';
import { manualDay } from '../services/manual-day.service';
import { maintenanceRadar } from '../services/maintenance-radar.service';
import { threatIntel } from '../services/threat-intel.service';
import { idsReader } from '../services/ids-reader.service';
import { aiAnalyst } from '../services/ai-analyst.service';
import { timeConsensus } from '../services/time-consensus.service';
import { runBitRotScan } from '../services/data-integrity.service';
import { systemMonitor } from '../services/system-monitor.service';
import { createWealthWorker, wealthEmitter } from '../services/wealth.service';
import { createRiskWorker, riskEmitter } from '../services/risk-monitor.service';
import { createDefconEngine, defconEmitter, type DefconAction, type DefconLevel } from '../services/defcon-engine.service';
import { runDefconAction } from '../services/defcon-actions.service';
import { actuationService } from '../services/actuation.service';
import { PowerGuardWorker } from '../services/power-guard.service';
import { UpsMonitorWorker, fetchNutVars } from '../services/ups-monitor.service';
import { UpsShutdownService } from '../services/ups-shutdown.service';
import { securityStream } from '../services/security-stream.service';
import { sendTelegramAlert } from '../services/telegram-alert.service';
import { sendTelegram, sendTelegramPhoto } from '../modules/telegram/telegram.routes';
import { telegramAgentBot } from '../services/telegram-agent-bot.service';
import { agentActions } from '../services/agent-actions.service';
import { automationEmitter } from '../services/automation.service';
import { buildSnapshotForAlert } from '../services/chart-snapshot.service';
import { predictiveWorker } from '../services/predictive.service';

// ────────────────────────────────────────────────────────────────────────────
// startWorkers — จุดรวมเริ่มงานเบื้องหลังทั้งหมด (ย้ายมาจาก server.ts)
// เรียกครั้งเดียวตอน boot ก่อน listen — ลำดับข้างในคงตามต้นฉบับเดิม
// ────────────────────────────────────────────────────────────────────────────
export function startWorkers(app: Express, io: SocketIOServer): void {
  const execAsync = promisify(exec);

  // Provide a way to push alerts from automation engine
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

  // ── AI Portfolio Manager: ตรวจสัญญาณ Small-Cap ทุก 15 นาที (Rule 3 Daily gate กัน spam ใน service) ──
  // กฎเก็บใน SystemSetting 'portfolio.triggers' — แก้ได้ผ่าน /api/treasury/signals
  async function runPortfolioSignals() {
    try {
      const report = await runSignalCheck();
      if (report.alerts.length > 0) {
        console.log(`📈 Portfolio signals: ${report.alerts.map((a) => `${a.symbol}:${a.action}`).join(', ')}`);
      }
    } catch (err) {
      console.error('Portfolio signal error:', err instanceof Error ? err.message : err);
    }
  }
  runPortfolioSignals();
  setInterval(runPortfolioSignals, 15 * 60 * 1000);

  // ── WAN Monitor: เฝ้าเน็ตซิม Archer MR505 ทุก 60 วิ (alert UP/DOWN + telemetry wan_state) ──
  startWanMonitor(60_000);

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
  const DEFAULT_NODE_ID = config.defaults.telemetryNodeId;

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
  // → บันทึก DB + socket 'new_alert' + Telegram — จัดการที่ automation handler ด้านบนแล้ว)
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
}
