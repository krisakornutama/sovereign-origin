import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { prisma } from '../lib/prisma';
import { securityStream } from './security-stream.service';


// ── Data Integrity Guard (Bit Rot — ภัยที่ 3: NAND Flash Exhaustion & Silent Bit Rot) ──
// ไฟล์ state ทั้งหมดของระบบเขียนด้วย checksum sidecar (.sha256)
//  - ตรวจจับ bit rot: ค่าในไฟล์เพี้ยนเงียบ ๆ โดย OS ไม่รู้ (0→1) — ตอนโหลดจะจับได้ทันที
//  - ตรวจทุกสัปดาห์: ไฟล์ไหนเพี้ยน → securityEvent BIT_ROT + สำรองไฟล์เสียไว้วิเคราะห์
//  - ไฟล์ที่ยังไม่มี sidecar (ของเก่า) → สร้าง baseline ให้อัตโนมัติตอนตรวจ

export function sha256(content: Buffer | string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/** เขียน JSON แบบ atomic (tmp + rename) พร้อม sidecar checksum — กันไฟล์ครึ่งใบ + bit rot */
export function saveJsonAtomic(file: string, data: unknown): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    const body = JSON.stringify(data, null, 2);
    fs.writeFileSync(tmp, body, 'utf8');
    fs.writeFileSync(`${file}.sha256`, sha256(body), 'utf8');
    fs.renameSync(tmp, file);
  } catch (err) {
    console.error('Atomic save error:', file, err instanceof Error ? err.message : err);
  }
}

/**
 * อ่าน JSON + ตรวจ checksum — ถ้าไม่ตรง = bit rot/แก้มือ
 * คืน { ok, data, rot: boolean } — rot=true เมื่อ checksum ไม่ตรง (caller ตัดสินใจใช้ fallback)
 */
export function readJsonVerified<T>(file: string): { ok: boolean; data: T | null; rot: boolean } {
  try {
    if (!fs.existsSync(file)) return { ok: false, data: null, rot: false };
    const sidecar = `${file}.sha256`;
    const body = fs.readFileSync(file, 'utf8');
    if (fs.existsSync(sidecar)) {
      const expected = fs.readFileSync(sidecar, 'utf8').trim();
      const actual = sha256(body);
      if (actual !== expected) {
        return { ok: false, data: null, rot: true };
      }
    }
    return { ok: true, data: JSON.parse(body) as T, rot: false };
  } catch {
    return { ok: false, data: null, rot: false };
  }
}

/** สำรองไฟล์ที่สงสัย bit rot ไว้ (ไม่ลบทิ้ง — ไว้วิเคราะห์ย้อนหลัง) */
export function quarantineCorrupt(file: string): string | null {
  try {
    const dest = `${file}.corrupt-${Date.now()}`;
    fs.copyFileSync(file, dest);
    return dest;
  } catch {
    return null;
  }
}

export function listManagedFiles(): string[] {
  const dir = path.resolve(process.cwd(), 'data');
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json') && !f.endsWith('.sha256') && !f.includes('.corrupt-') && !f.endsWith('.tmp'))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

export interface BitRotScanResult {
  scanned: number;
  ok: number;
  baselineCreated: number;
  corrupt: { file: string; quarantinedTo: string | null }[];
}

/**
 * สแกน bit rot ทุกไฟล์ state ใน data/ (เรียกทุกสัปดาห์ + ตอน boot)
 *  - ไฟล์ที่ยังไม่มี sidecar → สร้าง baseline (เข้ารับการคุ้มครองตั้งแต่นี้)
 *  - ไฟล์ที่ checksum ไม่ตรง → quarantine + securityEvent BIT_ROT + SSE (ดังจนกว่ามนุษย์จะดู)
 */
export async function runBitRotScan(raiseAlerts = true): Promise<BitRotScanResult> {
  const files = listManagedFiles();
  const result: BitRotScanResult = { scanned: files.length, ok: 0, baselineCreated: 0, corrupt: [] };
  for (const file of files) {
    const sidecar = `${file}.sha256`;
    if (!fs.existsSync(sidecar)) {
      try {
        const body = fs.readFileSync(file, 'utf8');
        fs.writeFileSync(sidecar, sha256(body), 'utf8');
        result.baselineCreated++;
        result.ok++;
        continue;
      } catch {
        continue;
      }
    }
    const { rot } = readJsonVerified(file);
    if (rot) {
      const quarantinedTo = quarantineCorrupt(file);
      result.corrupt.push({ file, quarantinedTo });
      if (raiseAlerts) {
        securityStream.push('BIT_ROT', { file, quarantinedTo });
        try {
          await prisma.securityEvent.create({
            data: {
              event_type: 'BIT_ROT',
              severity: 'critical',
              description: `💾 BIT_ROT: checksum ไม่ตรง ${file}${quarantinedTo ? ` → สำรองไว้ ${quarantinedTo}` : ''} — ข้อมูลอาจเพี้ยนเงียบ (0→1) ตรวจสอบทันที`,
              raw_data: { file, quarantinedTo },
            },
          });
        } catch (err) {
          console.error('Bit-rot event write error:', err instanceof Error ? err.message : err);
        }
        console.warn(`💾 BIT_ROT: ${file} checksum mismatch!`);
      }
    } else {
      result.ok++;
    }
  }
  return result;
}