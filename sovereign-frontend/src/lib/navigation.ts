// ─────────────────────────────────────────────────────────────
//  แหล่งเดียวของเมนูทั้งหมดในแอป (Single source of truth)
//  ใช้ร่วมกันโดย: Sidebar, CommandPalette (⌘K), MobileNav
//  แก้ที่นี่ที่เดียว → ทุกที่เปลี่ยนตาม
// ─────────────────────────────────────────────────────────────

export type NavItem = { href: string; label: string; icon: string; keywords?: string };
export type NavGroup = { title: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'ภาพรวม',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: '📊', keywords: 'หน้าหลัก home ภาพรวม สถานะ' },
    ],
  },
  {
    title: 'อุปกรณ์ & พลังงาน',
    items: [
      { href: '/sensors', label: 'Device Manager + Sensor Data', icon: '📡', keywords: 'อุปกรณ์ เซ็นเซอร์ sensor device manager' },
      { href: '/energy', label: 'Energy', icon: '⚡', keywords: 'พลังงาน ไฟฟ้า พลังงานแสงอาทิตย์' },
      { href: '/predictive', label: 'Predictive', icon: '🔮', keywords: 'พยากรณ์ คาดการณ์ ทำนาย' },
      { href: '/relay', label: 'Relay Control', icon: '🎛️', keywords: 'รีเลย์ ควบคุม สวิตช์' },
      { href: '/automation', label: 'Automation', icon: '⚙️', keywords: 'อัตโนมัติ ระบบอัตโนมัติ' },
      { href: '/ota', label: 'OTA Updates', icon: '🚀', keywords: 'อัปเดต เฟิร์มแวร์ ota' },
    ],
  },
  {
    title: 'ความปลอดภัย',
    items: [
      { href: '/security', label: 'Cyber Security', icon: '🛡️', keywords: 'ไฟร์วอลล์ firewall ความปลอดภัย ไซเบอร์' },
      { href: '/ai-agent', label: 'AI Agent', icon: '🤖', keywords: 'เอเจนต์ บทบาท ตัวแทน ai' },
      { href: '/ai', label: 'AI Command Center', icon: '🧠', keywords: 'ai ปัญญาประดิษฐ์ คำสั่ง' },
      { href: '/vision', label: 'Vision AI', icon: '📷', keywords: 'กล้อง ภาพ ตรวจจับ ใบหน้า ภาพบุคคล' },
      { href: '/property', label: 'Property Map', icon: '🗺️', keywords: 'แผนที่ ที่ดิน บ้าน ทรัพย์สิน 3d' },
      { href: '/alerts', label: 'Alert History', icon: '🚨', keywords: 'แจ้งเตือน ประวัติ เตือนภัย' },
      { href: '/risk-monitor', label: 'Risk Monitor', icon: '📰', keywords: 'ความเสี่ยง ข่าว monitor' },
      { href: '/governance-sim', label: 'Governance Sim', icon: '🏛️', keywords: 'จำลอง การปกครอง สังคม เศรษฐศาสตร์ การเมือง simul govsim war room' },
      { href: '/infrastructure', label: 'Infrastructure', icon: '🏭', keywords: 'โครงสร้างพื้นฐาน เน็ตเวิร์ก' },
    ],
  },
  {
    title: 'ชีวิต & การเงิน',
    items: [
      { href: '/health', label: 'Health Screening', icon: '🩺', keywords: 'สุขภาพ ตรวจสุขภาพ โรค' },
      { href: '/inventory', label: 'Inventory & Supplies', icon: '📦', keywords: 'เสบียง คลัง สต็อก ของใช้' },
      { href: '/farm', label: 'Farm Plots', icon: '🌱', keywords: 'ฟาร์ม แปลง ดิน พืช เกษตร' },
      { href: '/portfolio', label: 'Wealth & Assets', icon: '💰', keywords: 'เงิน การเงิน หุ้น พอร์ต ทรัพย์สิน ลงทุน' },
      { href: '/knowledge', label: 'Knowledge Base', icon: '📚', keywords: 'ความรู้ บทเรียน เรียน เด็ก สอน' },
      { href: '/healing', label: 'Buddhist Healing', icon: '🧘', keywords: 'ธรรมะ สมาธิ สมุนไพร เยียวยา วัด' },
      { href: '/lifestyle', label: 'วิถีชีวิต', icon: '🌿', keywords: 'วิถี ชีวิต ธรรมชาติ จังหวะ หน้าต่าง อากาศ แสง circadian manual day ไร้ระบบ' },
    ],
  },
  {
    title: 'ข้อมูล & รายงาน',
    items: [
      { href: '/history', label: 'History', icon: '📈', keywords: 'ประวัติ ข้อมูล ย้อนหลัง' },
      { href: '/reports', label: 'AI Reports', icon: '📊', keywords: 'รายงาน สรุป ai' },
    ],
  },
  {
    title: 'บัญชีของฉัน',
    items: [
      { href: '/change-password', label: 'เปลี่ยนรหัสผ่าน', icon: '🔑', keywords: 'รหัสผ่าน เปลี่ยนรหัส password บัญชี login' },
    ],
  },
  {
    title: 'ระบบ',
    items: [
      { href: '/system', label: 'System Health', icon: '🔧', keywords: 'ระบบ สุขภาพ เซิร์ฟเวอร์' },
      { href: '/backup', label: 'Backup', icon: '💾', keywords: 'สำรอง ข้อมูล backup' },
      { href: '/users', label: 'Users', icon: '👥', keywords: 'ผู้ใช้ บัญชี สมาชิก' },
      { href: '/audit', label: 'Audit Log', icon: '📜', keywords: 'log ตรวจสอบ audit' },
      { href: '/settings', label: 'Settings', icon: '🛠️', keywords: 'ตั้งค่า ปรับแต่ง clone export' },
    ],
  },
];

/** รายการหน้าทั้งหมดแบบแบน (สำหรับ CommandPalette) */
export const ALL_PAGES: Array<NavItem & { group: string }> = NAV_GROUPS.flatMap((g) =>
  g.items.map((i) => ({ ...i, group: g.title }))
);
