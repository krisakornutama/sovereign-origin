// components/business/soverien/zip.ts
// ตัวเขียนไฟล์ ZIP แบบ "store" (ไม่บีบอัด) — ไม่ต้องเพิ่ม dependency
// เหตุผลที่ไม่ใช้ JSZip: package.json อยู่ในรายการห้ามแตะ (เพิ่ม dependency ต้องได้อนุญาต)
// ข้อมูล PNG ถูกบีบอัดมาเรียบร้อยแล้ว การบีบซ้ำได้ผลน้อยมาก
// อ้างอิงรูปแบบ: PKWARE .ZIP File Format Specification 6.3.4

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

type Entry = { name: string; data: Uint8Array };

/** โหลด Date → MS-DOS time/date (ZIP ใช้รูปแบบนี้ ไม่ใช่ ISO) */
function dosStamp(d: Date) {
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
  const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date };
}

/** ประกอบไฟล์ ZIP จากรายการไฟล์ (Uint8Array) → Blob */
export function buildZip(entries: Entry[], when = new Date()): Blob {
  const enc = new TextEncoder();
  const { time, date } = dosStamp(when);
  const locals: BlobPart[] = [];
  const centrals: BlobPart[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const crc = crc32(e.data);
    const size = e.data.length;

    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); // local file header signature
    lh.setUint16(4, 20, true);         // version needed
    lh.setUint16(6, 0x0800, true);     // flags: UTF-8 filename
    lh.setUint16(8, 0, true);          // method: store
    lh.setUint16(10, time, true);
    lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, size, true);      // compressed size
    lh.setUint32(22, size, true);      // uncompressed size
    lh.setUint16(26, nameBytes.length, true);
    lh.setUint16(28, 0, true);         // extra length
    // BlobPart ใน TS ใหม่ต้องเป็น ArrayBufferView<ArrayBuffer> · Uint8Array ที่มาจาก
    // DataView/ArrayBuffer อาจถูกมองเป็น ArrayBufferLike → cast ให้ชัดตรงนี้ที่เดียว
    locals.push(new Uint8Array(lh.buffer) as BlobPart, nameBytes as BlobPart, e.data as BlobPart);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); // central directory header
    ch.setUint16(4, 20, true);        // version made by
    ch.setUint16(6, 20, true);        // version needed
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, time, true);
    ch.setUint16(14, date, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, size, true);
    ch.setUint32(24, size, true);
    ch.setUint16(28, nameBytes.length, true);
    ch.setUint16(30, 0, true);        // extra
    ch.setUint16(32, 0, true);        // comment
    ch.setUint16(34, 0, true);        // disk number start
    ch.setUint16(36, 0, true);        // internal attrs
    ch.setUint32(38, 0, true);        // external attrs
    ch.setUint32(42, offset, true);   // relative offset of local header
    centrals.push(new Uint8Array(ch.buffer) as BlobPart, nameBytes as BlobPart);

    offset += 30 + nameBytes.length + size;
  }

  const centralSize = centrals.reduce((s, u) => s + (u as ArrayBufferView).byteLength, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true); // end of central directory
  eocd.setUint16(4, 0, true);
  eocd.setUint16(6, 0, true);
  eocd.setUint16(8, entries.length, true);
  eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, centralSize, true);
  eocd.setUint32(16, offset, true);
  eocd.setUint16(20, 0, true);

  return new Blob([...locals, ...centrals, new Uint8Array(eocd.buffer)], { type: 'application/zip' });
}

/** ดาวน์โหลด Blob เป็นไฟล์ */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // หน่วงสักหน่อยก่อน revoke ไม่งั้น Chrome ยกเลิก URL ก่อนดาวน์โหลดเสร็จ
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadText(text: string, filename: string, mime = 'text/plain;charset=utf-8'): void {
  downloadBlob(new Blob(['\ufeff' + text], { type: mime }), filename);
}

export async function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('สร้าง PNG ไม่สำเร็จ');
  return new Uint8Array(await blob.arrayBuffer());
}