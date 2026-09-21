// ─────────────────────────────────────────────────────────────
//  แหล่งเดียวของเมนูทั้งหมดในแอป (Single source of truth)
//  ใช้ร่วมกันโดย: Sidebar, CommandPalette (⌘K), MobileNav
//  แก้ที่นี่ที่เดียว → ทุกที่เปลี่ยนตาม
//  icon = ชื่อไอคอนจาก components/ui/Icon.tsx
//  label = ข้อความไทย (default) / labelKey = key สำหรับสลับภาษาอังกฤษ
//  ── จัดกลุ่มตามการใช้งานจริง ไม่ใช่ตามเทคโนโลยี ──
// ─────────────────────────────────────────────────────────────

export type NavItem = { href: string; label: string; labelKey: string; icon: string; keywords?: string; children?: NavItem[] };
export type NavGroup = { title: string; titleKey: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  // ── 1. หน้าหลัก ──
  {
    title: 'ภาพรวม',
    titleKey: 'common.nav.group.overview',
    items: [
      { href: '/dashboard', label: 'หน้าหลัก', labelKey: 'common.nav.dashboard', icon: 'dashboard', keywords: 'หน้าหลัก home ภาพรวม สถานะ' },
    ],
  },

  // ── 2. ร้านอาหาร (ธุรกิจ) ──
  {
    title: '🏪 ร้านอาหาร',
    titleKey: 'common.nav.group.restaurant',
    items: [
      {
        href: '/restaurant',
        label: 'ขายของ (POS)',
        labelKey: 'common.nav.restaurant',
        icon: 'inventory',
        keywords: 'ร้านอาหาร จักรวรรดิ เมนู สูตร ออเดอร์ POS แต้ม ใบหน้า ครัว ขาย นั่งกิน กลับบ้าน',
        children: [
          { href: '/restaurant/admin', label: 'จัดการเมนู & สูตร', labelKey: 'common.nav.restaurantAdmin', icon: 'edit', keywords: 'เมนู สูตร วัตถุดิบ ราคา ผลิตเอง' },
          { href: '/restaurant/kds', label: 'จอครัว (KDS)', labelKey: 'common.nav.restaurantKds', icon: 'automation', keywords: 'ครัว คิว ออเดอร์ ทำอาหาร เสิร์ฟ' },
          { href: '/restaurant/reports', label: 'รายงานร้าน', labelKey: 'common.nav.restaurantReports', icon: 'reports', keywords: 'รายงาน รายรับ รายจ่าย กำไร ขาย' },
          { href: '/restaurant/kitchen', label: 'ครัว IOT', labelKey: 'common.nav.restaurantKitchen', icon: 'sensors', keywords: 'ครัว น้ำหนัก ตู้เย็น HX711 อุณหภูมิ' },
        ],
      },
    ],
  },

  // ── 2b. ธุรกิจของฉัน ──
  {
    title: '🏢 ธุรกิจของฉัน',
    titleKey: 'common.nav.group.business',
    items: [
      { href: '/business', label: 'ธุรกิจของฉัน', labelKey: 'common.nav.business', icon: 'package', keywords: 'ธุรกิจ ขายของ IoT สินค้า ลูกค้า ออเดอร์ ใบเสนอราคา ชำระเงิน ติดตั้ง ช่าง การเงิน กำไร สต็อก ทีม ตำแหน่ง ผู้ช่วย AI agent' },
    ],
  },

  // ── 3. ฟาร์ม & ทรัพยากร ──
  {
    title: '🌾 ฟาร์ม & ทรัพยากร',
    titleKey: 'common.nav.group.farm',
    items: [
      { href: '/farm', label: 'แปลงเกษตร', labelKey: 'common.nav.farm', icon: 'farm', keywords: 'ฟาร์ม แปลง ดิน พืช เกษตร ปลูก เก็บเกี่ยว' },
      { href: '/livestock', label: 'ปศุสัตว์', labelKey: 'common.nav.livestock', icon: 'farm', keywords: 'ปศุสัตว์ เล้า คอก ไก่ สุกร โค เป็ด ฟาร์มปศุสัตว์' },
      { href: '/inventory', label: 'เสบียง & ทรัพยากร', labelKey: 'common.nav.inventory', icon: 'inventory', keywords: 'เสบียง คลัง สต็อก ของใช้ น้ำ อาหาร เมล็ด ยา เครื่องมือ' },
      { href: '/research/rice', label: 'วิจัยพันธุ์ข้าว', labelKey: 'common.nav.researchRice', icon: 'predictive', keywords: 'วิจัย ข้าว พันธุ์ ดิน NPK yield ผลผลิต' },
    ],
  },

  // ── 4. วันรอด & สุขภาพ ──
  {
    title: '🏥 วันรอด & สุขภาพ',
    titleKey: 'common.nav.group.selfreliance',
    items: [
      { href: '/selfreliance', label: 'วันรอด (Autonomy)', labelKey: 'common.nav.selfreliance', icon: 'shield', keywords: 'วันรอด พึ่งพาตัวเอง autonomy น้ำ อาหาร ไฟ เงิน จุดอ่อน เสบียง อยู่รอด ภัยพิบัติ' },
      { href: '/skills', label: 'ทักษะคน', labelKey: 'common.nav.skills', icon: 'users', keywords: 'ทักษะ สกิล คน ครอบครัว' },
      { href: '/health', label: 'ตรวจสุขภาพ', labelKey: 'common.nav.health', icon: 'health', keywords: 'สุขภาพ ตรวจสุขภาพ โรค คัดกรอง สมุนไพร' },
      { href: '/health/self-check', label: 'Self-Check 32 ข้อ', labelKey: 'common.nav.selfCheck', icon: 'healing', keywords: 'self-check วินิจฉัย ตัวเอง 32 ข้อ พูด พิมพ์ คัดกรอง' },
      { href: '/mbti', label: 'แบบทดสอบ MBTI', labelKey: 'common.nav.mbti', icon: 'healing', keywords: 'mbti บุคลิกภาพ 16 ประเภท แบบทดสอบ จิตวิทยา รู้จักตัวเอง สมอง ใจ E I S N T F J P' },
      { href: '/healing', label: 'ธรรมะบำบัด', labelKey: 'common.nav.healing', icon: 'healing', keywords: 'ธรรมะ สมาธิ สมุนไพร เยียวยา วัด ใจ' },
      { href: '/lifestyle', label: 'วิถีชีวิต', labelKey: 'common.nav.lifestyle', icon: 'lifestyle', keywords: 'วิถี ชีวิต ธรรมชาติ จังหวะ หน้าต่าง อากาศ แสง circadian manual day' },
      { href: '/crisis', label: 'โหมดวิกฤต', labelKey: 'common.nav.crisis', icon: 'shield', keywords: 'วิกฤต ฉุกเฉิน น้ำท่วม ดับไฟ ปลอดภัย' },
    ],
  },

  // ── 5. การเงิน & ความรู้ ──
  {
    title: '💰 การเงิน & ความรู้',
    titleKey: 'common.nav.group.finance',
    items: [
      {
        href: '/treasury',
        label: 'คลัง & ลงทุน',
        labelKey: 'common.nav.treasury',
        icon: 'portfolio',
        keywords: 'เงิน การเงิน หุ้น พอร์ต ทรัพย์สิน ลงทุน คลัง กระแสเงินสด runway survival net worth portfolio signals',
        children: [
          { href: '/treasury#net-worth', label: 'ทรัพย์สิน & เงินสด', labelKey: 'common.nav.treasuryNetWorth', icon: 'portfolio', keywords: 'ทรัพย์สิน เงินสด net worth หนี้สิน' },
          { href: '/treasury#runway', label: 'Survival Runway', labelKey: 'common.nav.treasuryRunway', icon: 'gauge', keywords: 'runway อยู่รอด เดือน ค่าใช้จ่าย' },
          { href: '/treasury#strategies', label: 'กลยุทธ์ลงทุน', labelKey: 'common.nav.treasuryStrategies', icon: 'target', keywords: 'กลยุทธ์ ลงทุน 5 ตระกูล ปันผล' },
        ],
      },
      { href: '/knowledge', label: 'คลังความรู้', labelKey: 'common.nav.knowledge', icon: 'knowledge', keywords: 'ความรู้ บทเรียน เรียน เด็ก สอน วิจัย semantic' },
      { href: '/reports', label: 'รายงาน AI', labelKey: 'common.nav.reports', icon: 'reports', keywords: 'รายงาน สรุป ai' },
    ],
  },

  // ── 6. ความปลอดภัย ──
  {
    title: '🔒 ความปลอดภัย',
    titleKey: 'common.nav.group.security',
    items: [
      { href: '/security', label: 'ความปลอดภัยไซเบอร์', labelKey: 'common.nav.security', icon: 'security', keywords: 'ไฟร์วอลล์ firewall ความปลอดภัย ไซเบอร์' },
      { href: '/vision', label: 'Vision AI (กล้อง)', labelKey: 'common.nav.vision', icon: 'vision', keywords: 'กล้อง ภาพ ตรวจจับ ใบหน้า คนแปลกหน้า' },
      { href: '/property', label: 'แผนที่ทรัพย์สิน 3D', labelKey: 'common.nav.property', icon: 'property', keywords: 'แผนที่ ที่ดิน บ้าน ทรัพย์สิน 3d จุดยุทธศาสตร์' },
      { href: '/alerts', label: 'ประวัติการแจ้งเตือน', labelKey: 'common.nav.alerts', icon: 'alerts', keywords: 'แจ้งเตือน ประวัติ เตือนภัย' },
      { href: '/risk-monitor', label: 'เฝ้าระวังความเสี่ยง', labelKey: 'common.nav.riskMonitor', icon: 'risk', keywords: 'ความเสี่ยง ข่าว monitor DEFCON' },
    ],
  },

  // ── 7. AI & อุปกรณ์ ──
  {
    title: '🤖 AI & อุปกรณ์',
    titleKey: 'common.nav.group.devicesEnergy',
    items: [
      { href: '/learning', label: 'เรียนรู้เอง (Self-Learning)', labelKey: 'common.nav.learning', icon: 'ai', keywords: 'เรียนรู้เอง self-learning data lake พยากรณ์ ทำนาย ai เรียนรู้ต่อ' },
      { href: '/ai', label: 'ศูนย์บัญชาการ AI', labelKey: 'common.nav.ai', icon: 'ai', keywords: 'ai ปัญญาประดิษฐ์ คำสั่ง chat' },
      { href: '/ai-agent', label: 'AI Agent', labelKey: 'common.nav.aiAgent', icon: 'ai-agent', keywords: 'เอเจนต์ บทบาท ตัวแทน ai coding' },
      { href: '/predictive', label: 'พยากรณ์', labelKey: 'common.nav.predictive', icon: 'predictive', keywords: 'พยากรณ์ คาดการณ์ ทำนาย แบตเตอรี่' },
      { href: '/sensors', label: 'อุปกรณ์ & เซ็นเซอร์', labelKey: 'common.nav.sensors', icon: 'sensors', keywords: 'อุปกรณ์ เซ็นเซอร์ sensor device manager ESP32' },
      { href: '/relay', label: 'ควบคุมรีเลย์', labelKey: 'common.nav.relay', icon: 'relay', keywords: 'รีเลย์ ควบคุม สวิตช์ ปั๊มน้ำ ไฟ' },
      { href: '/automation', label: 'ระบบอัตโนมัติ', labelKey: 'common.nav.automation', icon: 'automation', keywords: 'อัตโนมัติ ระบบอัตโนมัติ กฎ' },
      { href: '/energy', label: 'พลังงาน', labelKey: 'common.nav.energy', icon: 'energy', keywords: 'พลังงาน ไฟฟ้า แบตเตอรี่ โซลาร์' },
      { href: '/ota', label: 'อัปเดต OTA', labelKey: 'common.nav.ota', icon: 'ota', keywords: 'อัปเดต เฟิร์มแวร์ ota' },
      { href: '/infrastructure', label: 'โครงสร้างพื้นฐาน', labelKey: 'common.nav.infrastructure', icon: 'infrastructure', keywords: 'โครงสร้างพื้นฐาน เน็ตเวิร์ก กล้อง น้ำ' },
      { href: '/governance-sim', label: 'จำลองการปกครอง', labelKey: 'common.nav.governanceSim', icon: 'governance', keywords: 'จำลอง การปกครอง สังคม war room' },
    ],
  },

  // ── 8. ข้อมูล & รายงาน ──
  {
    title: '📊 ข้อมูล',
    titleKey: 'common.nav.group.dataReports',
    items: [
      { href: '/history', label: 'ประวัติข้อมูล', labelKey: 'common.nav.history', icon: 'history', keywords: 'ประวัติ ข้อมูล ย้อนหลัง graph' },
    ],
  },

  // ── 9. ระบบ (admin) ──
  {
    title: '⚙️ ระบบ',
    titleKey: 'common.nav.group.system',
    items: [
      { href: '/system', label: 'สุขภาพระบบ', labelKey: 'common.nav.system', icon: 'system', keywords: 'ระบบ สุขภาพ เซิร์ฟเวอร์ router' },
      { href: '/backup', label: 'สำรองข้อมูล', labelKey: 'common.nav.backup', icon: 'backup', keywords: 'สำรอง ข้อมูล backup' },
      { href: '/users', label: 'ผู้ใช้', labelKey: 'common.nav.users', icon: 'users', keywords: 'ผู้ใช้ บัญชี สมาชิก' },
      { href: '/audit', label: 'บันทึกตรวจสอบ', labelKey: 'common.nav.audit', icon: 'audit', keywords: 'log ตรวจสอบ audit' },
      { href: '/settings', label: 'ตั้งค่า', labelKey: 'common.nav.settings', icon: 'settings', keywords: 'ตั้งค่า ปรับแต่ง clone export' },
      { href: '/change-password', label: 'เปลี่ยนรหัสผ่าน', labelKey: 'common.nav.changePassword', icon: 'key', keywords: 'รหัสผ่าน เปลี่ยน password' },
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
