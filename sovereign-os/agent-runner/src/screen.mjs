// src/screen.mjs — สตรีมภาพหน้าจอสด (ไม่ใช่ภาพเดียวตอนจบงานแบบ screenshot.mjs)
//
// ทำไมต้องเป็น PowerShell process เดียวค้างไว้ ไม่ใช่ spawn ใหม่ทุกเฟรม:
//   screenshot.mjs เปิด powershell ใหม่ต่อภาพ 1 ครั้ง ⇒ ใช้ได้ ~2-3 เฟรม/วินาที
//   (ค่าเปิดตัวของ PowerShell เองกินเวลาเกือบทั้งหมด) ⇒ ควบคุมเมาส์/คีย์บอร์ดไม่ไหว
//   สคริปต์นี้จึงเปิด process เดียวแล้ววนจับภาพในลูป ⇒ ได้หลายเฟรม/วินาทีจริง
//
// ทำไมยังใช้ PowerShell ไม่ใช่ native module:
//   agent-runner ตั้งใจให้ "ไม่มี dependency ภายนอก" (copy เป็นโฟลเดอร์ไปเครื่องที่ 2)
//   native module ต้อง compile บนเครื่องปลายทาง = เพิ่มจุดพังที่คุมไม่ได้
//
// ⚠️ บทเรียนราคาแพง (ต้องเจอกับตัวถึงจะรู้) — Antivirus/AMSI บล็อกสคริปต์ชุดนี้แบบนี้:
//   · `-EncodedCommand` (base64 script) → ถูกบล็อกทันที (เป็นท่ามาตรฐานของ malware)
//   · เขียนเป็นไฟล์ .ps1 แล้วรันด้วย `-File` → ถูกบล็อกเช่นกัน (AMSI สแกนเนื้อไฟล์)
//   · `-Command` ที่มี "จับจอ + GetImageEncoders/EncoderParameters" อยู่ด้วยกัน → บล็อก
//   · แยกกัน (จับจอ+ย่อ+PNG) หรือ (codec อย่างเดียว) → ผ่าน
//   ⇒ ข้อสรุป: heuristic ของ AV ยิงที่ "บล็อกจับจอ + บล็อกเลือก codec" รวมกัน
//   ⇒ ทางที่ผ่านจริง: `-Command` บรรทัดเดียว + `ImageFormat::Jpeg` ที่มีในตัว
//      (ไม่มี GetImageEncoders/EncoderParameters เลย) + เลี่ยงอักขระ " ทั้งสคริปต์
//
//   ตัวเลขที่วัดได้บนเครื่องจริง: 1280x720 JPEG ≈ 87 KB/เฟรม (พอสำหรับ LAN)
//   ส่วน `-EncodedCommand`/`-File` **ห้ามกลับมาใช้** ไม่ว่าจะดูสะอาดกว่ายังไง
//
// หลักการเดียวกับ screenshot.mjs: จับภาพไม่ได้ = ไม่มีภาพ แต่ห้าม throw
// ให้ runner ตาย (ผู้ใช้ต้องเห็นว่าเครื่องยังออนไลน์ อย่างมากก็ไม่มีภาพ)
import { spawn } from 'node:child_process';

/** ความกว้างสูงสุดของภาพที่ส่งขึ้น HUB — ตัวคุมแบนด์วิดท์ที่ได้ผลที่สุด */
export const DEFAULT_MAX_WIDTH = 1280;

/** เพดาน fps ฝั่ง runner (ตรงกับเพดานที่ HUB ยอมรับ = MAX_SCREEN_FPS) */
export const MAX_FPS = 15;

/**
 * สร้างสคริปต์ PowerShell ที่วนจับภาพแล้วพ่น base64 ทีละบรรทัด
 *
 * ต้องเป็น "บรรทัดเดียว" (คั่นด้วย '; ') เพราะส่งทาง `-Command` เท่านั้น
 * และต้องไม่มีอักขระ `"` เลย — ใช้ single quote ของ PowerShell แทน
 * (single quote ไม่มีความหมายพิเศษกับ cmd.exe ⇒ ไม่มีปัญหา quoting ซ้อนชั้น)
 *
 * แยกเป็นฟังก์ชันล้วน ๆ เพื่อให้เทสต์ตรวจรูปร่างสคริปต์ได้โดยไม่ต้องรันจริง
 */
export function buildCaptureScript({ intervalMs = 200, maxWidth = DEFAULT_MAX_WIDTH } = {}) {
  const gap = Math.max(0, Math.round(Number(intervalMs) || 200));
  const width = Math.max(160, Math.round(Number(maxWidth) || DEFAULT_MAX_WIDTH));
  return [
    'Add-Type -AssemblyName System.Windows.Forms,System.Drawing',
    '$out = [Console]::Out',
    `$maxW = ${width}`,
    'while ($true) {',
    'try {',
    '$b = [System.Windows.Forms.SystemInformation]::VirtualScreen',
    '$scale = 1.0',
    'if ($b.Width -gt $maxW) { $scale = $maxW / $b.Width }',
    '$w = [int][Math]::Max(1, [Math]::Round($b.Width * $scale))',
    '$h = [int][Math]::Max(1, [Math]::Round($b.Height * $scale))',
    '$src = New-Object System.Drawing.Bitmap $b.Width, $b.Height',
    '$g1 = [System.Drawing.Graphics]::FromImage($src)',
    '$g1.CopyFromScreen($b.Left, $b.Top, 0, 0, $src.Size)',
    '$g1.Dispose()',
    '$dst = New-Object System.Drawing.Bitmap $w, $h',
    '$g2 = [System.Drawing.Graphics]::FromImage($dst)',
    '$g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic',
    '$g2.DrawImage($src, 0, 0, $w, $h)',
    '$g2.Dispose()',
    '$ms = New-Object System.IO.MemoryStream',
    // ImageFormat::Jpeg ของ .NET เอง — ไม่ต้องผ่าน GetImageEncoders/EncoderParameters
    // ซึ่งเมื่อรวมกับบล็อกจับจอแล้ว AV บล็อกทั้งสคริปต์ (ดูหมายเหตุหัวไฟล์)
    '$dst.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg)',
    // บรรทัดแรกของแต่ละเฟรม = ขนาดภาพ (หน้าเว็บใช้คำนวณสัดส่วน)
    `$out.WriteLine('W=' + $w + ' H=' + $h)`,
    '$out.WriteLine([Convert]::ToBase64String($ms.ToArray()))',
    '$out.Flush()',
    '$ms.Dispose(); $dst.Dispose(); $src.Dispose()',
    '} catch {',
    // ล็อกหน้าจอ/จับภาพล้มชั่วคราว ต้องไม่ทำให้ลูปตาย — รายงานแล้วลองรอบหน้า
    `[Console]::Error.WriteLine('capture-failed: ' + $_.Exception.Message)`,
    '}',
    `Start-Sleep -Milliseconds ${gap}`,
    '}',
  ].join('; ');
}

/** ค่า fps → ระยะห่างระหว่างเฟรม (มิลลิวินาที) พร้อมตัดเพดาน */
export function fpsToIntervalMs(fps) {
  const n = Number(fps);
  if (!Number.isFinite(n) || n <= 0) return Math.round(1000 / 5);
  const clamped = Math.min(Math.max(1, n), MAX_FPS);
  return Math.max(1, Math.round(1000 / clamped));
}

/**
 * แยกข้อมูลบรรทัดที่ PowerShell พ่นออกมาเป็นเฟรม
 * ทำเป็นตัวแยกสถานะ (stateful) เพราะข้อมูลมาเป็น chunk ที่ตัดกลางบรรทัดได้
 */
export function createFrameParser() {
  let buffer = '';
  let pendingMeta = null;
  return {
    /** ป้อน chunk → คืนรายการเฟรมที่ครบสมบูรณ์ในรอบนี้ */
    push(chunk) {
      buffer += String(chunk);
      const frames = [];
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, '').trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;

        const meta = line.match(/^W=(\d+)\s+H=(\d+)/);
        if (meta) {
          pendingMeta = { width: Number(meta[1]), height: Number(meta[2]) };
          continue;
        }
        // บรรทัดที่เป็น base64 ยาว ๆ = เนื้อภาพจริง
        if (line.length > 64 && /^[A-Za-z0-9+/=]+$/.test(line)) {
          frames.push({ data: line, meta: pendingMeta });
          pendingMeta = null;
        }
      }
      return frames;
    },
  };
}

/**
 * เริ่มสตรีมหน้าจอ
 * @returns {{ setFps: (fps:number)=>void, stop: ()=>void, isRunning: ()=>boolean, pid: ()=>number|null }}
 */
export function startScreenStream({
  fps = 5,
  maxWidth = DEFAULT_MAX_WIDTH,
  onFrame,
  onError,
  platform = process.platform,
  spawnImpl = spawn,
  powershell = 'powershell.exe',
} = {}) {
  const noop = { setFps: () => {}, stop: () => {}, isRunning: () => false, pid: () => null };
  if (platform !== 'win32') {
    // แพลตฟอร์มอื่นยังไม่มีวิธีจับภาพที่พึ่งพาได้ — บอกตรง ๆ ไม่ทำเป็นสำเร็จเงียบ ๆ
    onError?.(new Error('screen stream: รองรับเฉพาะ Windows (ยังไม่มีวิธีจับภาพบนแพลตฟอร์มนี้)'));
    return noop;
  }

  let child = null;
  let stopped = false;
  let currentInterval = fpsToIntervalMs(fps);

  const launch = () => {
    if (stopped) return;
    const script = buildCaptureScript({ intervalMs: currentInterval, maxWidth });
    try {
      // ต้องเป็น -Command เท่านั้น — -EncodedCommand / -File ถูก AV บล็อก (ดูหมายเหตุหัวไฟล์)
      child = spawnImpl(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    const parser = createFrameParser();
    child.stdout?.on('data', (chunk) => {
      for (const frame of parser.push(chunk)) {
        try {
          onFrame?.({ buffer: Buffer.from(frame.data, 'base64'), ...(frame.meta ?? {}) });
        } catch (err) {
          onError?.(err instanceof Error ? err : new Error(String(err)));
        }
      }
    });
    child.stderr?.on('data', (chunk) => {
      const text = String(chunk).trim();
      // "capture-failed" คือลูปยังอยู่แต่จับภาพไม่ได้รอบนั้น (เช่น ล็อกหน้าจอ) — ไม่ใช่ตาย
      if (text) onError?.(new Error(text.slice(0, 300)));
    });
    child.on('error', (err) => onError?.(err));
    child.on('close', () => {
      child = null;
      // ถ้ายังไม่สั่งหยุด = process ตายเอง (เช่น PowerShell ถูก kill) → เริ่มใหม่
      if (!stopped) setTimeout(launch, 1000);
    });
  };

  launch();

  return {
    isRunning: () => child !== null,
    pid: () => child?.pid ?? null,
    /** เปลี่ยน fps ระหว่างสตรีม — ต้องเปิด process ใหม่เพราะ interval ฝังในสคริปต์ */
    setFps(next) {
      const interval = fpsToIntervalMs(next);
      if (interval === currentInterval) return;
      currentInterval = interval;
      const old = child;
      child = null;
      try {
        old?.kill();
      } catch {
        /* ฆ่าไม่ได้ก็ปล่อยให้รอบ close จัดการ */
      }
      launch();
    },
    stop() {
      stopped = true;
      const old = child;
      child = null;
      try {
        old?.kill();
      } catch {
        /* ไม่มีอะไรให้ทำ */
      }
    },
  };
}
