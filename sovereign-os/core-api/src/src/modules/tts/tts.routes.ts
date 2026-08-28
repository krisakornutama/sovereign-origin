import { Router } from 'express';
import { spawn } from 'child_process';
import { existsSync, unlinkSync, readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();

// Python TTS script path (engine: pyttsx3)
const TTS_SCRIPT = "E:\\My work\\Project Sovereign Origin\\tools\\tts_speak.py";

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

  let python: ReturnType<typeof spawn>;
  try {
    python = spawn('python', [TTS_SCRIPT, text, String(rate)]);
  } catch {
    return fail(500, 'TTS engine unavailable');
  }

  const chunks: Buffer[] = [];
  python.stdout!.on('data', (data: Buffer) => chunks.push(data));
  python.stderr!.on('data', (data) => console.error('TTS stderr:', data.toString()));
  python.on('error', (err) => {
    console.error('Failed to start Python:', err.message);
    fail(500, 'TTS engine unavailable');
  });
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
