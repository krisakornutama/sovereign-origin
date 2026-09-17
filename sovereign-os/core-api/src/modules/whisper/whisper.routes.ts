import { Router } from 'express';
import { spawn } from 'child_process';
import { unlinkSync, existsSync } from 'fs';
import { authenticate } from '../../middleware/auth.middleware';
import { hardenUpload, handledUpload } from '../../lib/harden-upload';

const router = Router();

// Multer setup — whitelist นามสกุลเสียง + ชื่อไฟล์บนดิสก์สุ่มเสมอ (ก่อนหน้า: dest ตรง ๆ และรับทุกชนิด)
const upload = hardenUpload({
  allowedExtensions: ['.wav', '.mp3', '.m4a', '.ogg', '.webm'],
  maxSizeMB: 10,
});

// Whisper paths
const WHISPER_CLI = "E:\\My work\\Project Sovereign Origin\\tools\\whisper.cpp\\build\\bin\\Release\\Release\\whisper-cli.exe";
const WHISPER_MODEL = "E:\\My work\\Project Sovereign Origin\\tools\\whisper.cpp\\models\\ggml-small.bin";

/* จุดฉีดเทส (แบบเดียวกับ visionDeps ของ documents) — เทส inject ผ่านตัวนี้เพื่อพิสูจน์วงจร
   multipart → ดิสก์จริง → CLI อ่าน → เก็บกวาด โดยไม่ต้องมี whisper-cli บนรันเนอร์
   ผู้เรียกจริงใช้ค่าดีฟอลต์ = spawn whisper-cli เหมือนเดิมทุกอย่าง */
export const whisperDeps: { run?: (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }> } = {};

function runWhisperCli(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, timeout: 30000 });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.on('error', (e) => reject(e));
    child.on('close', (code) => (code === 0 ? resolve({ stdout: out, stderr: err }) : reject(new Error(`whisper-cli exited ${code}: ${err.slice(0, 200)}`))));
  });
}

// POST /api/whisper/transcribe
router.post('/transcribe', authenticate, handledUpload(upload, 'audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file uploaded' });
    }

    const audioPath = req.file.path;
    // language ผ่านแค่ตัวอักษร a-z / - (เช่น "th", "en", "ja") — กัน shell injection เดิม
    const language = String(req.body.language || 'th').replace(/[^a-zA-Z-]/g, '').slice(0, 16) || 'th';

    // ใช้ argv array (ไม่มี shell — ค่าจาก user ไม่สามารถแทรกคำสั่งได้) — เทส inject ได้ผ่าน whisperDeps
    const run = whisperDeps.run ?? runWhisperCli;
    const { stdout, stderr } = await run(WHISPER_CLI, ['-m', WHISPER_MODEL, '-f', audioPath, '-l', language]);

    // Clean up temp file
    if (existsSync(audioPath)) {
      unlinkSync(audioPath);
    }

    // Extract last line (transcription)
    const lines = stdout.trim().split('\n');
    const text = lines[lines.length - 1] || '';

    res.json({ 
      text: text.trim(),
      success: true 
    });
  } catch (err: any) {
    console.error('Whisper error:', err.message);
    // Clean up on error
    if (req.file && existsSync(req.file.path)) {
      unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'Transcription failed', detail: err.message });
  }
});

// GET /api/whisper/health
router.get('/health', (req, res) => {
  const cliExists = existsSync(WHISPER_CLI);
  const modelExists = existsSync(WHISPER_MODEL);
  res.json({
    status: cliExists && modelExists ? 'ok' : 'error',
    whisper_cli: cliExists,
    model: modelExists
  });
});

export default router;