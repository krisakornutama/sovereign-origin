// components/business/soverien/sticker-template.ts
// จัดการภาพต้นแบบ (อัปโหลด → ย่อ → เข้ารหัส) แยกจาก StickerStudio เพราะไฟล์นั้นชิดเพดาน 400 บรรทัด
export const MAX_TEMPLATE_PX = 1600;   // เกินนี้ localStorage ไม่รับ (โควตา ~5 MB)
export const MAX_TEMPLATE_BYTES = 900_000;
/** คุณภาพ JPEG ตอน fallback — 85% ทำให้เส้นตาละเอียดเป็นหย่อม (14/10/69) */
export const TEMPLATE_QUALITY = 0.92;

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('โหลดภาพไม่สำเร็จ'));
    img.src = src;
  });
}

/**
 * อ่านขนาดจริง (มิลลิเมตร) จากไฟล์ PNG ผ่าน chunk `pHYs` (16/10/69)
 *
 * ทำไมต้องมี: เจ้าของวัดกรอบอุปกรณ์ได้ 8.1 × 5.5 ซม. แล้วบอกมาด้วยคำ
 *   แต่ถ้าไฟล์ต้นแบบที่เขาทำมาถูก export ที่ขนาดจริง PNG จะเก็บค่านั้นไว้
 *   → อ่านมาให้ใช้เป็นค่าเริ่มต้น ไม่ต้องให้เขาพิมพ์ตัวเลขเอง
 *
 * รูปแบบ chunk: [ความยาว 4 ไบต์][ชื่อ "pHYs" 4 ไบต์][ppuX 4][ppuY 4][หน่วย 1][CRC 4]
 *   หน่วย = 1 คือ "พิกเซลต่อเมตร" · ค่าอื่น (เช่น 0) = ไม่รู้ขนาดจริง
 */
export function pngPhysicalMm(bytes: Uint8Array, pxW: number, pxH: number): { widthMm: number; heightMm: number; dpi: number } | null {
  try {
    // PNG signature 8 ไบต์ + IHDR (4+4+13+4) = 33 → chunk ถัดไปเริ่มที่ 33
    const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
    for (let i = 0; i < 8; i++) if (bytes[i] !== SIG[i]) return null;
    // เทียบชื่อ chunk เป็นไบต์ดิบ — ห้ามเขียนเป็นตัวเลขเดียว
    // ⚠ เคยเขียน 0x70685973 แล้วผิด (H = 0x48 ไม่ใช่ 0x68) ทำให้อ่านไม่ได้ทุกไฟล์ 16/10/69
    if (bytes[37] !== 0x70 || bytes[38] !== 0x48 || bytes[39] !== 0x59 || bytes[40] !== 0x73) return null;
    const be = (o: number) => (bytes[o] * 0x1000000) + ((bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]);
    const ppuX = be(41);   // พิกเซลต่อเมตร แนวนอน
    const ppuY = be(45);
    const unit = bytes[49];
    if (unit !== 1 || ppuX <= 0 || ppuY <= 0) return null;  // ไม่รู้หน่วย = ใช้ไม่ได้
    const widthMm = (pxW / ppuX) * 1000;
    const heightMm = (pxH / ppuY) * 1000;
    if (!(widthMm > 0) || !(heightMm > 0)) return null;
    return { widthMm, heightMm, dpi: Math.round((ppuX / 39.3701) * 1000) / 1000 };
  } catch {
    return null;   // ไฟล์เล็ก/เพี้ยน = ไม่มีข้อมูล ไม่ใช่ error
  }
}

/**
 * ย่อภาพต้นแบบให้พอดีกับที่จะพิมพ์ แล้วเข้ารหัสโดยไม่สูญเสียรายละเอียด
 *
 * 14/10/69 — เจ้าของบอกว่า "พอดาวน์โหลดภาพกลับไม่ชัด"
 *   สาเหตุ: เดิมบันทึกเป็น JPEG เสมอ → เส้น/ขอบเข้มกลายเป็นรอหย่อม
 *   ป้ายของเจ้าของเป็นสีแบน (โลโก้เส้น + พื้นเขียว) → PNG เล็กกว่า JPEG เสียอีก
 *   จึงลอง PNG ก่อน แล้วค่อย fallback เป็น JPEG เฉพาะตอน PNG โหญเกินโควตา
 */
export async function normalizeTemplate(file: File): Promise<string> {
  const img = await loadImage(URL.createObjectURL(file));
  const scale = Math.min(1, MAX_TEMPLATE_PX / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * scale));
  c.height = Math.max(1, Math.round(img.height * scale));
  const cx = c.getContext('2d')!;
  cx.imageSmoothingQuality = 'high';
  cx.drawImage(img, 0, 0, c.width, c.height);
  const png = c.toDataURL('image/png');
  if (png.length <= MAX_TEMPLATE_BYTES) return png;       // ไม่สูญเสียเลย = คมที่สุด
  return c.toDataURL('image/jpeg', TEMPLATE_QUALITY);    // PNG ใหญ่เกินโควตา → ยอมสูญเสียบ้าง
}

/**
 * หากรอบที่ "ไม่ใช่สีขาว" ล้อมรอบภาพ — คืนกรอบที่ตัดได้ (16/10/69)
 *
 * เจ้าของส่งภาพป้ายจริงมา ภาพมีพื้นขาวรอบ ๆ กรอบน้ำเงินของอุปกรณ์
 *   พอพิมพ์ที่ขนาดจริง 81×55 มม. กรอบจริงจะเล็กกว่านั้น และเหลือขอบขาวรอบป้าย
 *   → ต้องตัดขอบขาวออกก่อน ไม่งั้นขนาดที่ตั้งไว้ไม่ตรงกับกรอบจริง
 *
 * ⚠ ใช้ threshold ไม่ใช่ "ขาวเป๊ะ" เพราะภาพสแกน/ส่งอีเมลมักมี noise สีขาวไม่บริสุทธิ์
 *   ถ้าใช้ขาวเป๊ะจะไม่ตัดอะไรเลย (ผ่านมาแล้วกับภาพเจ้าของ)
 */
export function findContentBox(
  data: Uint8ClampedArray, w: number, h: number, threshold = 244,
): { x: number; y: number; w: number; h: number } | null {
  const near = (i: number) => data[i] >= threshold && data[i + 1] >= threshold && data[i + 2] >= threshold;
  let top = -1, bottom = -1, left = -1, right = -1;

  // หาบน/ล่างจากแถว (สแกนแถวละ 1 เพราะต้องแม่นพอสำหรับขอบบาง ๆ)
  for (let y = 0; y < h; y++) {
    let has = false;
    for (let x = 0; x < w; x++) if (!near((y * w + x) * 4)) { has = true; break; }
    if (has) { if (top < 0) top = y; bottom = y; }
  }
  if (top < 0) return null;                                  // ภาพขาวทั้งหมด = ไม่มีอะไรให้ตัด
  // หาซ้าย/ขวาจากคอลัมน์ แต่จำกัดแถวที่ต้องมีเนื้อหาจริง ไม่งั้น noise เดียวจะกันภาพทั้งใบ
  for (let x = 0; x < w; x++) {
    let has = false;
    for (let y = top; y <= bottom; y++) if (!near((y * w + x) * 4)) { has = true; break; }
    if (has) { if (left < 0) left = x; right = x; }
  }
  if (left < 0 || bottom - top < 1 || right - left < 1) return null;
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

/** ตัดขอบขาวออกจากภาพต้นแบบที่บันทึกไว้ → คืน dataUrl ใหม่ (ไม่ตัดออก = คืนค่าเดิม) */
export async function trimTemplateMargins(dataUrl: string, threshold = 244): Promise<{
  dataUrl: string; trimmed: boolean; ratio: number;
}> {
  const img = await loadImage(dataUrl);
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const cx = c.getContext('2d')!;
  cx.drawImage(img, 0, 0);
  const px = cx.getImageData(0, 0, c.width, c.height);
  const box = findContentBox(px.data, c.width, c.height, threshold);
  if (!box) return { dataUrl, trimmed: false, ratio: img.width / img.height };

  // ตัดจริงเฉพาะเมื่อขอบขาวมีผลจริง (มากกว่า 1%) ไม่งั้นภาพสัดส่วนผิดจาก noise เม็ดเดียว
  const cut = 1 - (box.w * box.h) / (c.width * c.height);
  if (cut < 0.01) return { dataUrl, trimmed: false, ratio: img.width / img.height };

  const out = document.createElement('canvas');
  out.width = box.w; out.height = box.h;
  out.getContext('2d')!.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  return { dataUrl: out.toDataURL('image/png'), trimmed: true, ratio: box.w / box.h };
}

/**
 * อ่านไฟล์ต้นแบบ 1 ครั้ง ได้ทั้งภาพ (ย่อ+เข้ารหัส) และขนาดจริงเป็นมิลลิเมตร (16/10/69)
 *
 * คืน sizeMm = null ถ้าเป็น JPEG หรือ PNG ที่ไม่ได้บันทึกขนาดจริงไว้ — ไม่ใช่ error
 * แยกจาก StickerStudio เพราะไฟล์นั้นชิดเพดาน 400 บรรทัด
 */
export async function loadTemplate(file: File): Promise<{
  dataUrl: string;
  sizeMm: { widthMm: number; heightMm: number } | null;
}> {
  let sizeMm: { widthMm: number; heightMm: number } | null = null;
  if (!file.type || file.type === 'image/png') {
    try {
      const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
      const probe = await loadImage(URL.createObjectURL(file));
      sizeMm = pngPhysicalMm(head, probe.width, probe.height);
    } catch { sizeMm = null; }
  }
  const dataUrl = await normalizeTemplate(file);
  if (dataUrl.length > MAX_TEMPLATE_BYTES) throw new Error('ย่อภาพแล้วยังใหญ่เกินไป — ลองภาพที่เล็กกว่า');
  return { dataUrl, sizeMm };
}