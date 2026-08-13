import { Router } from 'express';
import { spawn } from 'child_process';
import { unlinkSync, existsSync } from 'fs';
import { authenticate } from '../../middleware/auth.middleware';
import multer from 'multer';
import path from 'path';
import os from 'os';

const router = Router();

// Multer setup
const upload = multer({ 
  dest: os.tmpdir(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// Whisper paths
const WHISPER_CLI = "E:\\My work\\Project Sovereign Origin\\tools\\whisper.cpp\\build\\bin\\Release\\Release\\whisper-cli.exe";
const WHISPER_MODEL = "E:\\My work\\Project Sovereign Origin\\tools\\whisper.cpp\\models\\ggml-small.bin";

// POST /api/whisper/transcribe
router.post('/transcribe', authenticate, upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file uploaded' });
    }

    const audioPath = req.file.path;
    // language ผ่านแค่ตัวอักษร a-z / - (เช่น "th", "en", "ja") — กัน shell injection เดิม
    const language = String(req.body.language || 'th').replace(/[^a-zA-Z-]/g, '').slice(0, 16) || 'th';

    // ใช้ spawn + argv array (ไม่มี shell — ค่าจาก user ไม่สามารถแทรกคำสั่งได้)
    const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(
        WHISPER_CLI,
        ['-m', WHISPER_MODEL, '-f', audioPath, '-l', language],
        { windowsHide: true, timeout: 30000 }
      );
      let out = '';
      let err = '';
      child.stdout.on('data', (d: Buffer) => (out += d.toString()));
      child.stderr.on('data', (d: Buffer) => (err += d.toString()));
      child.on('error', (e) => reject(e));
      child.on('close', (code) => (code === 0 ? resolve({ stdout: out, stderr: err }) : reject(new Error(`whisper-cli exited ${code}: ${err.slice(0, 200)}`))));
    });

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