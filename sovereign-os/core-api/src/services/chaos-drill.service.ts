import fs from 'fs';
import path from 'path';
import os from 'os';
import net from 'net';
import { PrismaClient } from '@prisma/client';
import { config } from '../config';
import { securityStream } from './security-stream.service';
import { idsReader } from './ids-reader.service';
import { threatIntel } from './threat-intel.service';
import { aiAnalyst } from './ai-analyst.service';
import { timeConsensus } from './time-consensus.service';
import { saveJsonAtomic, readJsonVerified } from './data-integrity.service';
import { BACKUP_DIR } from './backup.service';

const prisma = new PrismaClient();

// ── Chaos Drill (Antifragility Paradox) ──
// ซ้อมวิกฤตตามกำหนด: ตรวจ self-check ว่าโครงสร้างพื้นฐานสำคัญพร้อมรับแรงกระแทก
// หรือไม่ — เรียกด้วย POST /api/security/nextgen/drill (SUPERADMIN) เป็นประจำ
// บันทึกผลล่าสุดใน data/chaos-drill-last.json + ส่ง event ไป real-time stream

export interface DrillCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DrillReport {
  at: string;
  passed: number;
  total: number;
  checks: DrillCheck[];
  verdict: 'PASS' | 'DEGRADED' | 'FAIL';
}

const REPORT_FILE =
  process.env.CHAOS_DRILL_FILE || path.resolve(process.cwd(), 'data', 'chaos-drill-last.json');

function saveReport(report: DrillReport) {
  saveJsonAtomic(REPORT_FILE, report);
}

export async function runChaosDrill(): Promise<DrillReport> {
  const checks: DrillCheck[] = [];

  // 1) Database reachable
  try {
    const n = await prisma.user.count();
    checks.push({ name: 'database', ok: true, detail: `users=${n} (query ok)` });
  } catch (err: any) {
    checks.push({ name: 'database', ok: false, detail: err?.message || 'query failed' });
  }

  // 2) MQTT broker (EMQX) — เช็คผ่าน TCP connect
  try {
    const host = config.mqtt?.host || process.env.MQTT_HOST || 'localhost';
    const port = config.mqtt?.port || Number(process.env.MQTT_PORT || 1883);
    const tcp = await new Promise<boolean>((resolve) => {
      const sock = net.connect({ host, port, timeout: 3000 }, () => {
        sock.destroy();
        resolve(true);
      });
      sock.on('error', () => {
        sock.destroy();
        resolve(false);
      });
      sock.on('timeout', () => {
        sock.destroy();
        resolve(false);
      });
    });
    checks.push({ name: 'mqtt-broker', ok: tcp, detail: tcp ? `${host}:${port} reachable` : `${host}:${port} unreachable` });
  } catch (err: any) {
    checks.push({ name: 'mqtt-broker', ok: false, detail: err?.message || 'connect failed' });
  }

  // 3) Backup เมื่อเร็ว ๆ นี้ (ภายใน 72 ชม.) — ตรวจที่ BACKUP_DIR จริง (ไม่ใช่ data/backups)
  try {
    const dir = BACKUP_DIR;
    let newest = 0;
    if (fs.existsSync(dir)) {
      newest = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.sql.gz') || f.endsWith('.json.gz'))
        .map((f) => fs.statSync(path.join(dir, f)).mtimeMs)
        .reduce((a, b) => Math.max(a, b), 0);
    }
    const fresh = newest > 0 && Date.now() - newest < 72 * 3600 * 1000;
    checks.push({
      name: 'backup-freshness',
      ok: fresh,
      detail: newest ? `backup ล่าสุด ${new Date(newest).toLocaleString('th-TH')}` : 'ยังไม่มี backup',
    });
  } catch (err: any) {
    checks.push({ name: 'backup-freshness', ok: false, detail: err?.message || 'cannot stat backups' });
  }

  // 4) Threat Intel ฐานพร้อม
  try {
    const st = await threatIntel.stats();
    checks.push({ name: 'threat-intel', ok: st.total > 0, detail: `${st.total} IOC ในฐาน` });
  } catch (err: any) {
    checks.push({ name: 'threat-intel', ok: false, detail: err?.message || 'stats failed' });
  }

  // 5) IDS reader config
  const ids = idsReader.stats();
  const idsStats = ids instanceof Promise ? await ids : ids;
  const idsCfg = await Promise.resolve(idsStats);
  checks.push({
    name: 'ids-reader',
    ok: !idsCfg.configured || idsCfg.fileExists,
    detail: idsCfg.configured ? (idsCfg.fileExists ? `ติดตาม ${idsCfg.lastError ? 'error: ' + idsCfg.lastError : 'ปกติ'} (offset ${idsCfg.offset})` : 'config แล้วแต่ยังไม่มีไฟล์ eve.json') : 'ปิด (ไม่ได้ config)',
  });

  // 6) AI Analyst (Ollama) — ถ้า enabled
  if (config.nextgen.aiAnalystEnabled) {
    const last = await aiAnalyst.last();
    checks.push({
      name: 'ai-analyst',
      ok: !!last,
      detail: last ? `รายงานล่าสุด ${new Date(last.generatedAt).toLocaleString('th-TH')}` : 'ยังไม่เคยวิเคราะห์สำเร็จ',
    });
  }

  // 7) ระบบ uptime / resource
  const mem = process.memoryUsage();
  checks.push({
    name: 'core-api-uptime',
    ok: true,
    detail: `uptime ${Math.floor(process.uptime() / 60)} นาที · RSS ${(mem.rss / 1024 / 1024).toFixed(0)}MB · host ${os.hostname()}`,
  });

  // 8) Time-Consensus (Phase 6 — Byzantine Time Drift & NTP Poisoning)
  try {
    const ts = timeConsensus.status();
    if (ts.lastCheckAt === null) await timeConsensus.check();
    const nowStatus = timeConsensus.status();
    const recentAnomalies = (nowStatus.anomalies ?? []).filter(
      (a: any) => Date.now() - new Date(a.at).getTime() < 24 * 3600 * 1000
    ).length;
    checks.push({
      name: 'time-consensus',
      ok: recentAnomalies === 0,
      detail: recentAnomalies === 0
        ? `เวลาเสถียร (checks=${nowStatus.checks} · DB desync ${nowStatus.dbDesyncMs} ms)`
        : `พบ ${recentAnomalies} anomaly ภายใน 24 ชม. (jumps=${nowStatus.jumps}) — ตรวจ RTC/NTP`,
    });
  } catch (err: any) {
    checks.push({ name: 'time-consensus', ok: false, detail: err?.message || 'time check failed' });
  }

  // 9) Storage Write-Budget (Phase 6 — NAND Flash Exhaustion)
  try {
    const rows: { c: bigint }[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) AS c FROM sensor_telemetry WHERE time > NOW() - INTERVAL '1 hour'`
    );
    const perHour = Number(rows[0]?.c ?? 0);
    const perDay = perHour * 24;
    const bytesPerDay = perDay * 100; // ~100 B/row (เวลา+uuid+metric+value+index)
    const tbwPerYear = (bytesPerDay * 365) / 1e12;
    const ssdTbw = config.storage?.ssdTbw ?? 150;
    const estYears = tbwPerYear > 0 ? ssdTbw / tbwPerYear : Infinity;
    const ok = estYears >= 5;
    checks.push({
      name: 'storage-write-budget',
      ok,
      detail: ok
        ? `${perDay.toLocaleString()} rows/วัน · ~${tbwPerYear.toFixed(3)} TBW/ปี · SSD ${ssdTbw} TBW → อายุ ${estYears === Infinity ? '∞' : estYears.toFixed(1)} ปี (OK)`
        : `${perDay.toLocaleString()} rows/วัน · ~${tbwPerYear.toFixed(3)} TBW/ปี · อายุประมาณ ${estYears.toFixed(1)} ปี (< 5 ปี) — ย้าย telemetry ไป RAMDisk/Redis`,
    });
  } catch (err: any) {
    checks.push({ name: 'storage-write-budget', ok: false, detail: err?.message || 'write-budget query failed' });
  }

  const passed = checks.filter((c) => c.ok).length;
  const verdict = passed === checks.length ? 'PASS' : passed >= checks.length / 2 ? 'DEGRADED' : 'FAIL';
  const report: DrillReport = { at: new Date().toISOString(), passed, total: checks.length, checks, verdict };
  saveReport(report);
  securityStream.push('DRILL', { verdict, passed, total: checks.length, at: report.at });
  return report;
}

export function lastDrillReport(): DrillReport | null {
  const { data } = readJsonVerified<DrillReport>(REPORT_FILE);
  return data;
}