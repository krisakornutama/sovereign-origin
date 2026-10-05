// src/runner.mjs — Agent Runner (ตัวรันงานบนเครื่องคอม)
//
// หน้าที่: ดึงงานจาก HUB ผ่าน LAN → สั่ง agent ทำ → ส่งผลกลับ
// วนไปเรื่อย ๆ จนกว่าจะหยุด
//
// หลักการ:
// - ไม่ต้องพึ่ง dependency ภายนอก (ใช้ fetch + node:child_process ที่มีใน Node)
// - executor เป็นต่องาน: เครื่องเดียวรันได้หลายชนิด ผู้ใช้เลือกโมเดลต่องานเองได้
// - งานที่พังต้องรายงานกลับเสมอ ห้ามเงียบ (ผู้ใช้เห็นสถานะตรงไปตรงมา)
// - ถ้า HUB ล่ม ต้องรอดู ไม่ crash
import { spawn } from 'node:child_process';

const DEFAULT_OPENCODE_BIN = 'opencode';
const DEFAULT_JOB_TIMEOUT_MS = 30 * 60 * 1000; // งาน agent เขียนโค้ดใช้เวลานาน

/** เครื่องนี้เปิดใช้ executor ตัวนี้ไหม */
export function supportsExecutor(enabled, executor) {
  if (!Array.isArray(enabled) || enabled.length === 0) return false;
  return enabled.map(String).includes(String(executor));
}

/**
 * แปลงงานเป็นคำสั่งที่จะรัน
 * - echo  = ทำในตัว runner เลย (ใช้ทดสอบสายตรง ไม่ต้องพึ่ง agent)
 * - opencode = spawn CLI แบบ non-interactive
 */
export function buildCommand(job, config = {}) {
  const executor = String(job?.executor ?? '');
  if (executor === 'echo') {
    return {
      kind: 'inline',
      stdout: `[${config.machineName ?? 'runner'}] echo: ${job?.prompt ?? ''}`,
    };
  }
  if (executor === 'opencode') {
    const args = ['run', '--format', 'json', '--auto'];
    if (job?.model) args.push('--model', String(job.model));
    if (job?.agent) args.push('--agent', String(job.agent));
    if (job?.workspace) args.push('--dir', String(job.workspace));
    args.push(String(job?.prompt ?? ''));
    return {
      kind: 'spawn',
      bin: config.opencodeBin || DEFAULT_OPENCODE_BIN,
      args,
      cwd: job?.workspace || undefined,
      timeoutMs: Number(job?.timeoutMs) > 0 ? Number(job.timeoutMs) : DEFAULT_JOB_TIMEOUT_MS,
    };
  }
  if (executor === 'freebuff') {
    // Freebuff เป็น desktop app ยังไม่มี headless CLI ที่เรียกได้
    // ⇒ ต้องบอกตรงๆ ว่าทำไม่ได้ ไม่เงียบทำเป็นสำเร็จ
    return { kind: 'unsupported', reason: 'freebuff desktop app ยังไม่มี headless CLI — ต้องเปิดแอปแล้วสั่งด้วยมือ หรือรอเราเพิ่มช่องทางเรียก' };
  }
  return { kind: 'unsupported', reason: `ไม่รู้จัก executor: ${executor || '(ว่าง)'}` };
}

/** อ่านผลลัพธ์แบบ JSON events ของ opencode → สรุปเป็นข้อความเดียว */
export function parseOpencodeOutput(raw) {
  const text = String(raw ?? '');
  const texts = [];
  const errors = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('{')) continue;
    let ev;
    try {
      ev = JSON.parse(trimmed);
    } catch {
      continue; // บรรทัดไม่ใช่ JSON (เช่น log ปน) — ข้าม ไม่ทำให้ทั้งงานพัง
    }
    if (ev?.type === 'text' && typeof ev.text === 'string') texts.push(ev.text);
    if (ev?.type === 'error') {
      const msg = ev?.error?.message || ev?.error?.data?.message || 'unknown error';
      errors.push(String(msg));
    }
  }
  const summary = errors.length > 0 ? errors.join(' | ') : texts.join('\n').trim() || text.trim().slice(0, 2000);
  return { summary, hadError: errors.length > 0 };
}

/** รัน job เดียว → คืนผลลัพธ์ที่พร้อมรายงานกลับ HUB */
export async function runJob(job, config = {}) {
  const cmd = buildCommand(job, config);
  if (cmd.kind === 'unsupported') {
    return { status: 'error', exitCode: null, summary: cmd.reason, logTail: cmd.reason };
  }
  if (cmd.kind === 'inline') {
    return { status: 'done', exitCode: 0, summary: cmd.stdout, logTail: cmd.stdout };
  }

  return await new Promise((resolve) => {
    let out = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    let child;
    try {
      child = spawn(cmd.bin, cmd.args, { cwd: cmd.cwd, shell: process.platform === 'win32' });
    } catch (err) {
      finish({ status: 'error', exitCode: null, summary: `spawn ไม่ได้: ${err?.message || err}`, logTail: '' });
      return;
    }

    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* ฆ่าไม่ได้ก็ปล่อย */ }
      finish({ status: 'error', exitCode: null, summary: `หมดเวลา ${cmd.timeoutMs}ms — ยกเลิกงาน`, logTail: out.slice(-2000) });
    }, cmd.timeoutMs);

    child.stdout?.on('data', (d) => { out += String(d); });
    child.stderr?.on('data', (d) => { out += String(d); });
    child.on('error', (err) => {
      finish({ status: 'error', exitCode: null, summary: `รัน ${cmd.bin} ไม่ได้: ${err?.message || err}`, logTail: out.slice(-2000) });
    });
    child.on('close', (code) => {
      const parsed = parseOpencodeOutput(out);
      finish({
        status: code === 0 && !parsed.hadError ? 'done' : 'error',
        exitCode: typeof code === 'number' ? code : null,
        summary: parsed.summary || `(ไม่มีผลลัพธ์, exit=${code})`,
        logTail: out.slice(-2000),
      });
    });
  });
}

/**
 * หนึ่งรอบของ loop: heartbeat → pull → รัน → รายงาน
 * HUB ล่ม = คืน error ให้ caller รอบหน้า (ไม่ throw ให้ process ตาย)
 */
export async function pollOnce({ hub, runner, machineName }) {
  try {
    await hub.heartbeat();
    const pulled = await hub.pullJobs();
    // HUB คืน { jobs: [...] } แต่ client บางตัวอาจคืน array ตรงๆ — รับได้ทั้งสองแบบ
    const jobs = Array.isArray(pulled) ? pulled : (pulled?.jobs ?? []);
    let dispatched = 0;
    let failed = 0;
    for (const job of jobs || []) {
      const result = await runJob(job, { ...runner, machineName: machineName ?? runner?.machineName });
      dispatched += 1;
      if (result.status !== 'done') failed += 1;
      await hub.reportResult(job.id, {
        status: result.status,
        result: result.status === 'done' ? result.summary : null,
        error: result.status === 'done' ? null : result.summary,
        exitCode: result.exitCode,
        logTail: result.logTail ?? null,
      });
    }
    return { dispatched, failed };
  } catch (err) {
    return { dispatched: 0, failed: 0, error: err?.message || String(err) };
  }
}

/** สร้าง runner ที่ start/stop ได้ — ต้องเรียก start() ถึงจะวิ่ง */
export function createRunner({ config = {}, hub, runner = {}, runOnce = null }) {
  let timer = null;
  let running = false;
  const once = runOnce || (() => pollOnce({ hub, runner, machineName: config.machineName }));
  return {
    isRunning: () => running,
    async start() {
      if (running) return;
      running = true;
      const loop = async () => {
        if (!running) return;
        const out = await once();
        if (out?.error) console.error(`[runner] ติดต่อ HUB ไม่ได้: ${out.error}`);
        if (!running) return;
        timer = setTimeout(loop, config.intervalMs ?? 15000);
      };
      await loop();
    },
    stop() {
      running = false;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}