// ─────────────────────────────────────────────────────────────
//  แหล่งเดียวของเมนูทั้งหมดในแอป (Single source of truth)
//  ใช้ร่วมกันโดย: Sidebar, CommandPalette (⌘K), MobileNav
//  แก้ที่นี่ที่เดียว → ทุกที่เปลี่ยนตาม
//  icon = ชื่อไอคอนจาก components/ui/Icon.tsx
//  label = ข้อความไทย (default) / labelKey = key สำหรับสลับภาษาอังกฤษ
// ─────────────────────────────────────────────────────────────

export type NavItem = { href: string; label: string; labelKey: string; icon: string; keywords?: string; children?: NavItem[] };
export type NavGroup = { title: string; titleKey: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'ภาพรวม',
    titleKey: 'common.nav.group.overview',
    items: [
      { href: '/dashboard', label: 'หน้าหลัก', labelKey: 'common.nav.dashboard', icon: 'dashboard', keywords: 'หน้าหลัก home ภาพรวม สถานะ' },
    ],
  },
  {
    title: 'อุปกรณ์ & พลังงาน',
    titleKey: 'common.nav.group.devicesEnergy',
    items: [
      { href: '/sensors', label: 'อุปกรณ์และเซ็นเซอร์', labelKey: 'common.nav.sensors', icon: 'sensors', keywords: 'อุปกรณ์ เซ็นเซอร์ sensor device manager' },
      { href: '/energy', label: 'พลังงาน', labelKey: 'common.nav.energy', icon: 'energy', keywords: 'พลังงาน ไฟฟ้า พลังงานแสงอาทิตย์' },
      { href: '/predictive', label: 'พยากรณ์', labelKey: 'common.nav.predictive', icon: 'predictive', keywords: 'พยากรณ์ คาดการณ์ ทำนาย' },
      { href: '/relay', label: 'ควบคุมรีเลย์', labelKey: 'common.nav.relay', icon: 'relay', keywords: 'รีเลย์ ควบคุม สวิตช์' },
      { href: '/automation', label: 'ระบบอัตโนมัติ', labelKey: 'common.nav.automation', icon: 'automation', keywords: 'อัตโนมัติ ระบบอัตโนมัติ' },
      { href: '/ota', label: 'อัปเดต OTA', labelKey: 'common.nav.ota', icon: 'ota', keywords: 'อัปเดต เฟิร์มแวร์ ota' },
    ],
  },
  {
    title: 'ความปลอดภัย',
    titleKey: 'common.nav.group.security',
    items: [
      { href: '/security', label: 'ความปลอดภัยไซเบอร์', labelKey: 'common.nav.security', icon: 'security', keywords: 'ไฟร์วอลล์ firewall ความปลอดภัย ไซเบอร์' },
      { href: '/ai-agent', label: 'AI Agent', labelKey: 'common.nav.aiAgent', icon: 'ai-agent', keywords: 'เอเจนต์ บทบาท ตัวแทน ai' },
      { href: '/ai', label: 'ศูนย์บัญชาการ AI', labelKey: 'common.nav.ai', icon: 'ai', keywords: 'ai ปัญญาประดิษฐ์ คำสั่ง' },
      { href: '/vision', label: 'Vision AI', labelKey: 'common.nav.vision', icon: 'vision', keywords: 'กล้อง ภาพ ตรวจจับ ใบหน้า ภาพบุคคล' },
      { href: '/property', label: 'แผนที่ทรัพย์สิน', labelKey: 'common.nav.property', icon: 'property', keywords: 'แผนที่ ที่ดิน บ้าน ทรัพย์สิน 3d' },
      { href: '/alerts', label: 'ประวัติการแจ้งเตือน', labelKey: 'common.nav.alerts', icon: 'alerts', keywords: 'แจ้งเตือน ประวัติ เตือนภัย' },
      { href: '/risk-monitor', label: 'เฝ้าระวังความเสี่ยง', labelKey: 'common.nav.riskMonitor', icon: 'risk', keywords: 'ความเสี่ยง ข่าว monitor' },
      { href: '/governance-sim', label: 'จำลองการปกครอง', labelKey: 'common.nav.governanceSim', icon: 'governance', keywords: 'จำลอง การปกครอง สังคม เศรษฐศาสตร์ การเมือง simul govsim war room' },
      { href: '/infrastructure', label: 'โครงสร้างพื้นฐาน', labelKey: 'common.nav.infrastructure', icon: 'infrastructure', keywords: 'โครงสร้างพื้นฐาน เน็ตเวิร์ก' },
    ],
  },
  {
    title: 'ชีวิต & การเงิน',
    titleKey: 'common.nav.group.lifeFinance',
    items: [
      { href: '/health', label: 'ตรวจสุขภาพ', labelKey: 'common.nav.health', icon: 'health', keywords: 'สุขภาพ ตรวจสุขภาพ โรค' },
      { href: '/inventory', label: 'เสบียงและของใช้', labelKey: 'common.nav.inventory', icon: 'inventory', keywords: 'เสบียง คลัง สต็อก ของใช้' },
      { href: '/farm', label: 'แปลงเกษตร', labelKey: 'common.nav.farm', icon: 'farm', keywords: 'ฟาร์ม แปลง ดิน พืช เกษตร' },
      { href: '/livestock', label: 'ปศุสัตว์', labelKey: 'common.nav.livestock', icon: 'farm', keywords: 'ปศุสัตว์ เล้า คอก ไก่ สุกร โค เป็ด ฟาร์มปศุสัตว์ เกษตร' },
      { href: '/restaurant', label: 'ร้านอาหาร', labelKey: 'common.nav.restaurant', icon: 'inventory', keywords: 'ร้านอาหาร จักรวรรดิ เมนู สูตร ออเดอร์ POS แต้ม ใบหน้า ครัว ขาย' },
      {
        href: '/treasury',
        label: 'คลัง & ลงทุน',
        labelKey: 'common.nav.treasury',
        icon: 'portfolio',
        keywords: 'เงิน การเงิน หุ้น พอร์ต ทรัพย์สิน ลงทุน คลัง คลังทรัพย์สิน กระแสเงินสด runway survival net worth ครอบครัว',
        children: [
          { href: '/treasury#net-worth', label: 'ทรัพย์สิน & เงินสด', labelKey: 'common.nav.treasuryNetWorth', icon: 'portfolio', keywords: 'ทรัพย์สิน เงินสด net worth กระแสเงินสด cashflow หนี้สิน' },
          { href: '/treasury#runway', label: 'Survival Runway', labelKey: 'common.nav.treasuryRunway', icon: 'gauge', keywords: 'runway อยู่รอด เดือน ค่าใช้จ่าย เผาผลาญ เงินสดปันผล' },
          { href: '/treasury#strategies', label: 'กลยุทธ์ลงทุน', labelKey: 'common.nav.treasuryStrategies', icon: 'target', keywords: 'กลยุทธ์ ลงทุน 5 ตระกูล fundamental asymmetric macro quant passive income catalyst ปันผล' },
        ],
      },
      { href: '/knowledge', label: 'คลังความรู้', labelKey: 'common.nav.knowledge', icon: 'knowledge', keywords: 'ความรู้ บทเรียน เรียน เด็ก สอน' },
      { href: '/healing', label: 'ธรรมะบำบัด', labelKey: 'common.nav.healing', icon: 'healing', keywords: 'ธรรมะ สมาธิ สมุนไพร เยียวยา วัด' },
      { href: '/lifestyle', label: 'วิถีชีวิต', labelKey: 'common.nav.lifestyle', icon: 'lifestyle', keywords: 'วิถี ชีวิต ธรรมชาติ จังหวะ หน้าต่าง อากาศ แสง circadian manual day ไร้ระบบ' },
    ],
  },
  {
    title: 'ข้อมูล & รายงาน',
    titleKey: 'common.nav.group.dataReports',
    items: [
      { href: '/history', label: 'ประวัติข้อมูล', labelKey: 'common.nav.history', icon: 'history', keywords: 'ประวัติ ข้อมูล ย้อนหลัง' },
      { href: '/reports', label: 'รายงาน AI', labelKey: 'common.nav.reports', icon: 'reports', keywords: 'รายงาน สรุป ai' },
    ],
  },
  {
    title: 'บัญชีของฉัน',
    titleKey: 'common.nav.group.myAccount',
    items: [
      { href: '/change-password', label: 'เปลี่ยนรหัสผ่าน', labelKey: 'common.nav.changePassword', icon: 'key', keywords: 'รหัสผ่าน เปลี่ยนรหัส password บัญชี login' },
    ],
  },
  {
    title: 'ระบบ',
    titleKey: 'common.nav.group.system',
    items: [
      { href: '/system', label: 'สุขภาพระบบ', labelKey: 'common.nav.system', icon: 'system', keywords: 'ระบบ สุขภาพ เซิร์ฟเวอร์' },
      { href: '/backup', label: 'สำรองข้อมูล', labelKey: 'common.nav.backup', icon: 'backup', keywords: 'สำรอง ข้อมูล backup' },
      { href: '/users', label: 'ผู้ใช้', labelKey: 'common.nav.users', icon: 'users', keywords: 'ผู้ใช้ บัญชี สมาชิก' },
      { href: '/audit', label: 'บันทึกตรวจสอบ', labelKey: 'common.nav.audit', icon: 'audit', keywords: 'log ตรวจสอบ audit' },
      { href: '/settings', label: 'ตั้งค่า', labelKey: 'common.nav.settings', icon: 'settings', keywords: 'ตั้งค่า ปรับแต่ง clone export' },
    ],
  },
];

/** รายการหน้าทั้งหมดแบบแบน (สำหรับ CommandPalette) — รวม sub-view (#hash) ด้วย */
export const ALL_PAGES: Array<NavItem & { group: string; groupKey: string }> = NAV_GROUPS.flatMap((g) =>
  g.items.flatMap((i) => [
    { ...i, group: g.title, groupKey: g.titleKey },
    ...(i.children ?? []).map((c) => ({ ...c, group: g.title, groupKey: g.titleKey })),
  ])
);