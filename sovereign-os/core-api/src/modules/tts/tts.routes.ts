import { Router } from 'express';
import { spawn, type ChildProcess } from 'child_process';
import { existsSync, unlinkSync, readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();

// ── path ของสคริปต์ pyttsx3 (engine fallback) ──
// เดิม hardcode `E:\My work\...\tools\tts_speak.py` — path นี้ไม่มีอยู่ใน image
// ⇒ container spawn ไม่ได้ → ชั้นเสียงของระบบแจ้งเตือนคืน false เงียบ ๆ ตลอดกาล
// ตอนนี้สคริปต์อยู่ที่ core-api/tts/tts_speak.py ให้ `COPY . .` เอาเข้า image ด้วย

/** legacy path ของ dev host — ใช้เมื่อไม่มีที่อื่นให้เลือก */
export const LEGACY_TTS_SCRIPT = 'E:\\My work\\Project Sovereign Origin\\tools\\tts_speak.py';

/** path สัมพัทธ์ใต้ cwd ของโปรเจ็กต์ — ใน container = /app/tts/tts_speak.py */
export const TTS_SCRIPT_RELPATH = path.join('tts', 'tts_speak.py');

/**
 * หาสคริปต์ pyttsx3 — ลำดับ: `TTS_SCRIPT` env → สคริปต์ที่อยู่ใน image/project → legacy E:\
 * ใช้ร่วมกันระหว่าง tts.routes.ts กับ tts.service.ts เพราะสองที่ต้องชี้ที่เดียวกันเสมอ
 */
export function resolveTtsScript(
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd()
): string {
  const fromEnv = env.TTS_SCRIPT && env.TTS_SCRIPT.trim();
  if (fromEnv) return fromEnv as string;
  const inProject = path.resolve(cwd, TTS_SCRIPT_RELPATH);
  if (existsSync(inProject)) return inProject;
  return LEGACY_TTS_SCRIPT;
}

/**
 * ลำดับ binary python ที่จะลอง — container มีแค่ `python3` แต่ dev host Windows มีแค่ `python`
 * ⇒ ลองทีละตัวจน start ได้ (หรือให้ `PYTHON_BIN` บังคับตัวเดียว)
 */
export function pythonBinCandidates(env: Record<string, string | undefined> = process.env): string[] {
  const override = env.PYTHON_BIN && env.PYTHON_BIN.trim();
  if (override) return [override as string];
  return ['python3', 'python'];
}

export interface PythonSpawnHandlers {
  /** เรียก 1 ครั้งเมื่อมี binary start ได้จริง — ผู้เรียกค่อยผูก stdout/stderr/close */
  onChild: (child: ChildProcess) => void;
  /** เรียก 1 ครั้งเมื่อทุกตัวเลือก start ไม่ได้ — ห้ามหายเงียบ (Express 4 ไม่ส่ง error ออกจาก handler) */
  onFail: (err: Error) => void;
}

/**
 * spawn python โดยลองทีละตัวจาก `pythonBinCandidates`
 * - ใช้ event `spawn` เป็นสัญญาณว่า start จริง (ENOENT มาทาง `error` ก่อน)
 * - ถ้า start ไม่ได้สักตัว → `onFail` (ไม่ใช่ปล่อยให้ handler ค้างไม่ตอบ)
 */
export function spawnPythonWithFallback(
  args: string[],
  handlers: PythonSpawnHandlers,
  env: Record<string, string | undefined> = process.env
): void {
  const candidates = pythonBinCandidates(env);
  let index = 0;

  const tryNext = () => {
    if (index >= candidates.length) {
      handlers.onFail(new Error(`ไม่มี python ที่ start ได้: ${candidates.join(', ')}`));
      return;
    }
    const bin = candidates[index++];
    let child: ChildProcess;
    try {
      child = spawn(bin, args, { windowsHide: true });
    } catch {
      tryNext();
      return;
    }
    let started = false;
    child.once('spawn', () => {
      started = true;
      handlers.onChild(child);
    });
    child.once('error', (err) => {
      if (started) return; // start แล้วค่อยพัง = ปล่อยให้ close handler ของผู้เรียกจัดการ
      console.error(`[tts] เริ่ม ${bin} ไม่ได้: ${err.message} — ลองตัวถัดไป`);
      tryNext();
    });
  };
  tryNext();
}

// ── Piper TTS (คุณภาพเสียงสูงกว่า pyttsx3) — กะ config ผ่าน env ──
// ต้องมี: tools/piper/piper.exe (แตกจาก piper.zip) + ไฟล์เสียงภาษาไทย .onnx
// (โหลดจาก HuggingFace เช่น th_TH-pipat-medium.onnx → วางใน tools/piper/voices/)
export interface TtsConfig {
  engine: 'piper' | 'pyttsx3';
  piperExe: string;
  piperVoice: string;
  piperExeExists: boolean;
  piperVoiceExists: boolean;
}

export function resolveTtsConfig(env: Record<string, string | undefined> = process.env): TtsConfig {
  const engine = (env.TTS_ENGINE || 'pyttsx3').toLowerCase() === 'piper' ? 'piper' : 'pyttsx3';
  const piperExe =
    env.PIPER_EXE || 'E:\\My work\\Project Sovereign Origin\\tools\\piper\\piper.exe';
  const piperVoice =
    env.PIPER_VOICE || 'E:\\My work\\Project Sovereign Origin\\tools\\piper\\voices\\th_TH-pipat-medium.onnx';
  return {
    engine,
    piperExe,
    piperVoice,
    piperExeExists: existsSync(piperExe),
    piperVoiceExists: existsSync(piperVoice),
  };
}

export function piperReady(cfg: TtsConfig = resolveTtsConfig()): boolean {
  return cfg.engine === 'piper' && cfg.piperExeExists && cfg.piperVoiceExists;
}

// POST /api/tts/speak — สังเคราะห์เสียงพูดตาม engine ที่ตั้งไว้ (piper → pyttsx3 fallback)
router.post('/speak', authenticate, (req, res) => {
  const { text, rate = 180 } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'Text required' });
  }

  let responded = false;
  let timer: NodeJS.Timeout;
  const send = (fn: () => void) => {
    if (responded) return;
    responded = true;
    clearTimeout(timer);
    fn();
  };
  const fail = (status: number, message: string) => send(() => res.status(status).json({ error: message }));

  timer = setTimeout(() => fail(504, 'TTS timed out'), 30000);

  const cfg = resolveTtsConfig();

  // ── Piper ──
  if (cfg.engine === 'piper' && cfg.piperExeExists && cfg.piperVoiceExists) {
    const outFile = path.join(os.tmpdir(), `sovereign-tts-${Date.now()}.wav`);
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(
        cfg.piperExe,
        ['--model', cfg.piperVoice, '--output_file', outFile, '--sentence_silence', '0.3'],
        { windowsHide: true }
      );
    } catch {
      return fail(500, 'TTS engine unavailable');
    }
    child.on('error', (err) => {
      console.error('Failed to start Piper:', err.message);
      fail(500, 'TTS engine unavailable');
    });
    child.on('close', (code) => {
      if (responded) return;
      if (code !== 0) return fail(500, `Piper exited ${code ?? 'unknown'}`);
      if (!existsSync(outFile)) return fail(500, 'Empty audio generated');
      let audio: Buffer;
      try {
        audio = readFileSync(outFile);
        unlinkSync(outFile);
      } catch (e: any) {
        return fail(500, `Audio read failed: ${e?.message || 'unknown'}`);
      }
      send(() => {
        res.set({ 'Content-Type': 'audio/wav', 'Content-Length': audio.length, 'Cache-Control': 'no-cache' });
        res.send(audio);
      });
    });
    try {
      child.stdin?.write(String(text));
      child.stdin?.end();
    } catch {
      fail(500, 'TTS write failed');
    }
    return;
  }

  // ── pyttsx3 (fallback) ──
  if (cfg.engine === 'piper' && (!cfg.piperExeExists || !cfg.piperVoiceExists)) {
    console.warn(`[tts] Piper ได้รับเลือกแต่ไม่พร้อม (exe=${cfg.piperExeExists}, voice=${cfg.piperVoiceExists}) — ใช้ pyttsx3 แทน`);
  }

  spawnPythonWithFallback([resolveTtsScript(), String(text), String(rate)], {
    onChild: (python) => {
      const chunks: Buffer[] = [];
      python.stdout!.on('data', (data: Buffer) => chunks.push(data));
      python.stderr!.on('data', (data) => console.error('TTS stderr:', data.toString()));
      python.on('close', (code) => {
        if (responded) return;
        if (code !== 0) return fail(500, 'TTS generation failed');
        const audio = Buffer.concat(chunks);
        if (audio.length === 0) return fail(500, 'Empty audio generated');
        send(() => {
          res.set({ 'Content-Type': 'audio/wav', 'Content-Length': audio.length, 'Cache-Control': 'no-cache' });
          res.send(audio);
        });
      });
    },
    onFail: (err) => {
      console.error('Failed to start Python:', err.message);
      fail(500, 'TTS engine unavailable');
    },
  });
});

// GET /api/tts/health — สถานะ engine + ความพร้อมของ piper
router.get('/health', (_req, res) => {
  const cfg = resolveTtsConfig();
  res.json({
    status: piperReady(cfg) ? 'ok' : 'ok',
    engine: cfg.engine,
    effective: piperReady(cfg) ? 'piper' : 'pyttsx3',
    piper: {
      ready: piperReady(cfg),
      exeExists: cfg.piperExeExists,
      voiceExists: cfg.piperVoiceExists,
      exe: cfg.piperExe,
      voice: cfg.piperVoice,
    },
  });
});

export default router;
