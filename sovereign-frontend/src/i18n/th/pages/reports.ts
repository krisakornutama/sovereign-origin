// หน้า Reports (reports.tsx) — ภาษาไทย
export default {
  unauthorized: 'Unauthorized',
  eyebrow: 'ข้อมูล & รายงาน',
  backDashboard: '← กลับ Dashboard',
  generating: 'กำลังสร้าง…',
  generateDaily: 'สร้างรายงานวันนี้',
  generateWeekly: 'สร้างรายงานสัปดาห์',
  created: 'สร้างรายงานแล้ว: {title}',
  loadError: 'โหลดรายงานไม่สำเร็จ — ตรวจว่า backend เปิดอยู่และรัน migration ล่าสุดแล้ว',
  generateError: 'สร้างรายงานไม่สำเร็จ — ตรวจว่า Ollama เปิดอยู่และมีข้อมูลใน TimescaleDB',
  automationNote: 'รายงานอัตโนมัติ: ทุกเช้า 06:00 (รายวัน) และวันอาทิตย์ 07:00 (รายสัปดาห์) — สรุปโดย AI จากข้อมูล TimescaleDB และส่งเข้า Telegram',
  noReports: 'ยังไม่มีรายงาน — กดปุ่มด้านบนเพื่อสร้างรายงานแรก',
  weekly: 'รายสัปดาห์',
  daily: 'รายวัน',
} as const;