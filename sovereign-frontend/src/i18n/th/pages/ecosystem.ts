// หน้า Ecosystem + Social Studio ประวัติการโพสต์ — ภาษาไทย
export default {
  // ── หน้า Ecosystem (ecosystem.tsx) ──
  loadError: 'โหลดข้อมูล Ecosystem ไม่ได้',
  revealError: 'ขอรหัสผ่านไม่สำเร็จ',
  copied: 'คัดลอกรหัสแล้ว — วางได้เลย',
  copyError: 'คัดลอกไม่สำเร็จ',
  badUrl: 'URL ไม่ถูกต้อง — ต้องเป็น http/https',
  openError: 'เปิดเว็บไม่สำเร็จ',

  // ── Social Studio โหมดต่าง ๆ ──
  socialStudio: {
    text: 'โพสต์ข้อความ',
    subText: 'เรื่องทั่วไป · โปรโมชัน · อัปเดตงาน → Facebook',
    clip: 'ลงคลิปวิดีโอ',
    subClip: 'YouTube · Instagram · TikTok · Facebook',
    history: 'ประวัติการโพสต์',
    historySub: 'ติดตามว่าทำแพลตฟอร์มไหนแล้ว — กันโพสต์ซ้ำ',
    historyBadge: 'บันทึกในฐานข้อมูล',
    badgeFb: '{n} บัญชี Facebook',
    badgeFbNone: 'ยังไม่มีบัญชี Facebook',
    badgeClip: '{n} บัญชีพร้อมใช้',
    badgeClipNone: 'ยังไม่มีบัญชีโซเชียล',
  },

  // ── TextStudio ──
  textStudio: {
    saveHistory: 'บันทึกงานนี้ลงประวัติ',
    saving: 'กำลังบันทึก…',
    saved: 'บันทึกงานนี้ลงประวัติแล้ว — ดูได้ในแท็บ “ประวัติการโพสต์”',
  },

  // ── ClipStudio ──
  clipStudio: {
    saveHistory: 'บันทึกงานนี้ลงประวัติ',
    saving: 'กำลังบันทึก…',
    saved: 'บันทึกงานนี้ลงประวัติแล้ว — ดูได้ในแท็บ “ประวัติการโพสต์”',
  },

  // ── PostHistory ──
  postHistory: {
    title: 'ประวัติการโพสต์',
    subtitle: 'บันทึกไว้ในฐานข้อมูล — ข้ามเครื่องได้ ไม่หายเมื่อล้างเบราว์เซอร์',
    refresh: 'รีเฟรช',
    loading: 'กำลังโหลด…',
    loadingHistory: 'กำลังโหลดประวัติ…',
    deleting: 'กำลังลบ…',
    loadError: 'โหลดประวัติไม่สำเร็จ',
    updateError: 'อัปเดตสถานะไม่สำเร็จ',
    deleteError: 'ลบประวัติไม่สำเร็จ',
    badUrl: 'ลิงก์โพสต์ต้องขึ้นต้นด้วย http:// หรือ https://',
    noHistory: 'ยังไม่มีประวัติการโพสต์',
    noHistorySub:
      'ไปที่แท็บ “โพสต์ข้อความ” หรือ “ลงคลิปวิดีโอ” แล้วกด “บันทึกงานนี้ลงประวัติ” เพื่อเก็บไว้ติดตามว่าทำแพลตฟอร์มไหนแล้ว',
    confirmDelete: 'ลบประวัตินี้ถาวรใช่หรือไม่? การลบไม่กระทบโพสต์จริงบนแพลตฟอร์ม',
    deleted: 'ลบประวัตินี้แล้ว',
    msgPosted: 'บันทึกว่าโพสต์ {label} แล้ว',
    msgSkipped: 'ทำเครื่องหมายข้าม {label} แล้ว',
    msgPending: 'ตั้ง {label} กลับเป็นรอโพสต์',
    textPost: 'โพสต์ข้อความ',
    clipPost: 'งานลงคลิป',
    postedAt: 'เมื่อ',
    openLink: 'เปิดลิงก์โพสต์',
    linkPlaceholder: 'ลิงก์โพสต์ (ไม่บังคับ)',
    markPosted: 'โพสต์แล้ว',
    markSkipped: 'ข้าม',
    markPending: 'ตั้งกลับเป็นรอโพสต์',
    saving: 'กำลังบันทึก…',
    hint:
      '“โพสต์แล้ว” ในที่นี้คือบันทึกของแอป ไม่ได้ยืนยันแทนแพลตฟอร์ม — กดเมื่อคุณโพสต์จริงแล้วเท่านั้น ถ้าลบประวัตินี้ โพสต์บนแพลตฟอร์มยังอยู่ครบ',
    platform: {
      youtube: 'YouTube',
      facebook: 'Facebook',
      instagram: 'Instagram',
      tiktok: 'TikTok',
    },
    status: {
      pending: 'รอโพสต์',
      posted: 'โพสต์แล้ว',
      skipped: 'ข้าม',
    },
    actions: {
      save: 'บันทึก',
      delete: 'ลบ',
      refresh: 'รีเฟรช',
    },
  },
} as const;
