import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { prisma } from '../lib/prisma';
import { securityStream } from './security-stream.service';

// ── Lite AV: SHA-256 Checksum Engine (แทน ClamAV daemon) ──
// On-demand เท่านั้น — ไม่มี daemon/daemon TCP → RAM 0MB ตอน idle
// หลัก:
// 1) Strict size limit (กัน OOM)
// 2) MIME sniff ด้วย magic bytes (กันไฟล์แฝงนามสกุล) — executable ห้ามเด็ดขาด
// 3) SHA-256 checksum → เทียบฐาน Threat Intel (type=FILE) + EICAR self-test
// 4) สงสัย → Quarantine ไป data/quarantine + securityEvent MALWARE_DETECTED + SSE

export { prisma };

export const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
export const MAX_SCAN_BYTES = 25 * 1024 * 1024; // 25 MB

export const QUARANTINE_DIR = process.env.HASH_QUARANTINE_DIR || path.resolve(process.cwd(), 'data', 'quarantine');

export type ScanVerdict = 'clean' | 'malware' | 'rejected';

export interface HashScanResult {
  ok: boolean;
  verdict: ScanVerdict;
  hash: string | null;
  mimeType: string | null;
  size: number;
  error?: string;
  quarantinedTo?: string | null;
  elapsedMs: number;
}

/** ไฟล์ text? — ตรวจสัดส่วนไบต์ที่อ่านได้ (กัน binary ปลอมเป็น .txt) */
function looksLikeText(buf: Buffer): boolean {
  if (buf.length === 0) return false;
  const sample = buf.subarray(0, Math.min(buf.length, 8192));
  let printable = 0;
  for (const b of sample) {
    if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127) || b >= 128) printable++; // 128+ = UTF-8 multibyte (ไทย)
  }
  return printable / sample.length >= 0.98; // ≥98% อ่านได้ — binary ตัวจริงมีไบต์ต่ำเยอะ
}

// ── MIME sniff: magic bytes — กัน .jpg แต่ข้างในเป็น exe ──

export function sniffMime(buf: Buffer): string | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 6 && (buf.subarray(0, 6).toString('ascii') === 'GIF87a' || buf.subarray(0, 6).toString('ascii') === 'GIF89a')) return 'image/gif';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buf.length >= 5 && buf.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (buf.length >= 4 && buf.subarray(0, 4).toString('ascii') === '\x7fELF') return 'application/x-executable';
  if (buf.length >= 2 && buf.subarray(0, 2).toString('ascii') === 'MZ') return 'application/x-dosexec';
  if (buf.length >= 5 && buf.subarray(0, 5).toString('ascii') === '{\"msg') return 'application/json';
  if (looksLikeText(buf)) return 'text/plain'; // .txt/.md/.log — ไม่มี magic bytes แต่เนื้อหาเป็นข้อความ
  return null;
}

/** นโยบายไฟล์ที่ยอมรับ — executable ต้องห้ามทุกกรณี */
export function policyVerdict(mime: string | null): { verdict: ScanVerdict; error?: string } {
  if (mime === 'application/x-executable' || mime === 'application/x-dosexec') {
    return { verdict: 'rejected', error: 'ไฟล์ executable ถูกปฏิเสธ (นโยบาย Lite Security)' };
  }
  if (!mime) return { verdict: 'rejected', error: 'ไม่รู้จักประเภทไฟล์ (magic bytes ไม่ตรง) — ปฏิเสธ' };
  return { verdict: 'clean' };
}

function sha256(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

class HashEngineService {
  private scans = 0;
  private detections = 0;
  private quarantined = 0;
  private startedAt = Date.now();
  private lastScanAt: Date | null = null;
  private lastError: string | null = null;

  async scanBuffer(data: Buffer, meta?: { originalName?: string }): Promise<HashScanResult> {
    const started = Date.now();
    this.lastError = null;
    if (!Buffer.isBuffer(data) || data.length === 0) {
      return { ok: false, verdict: 'rejected', hash: null, mimeType: null, size: 0, error: 'ไฟล์ว่าง (0 byte)', elapsedMs: 0 };
    }
    if (data.length > MAX_SCAN_BYTES) {
      return { ok: false, verdict: 'rejected', hash: null, mimeType: null, size: data.length, error: `ไฟล์ใหญ่เกิน ${Math.round(MAX_SCAN_BYTES / 1024 / 1024)} MB`, elapsedMs: 0 };
    }

    const mime = sniffMime(data);

    // EICAR self-test (มาตรฐาน AV — ทดสอบว่า engine ทำงาน) — ตรวจก่อน policy (เป็นเนื้อหา ไม่ใช่ MIME)
    if (data.toString('latin1').includes(EICAR)) {
      this.detections++;
      this.lastScanAt = new Date();
      const hash = sha256(data);
      await this.quarantine(data, hash, meta?.originalName, mime, 'EICAR test signature พบในไฟล์');
      return { ok: false, verdict: 'malware', hash, mimeType: mime, size: data.length, error: 'EICAR test signature', quarantinedTo: this.lastQuarantinedTo, elapsedMs: Date.now() - started };
    }

    const policy = policyVerdict(mime);
    if (policy.verdict !== 'clean') {
      this.detections++;
      this.lastScanAt = new Date();
      const hash = sha256(data);
      await this.quarantine(data, hash, meta?.originalName, mime, policy.error);
      return { ok: false, verdict: policy.verdict, hash, mimeType: mime, size: data.length, error: policy.error, quarantinedTo: this.lastQuarantinedTo, elapsedMs: Date.now() - started };
    }

    // SHA-256 → เทียบ Threat Intel (type=FILE)
    const hash = sha256(data);
    try {
      const known = await prisma.threatIntelItem.findFirst({ where: { type: 'FILE', value: hash, active: true } });
      if (known) {
        this.detections++;
        this.lastScanAt = new Date();
        await this.quarantine(data, hash, meta?.originalName, mime, `Threat Intel FILE hit (${known.category})`);
        return { ok: false, verdict: 'malware', hash, mimeType: mime, size: data.length, error: `Threat Intel FILE hit (${known.category})`, quarantinedTo: this.lastQuarantinedTo, elapsedMs: Date.now() - started };
      }
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
    }

    this.scans++;
    this.lastScanAt = new Date();
    return { ok: true, verdict: 'clean', hash, mimeType: mime, size: data.length, elapsedMs: Date.now() - started };
  }

  private lastQuarantinedTo: string | null = null;

  /** กักกันไฟล์: เขียนไป QUARANTINE_DIR + securityEvent + SSE */
  private async quarantine(data: Buffer, hash: string, originalName: string | undefined, mime: string | null, reason: string | undefined): Promise<void> {
    this.lastQuarantinedTo = null;
    const why = reason || 'policy violation';
    try {
      const ext = path.extname(originalName || '').slice(0, 10) || '.bin';
      const dest = path.join(QUARANTINE_DIR, `${hash}${ext}`);
      fs.mkdirSync(QUARANTINE_DIR, { recursive: true });
      fs.writeFileSync(dest, data);
      this.quarantined++;
      this.lastQuarantinedTo = dest;
      securityStream.push('MALWARE_DETECTED', { hash, mime, reason: why, quarantinedTo: dest, fileName: originalName || null });
      await prisma.securityEvent.create({
        data: {
          event_type: 'MALWARE_DETECTED',
          severity: 'critical',
          description: `🦠 MALWARE: ${why} (sha256: ${hash.slice(0, 16)}…${hash.slice(-8)})${originalName ? ` — ${originalName}` : ''} → กักกัน ${dest}`,
          raw_data: { hash, mime, reason: why, fileName: originalName || null, quarantinedTo: dest },
        },
      });
    } catch (err) {
      this.lastError = `quarantine ล้มเหลว: ${err instanceof Error ? err.message : String(err)}`;
      console.error('Quarantine error:', this.lastError);
    }
  }

  status(): Record<string, unknown> {
    return {
      engine: 'sha256-lite',
      mode: 'on-demand',
      hash: 'sha256',
      mimePolicy: 'strict-magic-bytes',
      maxScanBytes: MAX_SCAN_BYTES,
      scans: this.scans,
      detections: this.detections,
      quarantined: this.quarantined,
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
      lastScanAt: this.lastScanAt,
      lastError: this.lastError,
      daemon: null, // ไม่มี daemon — RAM 0 MB ตอน idle
    };
  }
}

export const hashEngine = new HashEngineService();