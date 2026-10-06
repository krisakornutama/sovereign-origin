// src/screenshot.mjs — จับภาพหน้าจอของเครื่อง (ตอนจบงาน)
//
// ทำไมต้องมี: ผู้ใช้สั่งงานให้ agent บนเครื่องคอมอีกเครื่อง และอยากเห็นว่า
// "ตอนจบงาน หน้าจอเป็นอย่างไร" —— ภาพนี้คือหลักฐานเดียวที่ยืนยันได้ว่างานจบจริง
// ไม่ใช่แค่ log ที่ agent เขียนเอง
//
// หลักการ:
// - ใช้ PowerShell + WinForms ของ Windows (ไม่ต้องเพิ่ม dependency ภายนอกเลย)
// - คืน Buffer PNG หรือ null — ห้าม throw เด็ดขาด (ภาพจับไม่ได้ต้องไม่ทำให้งานพัง)
// - แพลตฟอร์มอื่นคืน null (ยังไม่มีวิธีจับภาพที่พึ่งพาได้) — runner อยู่ต่อได้
import { execFile } from 'node:child_process';

// สคริปต์ PowerShell: จับทั้ง VirtualScreen (รองรับจอหลายตัว) → PNG → base64
const PS_SCRIPT = [
  'Add-Type -AssemblyName System.Windows.Forms,System.Drawing',
  '$b = [System.Windows.Forms.SystemInformation]::VirtualScreen',
  '$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height',
  '$g = [System.Drawing.Graphics]::FromImage($bmp)',
  '$g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)',
  '$ms = New-Object System.IO.MemoryStream',
  '$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)',
  '[Convert]::ToBase64String($ms.ToArray())',
].join('; ');

/** รันสคริปต์ PowerShell แล้วคืน stdout (injectable สำหรับเทสต์) */
function defaultRun(script) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });
}

/**
 * จับภาพหน้าจอ → Buffer PNG
 * @returns {Promise<Buffer|null>}
 */
export async function captureScreenshot({ platform = process.platform, run = defaultRun } = {}) {
  if (platform !== 'win32') return null;
  let b64;
  try {
    b64 = String(await run(PS_SCRIPT)).trim();
  } catch (err) {
    // จับภาพไม่ได้ = ไม่มีภาพ แต่ห้ามลากงานที่เพิ่งสำเร็จให้ล้ม
    console.error(`[runner] จับภาพหน้าจอไม่สำเร็จ: ${err?.message || err}`);
    return null;
  }
  if (!b64) return null;
  return Buffer.from(b64, 'base64');
}
