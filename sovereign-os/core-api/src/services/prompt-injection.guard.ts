// ── Prompt Injection Shield (Phase 6 — ภัยที่ 5: Local AI Voice & Indirect Prompt Injection) ──
// กัน "พ่อบอกให้ทำ แต่พ่อลืม passcode" ผ่านข้อความ/เสียง:
//  - คนในบ้าน/แขก/เด็ก สั่ง AI ทางอ้อมด้วยลวดลาย "ผู้มีอำนาจสั่ง" / "ข้ามขั้นตอนยืนยัน"
//  - AI เป็นได้แค่ Adviser — ทุก action ระดับ actuator ต้องผ่าน approval จากมนุษย์
//    (ดู agent-policy + SENSITIVE_TOOLS ใน agent-actions) — ตรงนี้ปิดช่อง "ข้ามการยืนยัน" ทางภาษา
// เมื่อโดน → ตอบปฏิเสธ + securityEvent PROMPT_INJECTION + SSE push

const INJECTION_PATTERNS: { pattern: RegExp; label: string }[] = [
  // การอ้างอำนาจจากคนในครอบครัว (บุคคลภายนอก/เด็กใช้หลอก AI)
  { pattern: /(พ่อ|แม่|ตา|ยาย|ปู่|ย่า|ลุง|ป้า|น้า|อา|พี่|น้อง|ลูก|สามี|ภรรยา|เมีย|แฟน|เพื่อน|แขก).{0,25}(บอก|สั่ง|ขอให้|ให้(ทำ|ปิด|เปิด|ปลด|ล็อก|ตัด))/, label: 'family_authority_claim' },
  { pattern: /(พ่อ|แม่|ตา|ยาย|ปู่|ย่า|ลุง|ป้า|น้า|อา|พี่|น้อง).{0,25}(กำลังมา|อยู่ข้างนอก|นอนอยู่|หลับอยู่|ไม่มีเวลา)/, label: 'absent_authority_claim' },
  // ลืม/ไม่มีรหัส — หลอกให้ข้ามขั้นตอน
  { pattern: /(ลืม|ไม่มี|หาไม่เจอ|จำไม่ได้).{0,20}(passcode|รหัส|รหัสผ่าน|password|กุญแจ)/, label: 'missing_passcode' },
  // สั่งปิดความปลอดภัย/กล้อง โดยอ้างเหตุผลฉุกเฉินปลอม
  { pattern: /(ปิด|ปิดระบบ|ยับยั้ง|ปิดการทำงาน).{0,20}(ความปลอดภัย|security|กล้อง|ระบบเตือน|alert|แจ้งเตือน|ล็อก|ประตู|สัญญาณกันขโมย)/, label: 'disable_security' },
  { pattern: /(ไม่ต้อง|อย่า|ห้าม).{0,15}(ถาม|ตรวจ|ยืนยัน|บอก|แจ้ง|รบกวน|ปลุก)/, label: 'suppress_confirmation' },
  // English — bypass/jailbreak/instruction override
  { pattern: /(ignore|bypass|override|forget|disregard).{0,30}(instructions|rules|system|safety|security|previous|policy)/i, label: 'instruction_override' },
  { pattern: /jailbreak|do anything now|no restrictions|DAN mode/i, label: 'jailbreak' },
  { pattern: /don'?t (tell|ask|notify|alert) (anyone|them|my)/i, label: 'secrecy_request' },
];

export interface InjectionDetection {
  flagged: boolean;
  patterns: string[];
}

export function detectInjection(text: string): InjectionDetection {
  const hit: string[] = [];
  for (const { pattern, label } of INJECTION_PATTERNS) {
    if (pattern.test(text)) hit.push(label);
  }
  return { flagged: hit.length > 0, patterns: hit };
}