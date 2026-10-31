// เปิดลิงก์ภายนอกให้ออก "เบราว์เซอร์จริง" เสมอ
//
// เดสก์ท็อป (Electron):
//   · sovereign.openUserLink — ลิงก์ที่ผู้ใช้บันทึกเอง (Ecosystem) เปิดได้ทุก http/https
//   · sovereign.openExternal — allowlist ของ Setup Wizard (YouTube/Facebook/... + localhost)
// เว็บเบราว์เซอร์: window.open (fallback)
//
// คืน true = สั่งเปิดสำเร็จ · false = URL ไม่ปลอดภัย/เดสก์ท็อปปฏิเสธ (ผู้เรียกต้องแจ้งผู้ใช้ ไม่ใช่เงียบ)
interface SovereignBridge {
  openUserLink?: (url: string) => Promise<{ ok?: boolean } | undefined>;
  openExternal?: (url: string) => Promise<{ ok?: boolean } | undefined>;
}

export async function openExternal(url: string): Promise<boolean> {
  const safe = String(url ?? '').trim();
  if (!/^https?:\/\//i.test(safe)) return false;

  const bridge = (window as unknown as { sovereign?: SovereignBridge }).sovereign;

  if (bridge?.openUserLink) {
    try {
      const result = await bridge.openUserLink(safe);
      return Boolean(result?.ok);
    } catch {
      return false;
    }
  }

  // เดสก์ท็อปรุ่นเก่าที่ยังไม่มี openUserLink — ลอง allowlist เดิมก่อน
  if (bridge?.openExternal) {
    try {
      const result = await bridge.openExternal(safe);
      if (result?.ok) return true;
    } catch {
      /* ตกไปใช้ window.open */
    }
  }

  const opened = window.open(safe, '_blank', 'noopener,noreferrer');
  return Boolean(opened);
}
