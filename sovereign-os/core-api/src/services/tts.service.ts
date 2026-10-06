// src/services/tts.service.ts
//
// สังเคราะห์เสียงพูดเป็น WAV buffer ให้ service อื่นใช้ (ไม่ใช่แค่ HTTP route)
//
// ดึง engine จาก /api/tts ตัวเดิม (Piper → pyttsx3) เพื่อไม่ให้มีสองที่ที่ตั้งค่าไม่ตรงกัน
// คืน null เมื่อสังเคราะห์ไม่ได้ — ผู้เรียกต้องจัดการต่อเอง (ไม่ throw)
import { spawn } from 'child_process';
import { existsSync, unlinkSync, readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { resolveTtsConfig, resolveTtsScript, spawnPythonWithFallback } from '../modules/tts/tts.routes';

// path ของสคริปต์ pyttsx3 + ลำดับ python ใช้ร่วมกับ /api/tts (resolveTtsScript —
// env TTS_SCRIPT → สคริปต์ใน image (core-api/tts/tts_speak.py) → legacy E:\ ของ dev host)

export interface SpeakOptions {
  rate?: number;
  timeoutMs?: number;
}

/** คืน WAV buffer หรือ null (เครื่อง TTS ไม่พร้อม/พัง/หมดเวลา) */
export async function synthesizeWav(text: string, opts: SpeakOptions = {}): Promise<Buffer | null> {
  const clean = String(text ?? '').trim();
  if (!clean) return null;
  const timeoutMs = opts.timeoutMs ?? 30000;
  const cfg = resolveTtsConfig();

  if (cfg.engine === 'piper' && cfg.piperExeExists && cfg.piperVoiceExists) {
    return new Promise<Buffer | null>((resolve) => {
      const outFile = path.join(os.tmpdir(), `sovereign-tts-${Date.now()}-${Math.round(process.hrtime()[1] % 100000)}.wav`);
      let settled = false;
      const finish = (val: Buffer | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          if (existsSync(outFile)) unlinkSync(outFile);
        } catch {
          /* ไฟล์เสียงค้างใน temp ไม่ใช่เรื่องคอขาดบาดตาย */
        }
        resolve(val);
      };
      const timer = setTimeout(() => {
        console.warn('[tts] Piper หมดเวลา');
        finish(null);
      }, timeoutMs);

      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(
          cfg.piperExe,
          ['--model', cfg.piperVoice, '--output_file', outFile, '--sentence_silence', '0.3'],
          { windowsHide: true }
        );
      } catch {
        return finish(null);
      }
      child.on('error', (e: any) => {
        console.error('[tts] เริ่ม Piper ไม่ได้:', e?.message);
        finish(null);
      });
      child.on('close', (code) => {
        if (settled) return;
        if (code !== 0 || !existsSync(outFile)) return finish(null);
        try {
          finish(readFileSync(outFile));
        } catch (e: any) {
          console.error('[tts] อ่านไฟล์เสียงไม่ได้:', e?.message);
          finish(null);
        }
      });
      try {
        child.stdin?.write(clean);
        child.stdin?.end();
      } catch {
        finish(null);
      }
    });
  }

  // pyttsx3 fallback
  return new Promise<Buffer | null>((resolve) => {
    let settled = false;
    const chunks: Buffer[] = [];
    const finish = (val: Buffer | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(val);
    };
    const timer = setTimeout(() => {
      console.warn('[tts] pyttsx3 หมดเวลา');
      finish(null);
    }, timeoutMs);

    spawnPythonWithFallback([resolveTtsScript(), clean, String(opts.rate ?? 180)], {
      onChild: (python) => {
        python.stdout?.on('data', (d: Buffer) => chunks.push(d));
        python.stderr?.on('data', (d) => console.error('[tts] stderr:', d.toString().slice(0, 300)));
        python.on('close', (code) => {
          if (settled) return;
          if (code !== 0) return finish(null);
          const audio = Buffer.concat(chunks);
          finish(audio.length > 0 ? audio : null);
        });
      },
      onFail: (err) => {
        console.error('[tts] เริ่ม Python ไม่ได้:', err.message);
        finish(null);
      },
    });
  });
}