// แอปพลิเคชัน (_app.tsx NoAccessScreen, ApiConnectionBanner, AgentBackgroundBadge) — ภาษาไทย
export default {
  noAccessTitle: 'หน้านี้ยังไม่ได้เปิดให้คุณดู',
  noAccessHint: 'ถ้าคิดว่าควรเห็นหน้านี้ ให้ผู้ดูแล (superadmin) เปิดสิทธิ์ให้ที่หน้า Users',
  backDashboard: 'กลับ Dashboard',
  banner: {
    connecting: 'กำลังเชื่อมต่อใหม่…',
    connectingDetail: ' (ลองครั้งที่ {n}) — API ยังไม่ตอบสนอง ระบบจะลองเองอัตโนมัติทุกไม่กี่วินาที',
    retryNow: 'ลองทันที',
    reconnected: 'เชื่อมต่อ API แล้ว',
    reconnectedDetail: ' — กำลังโหลดข้อมูลให้อัตโนมัติ…',
  },
  badge: {
    notifStartedTitle: '🤖 AI ทำงานเบื้องหลัง',
    notifStartedBody: '{n} งานกำลังรัน — ไปหน้าอื่นต่อได้เลย',
    notifDoneTitle: '✅ AI ทำงานเบื้องหลังเสร็จ',
    notifDoneBody: 'เสร็จ {n} งาน — ดูผลได้ที่หน้า AI Agent',
    tooltip: 'AI กำลังทำงานเบื้องหลัง — คลิกเพื่อดูสถานะ',
    label: 'AI ทำงานเบื้องหลัง ({n})',
  },
} as const;