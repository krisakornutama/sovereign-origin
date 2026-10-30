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
import { captureScreenshot } from './screenshot.mjs';

const DEFAULT_OPENCODE_BIN = 'opencode';
const DEFAULT_JOB_TIMEOUT_MS = 30 * 60 * 1000; // งาน agent เขียนโค้ดใช้เวลานาน

/** เครื่องนี้เปิดใช้ executor ตัวนี้ไหม */
export function supportsExecutor(enabled, executor) {
  if (!Array.isArray(enabled) || enabled.length === 0) return false;
  return enabled.map(String).includes(String(executor));
}

/**
 * ตีความ CAPTURE_SCREENSHOT — เปิดเป็นค่าเริ่มต้น ปิดเมื่อสั่งชัดเท่านั้น
 * รองรับทั้ง 'false', '0', 'no', 'off' (ผู้ใช้อาจเขียนแบบไหนก็ได้)
 */
export function resolveCaptureScreenshot(raw) {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === 'false' || v === '0' || v === 'no' || v === 'off') return false;
  return true;
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
    // prompt ต้องไปทาง stdin เท่านั้น (ไม่ใช่ argv):
    // - shell:true บน Windows ต่อ args ด้วย space ดิบ ๆ ⇒ newline ใน prompt ตัดคำสั่งเหลือบรรทัดแรก
    //   (เจอจริง 30/10/69: prompt 5 บรรทัดถึง agent แค่บรรทัดแรก)
    // - opencode `run` อ่าน stdin จน EOF เมื่อ stdin ไม่ใช่ TTY
    //   (binary: process.stdin.isTTY ? undefined : await Bun.stdin.text())
    // ⇒ เขียน prompt ลง stdin แล้ว end ทันที = ครบทุกบรรทัดและไม่ค้าง
    return {
      kind: 'spawn',
      bin: config.opencodeBin || DEFAULT_OPENCODE_BIN,
      args,
      stdin: String(job?.prompt ?? ''),
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
  // รูปแบบจริงของ opencode 1.18: {"type":"text","part":{"messageID":"...","text":"..."}}
  // (ของเดิมอ่าน ev.text ซึ่งไม่มีจริง ⇒ summary กลายเป็น JSON ดิบ ผู้ใช้ไม่เห็นคำตอบ)
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
    if (ev?.type === 'text') {
      const body = typeof ev?.part?.text === 'string' ? ev.part.text : typeof ev?.text === 'string' ? ev.text : null;
      if (body != null) texts.push({ messageID: ev?.part?.messageID ?? null, text: body });
    }
    if (ev?.type === 'error') {
      const msg = ev?.error?.message || ev?.error?.data?.message || 'unknown error';
      errors.push(String(msg));
    }
  }
  if (errors.length > 0) return { summary: errors.join(' | '), hadError: true };
  // คำตอบสุดท้าย = ข้อความของ assistant message ล่าสุด (message เดียวอาจมีหลาย text part)
  const lastId = texts.length > 0 ? texts[texts.length - 1].messageID : null;
  const finalParts = lastId == null ? texts : texts.filter((t) => t.messageID === lastId);
  const summary = finalParts.map((t) => t.text).join('\n').trim() || text.trim().slice(0, 2000);
  return { summary, hadError: false };
}

/**
 * ฆ่าทั้ง process tree ของงานที่หมดเวลา
 *
 * ทำไมไม่ใช้ child.kill() เฉย ๆ: บน Windows เรา spawn ผ่าน shell (`shell: true`)
 * ⇒ child ที่ได้คือ **cmd.exe** ไม่ใช่ตัวโปรแกรมจริง — `child.kill()` จึงฆ่าแค่ cmd
 * ปล่อย `opencode.exe` รันค้างต่อ (เจอจริง 29/10/69: งาน timeout 21:31 แต่ opencode
 * ยังกิน CPU ต่ออีก 3+ ชั่วโมงบนเครื่อง 2) ⇒ ต้อง `taskkill /T /F` ฆ่าทั้งต้นไม้
 */
export function killProcessTree(child, { platform = process.platform, spawnImpl = spawn, log = () => {} } = {}) {
  const pid = child?.pid;
  if (!pid) return false;
  if (platform === 'win32') {
    try {
      const killer = spawnImpl('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer?.on?.('error', (err) => log(`taskkill ไม่สำเร็จ: ${err?.message || err}`));
      return true;
    } catch (err) {
      log(`taskkill ไม่สำเร็จ: ${err?.message || err}`);
      return false;
    }
  }
  try {
    child.kill('SIGKILL');
    return true;
  } catch (err) {
    log(`kill ไม่สำเร็จ: ${err?.message || err}`);
    return false;
  }
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
      const spawnImpl = config.spawnImpl || spawn;
      const feedStdin = typeof cmd.stdin === 'string';
      child = spawnImpl(cmd.bin, cmd.args, {
        cwd: cmd.cwd,
        shell: process.platform === 'win32',
        // prompt ไปทาง stdin (ดู buildCommand) — ต้อง end ทันที ไม่งั้น opencode รอ EOF = งานค้าง 30 นาที
        stdio: [feedStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
        // runner ทำงานเบื้องหลัง (vbs ไม่มีหน้าต่าง) — อย่าให้ cmd/opencode เด้งหน้าต่างดำขึ้นมา
        windowsHide: true,
      });
      if (feedStdin) {
        // โปรเซสลูกอาจตายก่อนอ่าน stdin (เช่นหา bin ไม่เจอ) ⇒ EPIPE ต้องไม่ทำให้ runner crash
        child.stdin?.on?.('error', () => {});
        child.stdin?.end?.(cmd.stdin);
      }
    } catch (err) {
      finish({ status: 'error', exitCode: null, summary: `spawn ไม่ได้: ${err?.message || err}`, logTail: '' });
      return;
    }

    const timer = setTimeout(() => {
      // ต้องฆ่าทั้ง tree — child.kill() บน Windows ฆ่าแค่ cmd.exe แล้วปล่อย opencode ค้างกิน CPU
      const killTree = config.killTreeImpl || killProcessTree;
      try {
        killTree(child, { spawnImpl: config.spawnImpl || spawn });
      } catch { /* ฆ่าไม่ได้ก็ปล่อย — ต้องรายงานผลให้ได้ก่อน */ }
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
 * อัปโหลดภาพหน้าจอขึ้น HUB (multipart/form-data ฟิลด์ 'file')
 *
 * ใช้ FormData/Blob ที่มีใน Node >= 20 — ไม่เพิ่ม dependency
 * ฟอร์แมตนี้ต้องตรงกับ route POST /api/agent-machines/jobs/:id/screenshot เป๊ะ
 * (ผิดจุดเดียว = ภาพไม่ถึงผู้ใช้) จึงมี e2e เทสต์กับ HTTP server จริงคุมไว้
 *
 * ⚠️ URL ต้องมี `/` ปิดท้ายเสมอ (7 ต.ค. 69 — วัดผ่าน HUB จริง):
 *   เครื่องที่ 2 ต่อ HUB ทางหน้าเว็บ :3000 (API :3001 ผูก loopback) ซึ่งเป็น Next ที่ตั้ง
 *   `trailingSlash: true` ⇒ POST ที่ไม่มี `/` ปิดท้ายโดน **308** แล้ว multipart body มาถึง
 *   ปลายทางไม่ครบ → `400 {"error":"Unexpected end of form"}` (งานจบ done แต่ภาพหายเงียบ ๆ)
 *   ยิง path ที่มี `/` ปิดท้ายตรง ๆ = 201 + ภาพขึ้นจริง ⇒ ห้ามพึ่ง redirect เด็ดขาด
 *
 * throw เมื่อไม่ ok — ให้ caller (pollOnce) จับแล้วไปต่อ ไม่ลากงานให้พัง
 */
export async function uploadScreenshot({ hubUrl, token, jobId, buffer, fetchImpl = fetch }) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'image/png' }), 'screenshot.png');
  const base = String(hubUrl ?? '').replace(/\/$/, '');
  const res = await fetchImpl(`${base}/api/agent-machines/jobs/${jobId}/screenshot/`, {
    method: 'POST',
    headers: { 'x-machine-token': token },
    body: form,
    // ถ้ามี hop ไหนพาไป 308 ให้ล้มทันที (เห็น error ชัด) ดีกว่าส่ง body ไม่ครบแล้วได้ 400 ที่ปลายทาง
    redirect: 'error',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`screenshot -> HTTP ${res.status} ${text.slice(0, 120)}`);
  }
  return await res.json();
}

/**
 * หนึ่งรอบของ loop: heartbeat → pull → รัน → รายงาน
 * HUB ล่ม = คืน error ให้ caller รอบหน้า (ไม่ throw ให้ process ตาย)
 */
export async function pollOnce({ hub, runner, machineName, heartbeatSec = 30 }) {
  try {
    await hub.heartbeat();
    const pulled = await hub.pullJobs();
    // HUB คืน { jobs: [...] } แต่ client บางตัวอาจคืน array ตรงๆ — รับได้ทั้งสองแบบ
    const jobs = Array.isArray(pulled) ? pulled : (pulled?.jobs ?? []);
    // งาน AI ยาวได้ถึง 30 นาที — ระหว่างนั้นต้องส่ง heartbeat ต่อเนื่อง
    // ไม่งั้น HUB ตัดเป็น offline ระหว่างทำงาน (เจอจริง 29/10/69: งาน opencode ค้าง 13 นาที = เครื่องหายจากหน้าเว็บ)
    const hbMs = Math.max(250, Number(heartbeatSec || 30) * 1000);
    const hbTimer = setInterval(() => {
      Promise.resolve(hub.heartbeat()).catch(() => {});
    }, hbMs);
    hbTimer.unref?.();
    try {
      let dispatched = 0;
      let failed = 0;
      for (const job of jobs || []) {
        const result = await runJob(job, { ...runner, machineName: machineName ?? runner?.machineName });
        dispatched += 1;
        if (result.status !== 'done') failed += 1;
        // ภาพหน้าจอตอนจบงาน — จับ/ส่งไม่สำเร็จต้องไม่ทำให้งานที่สำเร็จกลายเป็น error
        let screenshotUrl = null;
        if (runner?.captureScreenshot && hub.uploadScreenshot) {
          try {
            const shot = await (runner.capture ?? captureScreenshot)();
            if (shot) {
              const up = await hub.uploadScreenshot(job.id, shot);
              screenshotUrl = up?.screenshotUrl ?? null;
            }
          } catch (err) {
            console.error(`[runner] ส่งภาพหน้าจอไม่สำเร็จ: ${err?.message || err}`);
          }
        }
        await hub.reportResult(job.id, {
          status: result.status,
          result: result.status === 'done' ? result.summary : null,
          error: result.status === 'done' ? null : result.summary,
          exitCode: result.exitCode,
          logTail: result.logTail ?? null,
          screenshotUrl,
        });
      }
      return { dispatched, failed };
    } finally {
      clearInterval(hbTimer);
    }
  } catch (err) {
    return { dispatched: 0, failed: 0, error: err?.message || String(err) };
  }
}

/** สร้าง runner ที่ start/stop ได้ — ต้องเรียก start() ถึงจะวิ่ง */
export function createRunner({ config = {}, hub, runner = {}, runOnce = null }) {
  let timer = null;
  let running = false;
  const once = runOnce || (() => pollOnce({ hub, runner, machineName: config.machineName, heartbeatSec: config.heartbeatSec }));
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