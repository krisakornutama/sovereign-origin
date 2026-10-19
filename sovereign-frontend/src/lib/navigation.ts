// ─────────────────────────────────────────────────────────────
//  แหล่งเดียวของเมนูทั้งหมดในแอป (Single source of truth)
//  ใช้ร่วมกันโดย: Sidebar, CommandPalette (⌘K), MobileNav, PageHeader (แท็บศูนย์)
//  แก้ที่นี่ที่เดียว → ทุกที่เปลี่ยนตาม
//  icon = ชื่อไอคอนจาก components/ui/Icon.tsx
//  label = ข้อความไทย (default) / labelKey = key สำหรับสลับภาษาอังกฤษ
//  ── จัดกลุ่มตามการใช้งานจริง ไม่ใช่ตามเทคโนโลยี ──
//
//  19/10/69 — ควบรวมเมนูตามคำสั่งเจ้าของ (ลดปุ่มที่ไม่จำเป็น):
//    • SECTIONS = "ศูนย์" ที่รวมหน้าเดิมไว้เป็นแท็บ (ไม่ต้องมีเมนูแยก 8-9 ปุ่ม)
//    • Sidebar แสดงเฉพาะทางเข้าเดียวของแต่ละศูนย์; หน้าลูกเข้าถึงได้จากแท็บใน PageHeader
//    • หน้าเดิมยังอยู่ครบ (deep link ไม่พัง) และ CommandPalette ค้นเจอทุกแท็บ
//  ─────────────────────────────────────────────────────────────

export type NavItem = {
  href: string;
  label: string;
  labelKey: string;
  icon: string;
  keywords?: string;
  children?: NavItem[];
  /** true = Sidebar แสดงลูกศรพับ/กาง (ค่าเริ่มต้น: แสดงลูกตลอด) */
  collapsible?: boolean;
};
export type NavGroup = { title: string; titleKey: string; items: NavItem[] };

/** หน้าในศูนย์เดียวกัน — PageHeader จะแสดงเป็นแท็บให้สลับได้โดยไม่ต้องกลับไปหาเมนู */
export type NavSection = {
  id: string;
  title: string;
  titleKey: string;
  icon: string;
  tabs: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  // ── 1. หน้าหลัก ──
  {
    title: 'ภาพรวม',
    titleKey: 'common.nav.group.overview',
    items: [
      { href: '/dashboard', label: 'หน้าหลัก', labelKey: 'common.nav.dashboard', icon: 'dashboard', keywords: 'หน้าหลัก home ภาพรวม สถานะ' },
    ],
  },

  // ── 1b. ควบคุมระยะไกล (เครื่องในเครือข่าย) ──
  //  เจ้าของสั่ง 11/10/69: ต้องมีเมนู "ควบคุมระยะไกล" ให้เห็นชัด
  //  รวมของที่เกี่ยวกับการสั่งเครื่องอื่นไว้ที่เดียว: ดูจอ/คุมเครื่อง · สั่งงาน AI · สั่งอัปเดตโค้ด (OTA)
  {
    title: '🖥️ ควบคุมระยะไกล',
    titleKey: 'common.nav.group.remote',
    items: [
      {
        href: '/fleet',
        label: 'ศูนย์ควบคุมฝูงเครื่อง',
        labelKey: 'common.nav.fleet',
        icon: 'system',
        keywords:
          'fleet ฝูงเครื่อง ศูนย์ควบคุม เครื่องทั้งหมด สาขา site group channel rollout stable beta canary enrollment token compliance update',
      },
      {
        href: '/machine-console',
        label: 'คอนโซลเครื่อง',
        labelKey: 'common.nav.machineConsole',
        icon: 'terminal',
        keywords:
          'คอนโทรล ควบคุมระยะไกล คอนโซล เครื่อง เครื่องที่ 2 3 4 ระยะไกล ดูจอ เมาส์ คีย์บอร์ด ไฟล์ ควบคุม remote screen control file terminal ip',
      },
      {
        href: '/agent-queue',
        label: 'คิวเอเจนต์',
        labelKey: 'common.nav.agentQueue',
        icon: 'ai-agent',
        keywords: 'คิว งาน agent เครื่อง runner dispatch โน้ตบุ๊ค สั่งงาน',
      },
      {
        href: '/ota',
        label: 'อัปเดตเครื่อง (OTA)',
        labelKey: 'common.nav.ota',
        icon: 'ota',
        keywords: 'อัปเดต เฟิร์มแวร์ ota เครื่องลูก hub สั่งอัปเดต ชุดติดตั้ง',
      },
    ],
  },

  // ── 2. ร้านอาหาร (ธุรกิจ) ──
  //  เจ้าของ 19/10/69: ให้พับเก็บได้ (ปกติมีหัวข้อย่อย 4 อัน)
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
        collapsible: true,
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
      // 13/10/69: ถอด "Catalog กลางชุมชน" (/community) ออกจากเมนู — เป็นหน้าไดเรกทอรีของเว็บ
      //   ที่ลิงก์ไปหน้าร้าน/เครือข่ายคู่ค้าสาธารณะ ซึ่งถูกย้ายไป E:\My work\Sovereign-Web-Standalone
      //   เหลือแต่ "ธุรกิจของฉัน" ที่เป็นของแอป desktop จริง
    ],
  },

  // ── 3. ฟาร์ม & ทรัพยากร ──
  //  วิจัยพันธุ์ข้าวย้ายไปเป็นแท็บใน "ตามรอยผลผลิต" (19/10/69)
  {
    title: '🌾 ฟาร์ม & ทรัพยากร',
    titleKey: 'common.nav.group.farm',
    items: [
      { href: '/farm', label: 'แปลงเกษตร', labelKey: 'common.nav.farm', icon: 'farm', keywords: 'ฟาร์ม แปลง ดิน พืช เกษตร ปลูก เก็บเกี่ยว' },
      { href: '/trace', label: 'ตามรอยผลผลิต', labelKey: 'common.nav.trace', icon: 'search', keywords: 'ตามรอย trace lot ล็อต ผลผลิต qr สแกน ที่มา ต้นทาง traceability วิจัย ข้าว พันธุ์' },
      { href: '/livestock', label: 'ปศุสัตว์', labelKey: 'common.nav.livestock', icon: 'farm', keywords: 'ปศุสัตว์ เล้า คอก ไก่ สุกร โค เป็ด ฟาร์มปศุสัตว์' },
      { href: '/inventory', label: 'เสบียง & ทรัพยากร', labelKey: 'common.nav.inventory', icon: 'inventory', keywords: 'เสบียง คลัง สต็อก ของใช้ น้ำ อาหาร เมล็ด ยา เครื่องมือ' },
    ],
  },

  // ── 4. วันรอด & สุขภาพ ──
  //  Self-Check 32 + MBTI ย้ายไปเป็นแท็บใน "ตรวจสุขภาพ" (19/10/69)
  {
    title: '🏥 วันรอด & สุขภาพ',
    titleKey: 'common.nav.group.selfreliance',
    items: [
      { href: '/selfreliance', label: 'วันรอด (Autonomy)', labelKey: 'common.nav.selfreliance', icon: 'shield', keywords: 'วันรอด พึ่งพาตัวเอง autonomy น้ำ อาหาร ไฟ เงิน จุดอ่อน เสบียง อยู่รอด ภัยพิบัติ' },
      { href: '/skills', label: 'ทักษะคน', labelKey: 'common.nav.skills', icon: 'users', keywords: 'ทักษะ สกิล คน ครอบครัว' },
      { href: '/health', label: 'ตรวจสุขภาพ', labelKey: 'common.nav.health', icon: 'health', keywords: 'สุขภาพ ตรวจสุขภาพ โรค คัดกรอง สมุนไพร self-check 32 ข้อ mbti บุคลิกภาพ' },
      { href: '/healing', label: 'ธรรมะบำบัด', labelKey: 'common.nav.healing', icon: 'healing', keywords: 'ธรรมะ สมาธิ สมุนไพร เยียวยา วัด ใจ' },
      { href: '/lifestyle', label: 'วิถีชีวิต', labelKey: 'common.nav.lifestyle', icon: 'lifestyle', keywords: 'วิถี ชีวิต ธรรมชาติ จังหวะ หน้าต่าง อากาศ แสง circadian manual day' },
      { href: '/crisis', label: 'โหมดวิกฤต', labelKey: 'common.nav.crisis', icon: 'shield', keywords: 'วิกฤต ฉุกเฉิน น้ำท่วม ดับไฟ ปลอดภัย' },
    ],
  },

  // ── 5. การเงิน & ลงทุน ──
  //  เจ้าของ 19/10/69: ให้พับเก็บได้ (หัวข้อย่อย 4 หัวข้อ)
  {
    title: '💰 การเงิน & ลงทุน',
    titleKey: 'common.nav.group.finance',
    items: [
      {
        href: '/treasury',
        label: 'คลัง & ลงทุน',
        labelKey: 'common.nav.treasury',
        icon: 'portfolio',
        keywords: 'เงิน การเงิน หุ้น พอร์ต ทรัพย์สิน ลงทุน คลัง กระแสเงินสด runway survival net worth portfolio signals',
        collapsible: true,
        children: [
          { href: '/treasury#net-worth', label: 'ทรัพย์สิน & เงินสด', labelKey: 'common.nav.treasuryNetWorth', icon: 'portfolio', keywords: 'ทรัพย์สิน เงินสด net worth หนี้สิน' },
          { href: '/treasury#runway', label: 'Survival Runway', labelKey: 'common.nav.treasuryRunway', icon: 'gauge', keywords: 'runway อยู่รอด เดือน ค่าใช้จ่าย' },
          { href: '/treasury#strategies', label: 'กลยุทธ์ลงทุน', labelKey: 'common.nav.treasuryStrategies', icon: 'target', keywords: 'กลยุทธ์ ลงทุน 5 ตระกูล ปันผล' },
        ],
      },
    ],
  },

  // ── 6. ศูนย์บัญชาการ AI (19/10/69) ──
  //  รวม พยากรณ์ · จำลองการปกครอง · เรียนรู้เอง · เฝ้าระวังความเสี่ยง · แผนที่ทรัพย์สิน
  //      ประวัติแจ้งเตือน · คลังความรู้ · รายงาน AI ไว้เป็นแท็บในหน้า /ai
  {
    title: '🧠 AI',
    titleKey: 'common.nav.group.ai',
    items: [
      { href: '/ai', label: 'ศูนย์บัญชาการ AI', labelKey: 'common.nav.ai', icon: 'ai', keywords: 'ai ปัญญาประดิษฐ์ คำสั่ง chat พยากรณ์ จำลองการปกครอง เรียนรู้เอง เฝ้าระวังความเสี่ยง แผนที่ทรัพย์สิน ประวัติแจ้งเตือน คลังความรู้ รายงาน' },
      { href: '/ai-agent', label: 'AI Agent', labelKey: 'common.nav.aiAgent', icon: 'ai-agent', keywords: 'เอเจนต์ บทบาท ตัวแทน ai coding' },
    ],
  },

  // ── 7. ระบบพื้นฐาน & อุปกรณ์ (19/10/69) ──
  //  รวม โครงสร้างพื้นฐาน · พลังงาน · ระบบอัตโนมัติ · ควบคุมรีเลย์ เป็นแท็บใน /infrastructure
  {
    title: '⚡ ระบบพื้นฐาน',
    titleKey: 'common.nav.group.core',
    items: [
      { href: '/infrastructure', label: 'โครงสร้างพื้นฐาน', labelKey: 'common.nav.infrastructure', icon: 'infrastructure', keywords: 'โครงสร้างพื้นฐาน เน็ตเวิร์ก กล้อง น้ำ พลังงาน ไฟฟ้า แบตเตอรี่ โซลาร์ อัตโนมัติ รีเลย์ สวิตช์' },
      { href: '/sensors', label: 'อุปกรณ์ & เซ็นเซอร์', labelKey: 'common.nav.sensors', icon: 'sensors', keywords: 'อุปกรณ์ เซ็นเซอร์ sensor device manager ESP32' },
      { href: '/security', label: 'ความปลอดภัยไซเบอร์', labelKey: 'common.nav.security', icon: 'security', keywords: 'ไฟร์วอลล์ firewall ความปลอดภัย ไซเบอร์' },
      { href: '/vision', label: 'Vision AI (กล้อง)', labelKey: 'common.nav.vision', icon: 'vision', keywords: 'กล้อง ภาพ ตรวจจับ ใบหน้า คนแปลกหน้า' },
    ],
  },

  // ── 8. ระบบ (admin) ──
  //  ความจริงระบบ → แท็บในสุขภาพระบบ · ประวัติแจ้งเตือน → แท็บในสุขภาพระบบ
  //  สำรองข้อมูล + เปลี่ยนรหัสผ่าน → แท็บในตั้งค่า
  {
    title: '⚙️ ระบบ',
    titleKey: 'common.nav.group.system',
    items: [
      { href: '/system', label: 'สุขภาพระบบ', labelKey: 'common.nav.system', icon: 'system', keywords: 'ระบบ สุขภาพ เซิร์ฟเวอร์ router ความจริง fingerprint build migration verify prod truth' },
      { href: '/users', label: 'ผู้ใช้', labelKey: 'common.nav.users', icon: 'users', keywords: 'ผู้ใช้ บัญชี สมาชิก' },
      { href: '/audit', label: 'บันทึกตรวจสอบ', labelKey: 'common.nav.audit', icon: 'audit', keywords: 'log ตรวจสอบ audit' },
      { href: '/history', label: 'ประวัติข้อมูล', labelKey: 'common.nav.history', icon: 'history', keywords: 'ประวัติ ข้อมูล ย้อนหลัง graph' },
      { href: '/settings', label: 'ตั้งค่า', labelKey: 'common.nav.settings', icon: 'settings', keywords: 'ตั้งค่า ปรับแต่ง clone export สำรองข้อมูล backup เปลี่ยนรหัสผ่าน password' },
    ],
  },
];

// ── ศูนย์ที่รวมหน้าเดิมเป็นแท็บ ──
//  ลำดับแรกของ tabs = หน้าเจ้าบ้าน (path ที่ Sidebar ลิงก์ไป)
export const SECTIONS: NavSection[] = [
  {
    id: 'ai',
    title: 'ศูนย์บัญชาการ AI',
    titleKey: 'common.nav.ai',
    icon: 'ai',
    tabs: [
      { href: '/ai', label: 'ภาพรวม', labelKey: 'common.nav.aiOverview', icon: 'ai', keywords: 'ภาพรวม ศูนย์บัญชาการ ai' },
      { href: '/predictive', label: 'พยากรณ์', labelKey: 'common.nav.predictive', icon: 'predictive', keywords: 'พยากรณ์ คาดการณ์ ทำนาย แบตเตอรี่' },
      { href: '/governance-sim', label: 'จำลองการปกครอง', labelKey: 'common.nav.governanceSim', icon: 'governance', keywords: 'จำลอง การปกครอง สังคม war room' },
      { href: '/learning', label: 'เรียนรู้เอง (Self-Learning)', labelKey: 'common.nav.learning', icon: 'ai', keywords: 'เรียนรู้เอง self-learning data lake พยากรณ์ ทำนาย ai เรียนรู้ต่อ' },
      { href: '/risk-monitor', label: 'เฝ้าระวังความเสี่ยง', labelKey: 'common.nav.riskMonitor', icon: 'risk', keywords: 'ความเสี่ยง ข่าว monitor DEFCON' },
      { href: '/property', label: 'แผนที่ทรัพย์สิน 3D', labelKey: 'common.nav.property', icon: 'property', keywords: 'แผนที่ ที่ดิน บ้าน ทรัพย์สิน 3d จุดยุทธศาสตร์' },
      { href: '/alerts', label: 'ประวัติการแจ้งเตือน', labelKey: 'common.nav.alerts', icon: 'alerts', keywords: 'แจ้งเตือน ประวัติ เตือนภัย' },
      { href: '/knowledge', label: 'คลังความรู้', labelKey: 'common.nav.knowledge', icon: 'knowledge', keywords: 'ความรู้ บทเรียน เรียน เด็ก สอน วิจัย semantic' },
      { href: '/reports', label: 'รายงาน AI', labelKey: 'common.nav.reports', icon: 'reports', keywords: 'รายงาน สรุป ai' },
    ],
  },
  {
    id: 'health',
    title: 'ตรวจสุขภาพ',
    titleKey: 'common.nav.health',
    icon: 'health',
    tabs: [
      { href: '/health', label: 'ภาพรวมสุขภาพ', labelKey: 'common.nav.healthOverview', icon: 'health', keywords: 'สุขภาพ ตรวจสุขภาพ โรค คัดกรอง สมุนไพร' },
      { href: '/health/self-check', label: 'Self-Check 32 ข้อ', labelKey: 'common.nav.selfCheck', icon: 'healing', keywords: 'self-check วินิจฉัย ตัวเอง 32 ข้อ พูด พิมพ์ คัดกรอง' },
      { href: '/mbti', label: 'แบบทดสอบ MBTI', labelKey: 'common.nav.mbti', icon: 'healing', keywords: 'mbti บุคลิกภาพ 16 ประเภท แบบทดสอบ จิตวิทยา รู้จักตัวเอง สมอง ใจ E I S N T F J P' },
    ],
  },
  {
    id: 'trace',
    title: 'ตามรอยผลผลิต',
    titleKey: 'common.nav.trace',
    icon: 'search',
    tabs: [
      { href: '/trace', label: 'ตามรอยผลผลิต', labelKey: 'common.nav.trace', icon: 'search', keywords: 'ตามรอย trace lot ล็อต ผลผลิต qr สแกน ที่มา ต้นทาง traceability' },
      { href: '/research/rice', label: 'วิจัยพันธุ์ข้าว', labelKey: 'common.nav.researchRice', icon: 'predictive', keywords: 'วิจัย ข้าว พันธุ์ ดิน NPK yield ผลผลิต' },
    ],
  },
  {
    id: 'infrastructure',
    title: 'ระบบพื้นฐาน',
    titleKey: 'common.nav.group.core',
    icon: 'infrastructure',
    tabs: [
      { href: '/infrastructure', label: 'ภาพรวมระบบ', labelKey: 'common.nav.infrastructure', icon: 'infrastructure', keywords: 'โครงสร้างพื้นฐาน เน็ตเวิร์ก กล้อง น้ำ' },
      { href: '/energy', label: 'พลังงาน', labelKey: 'common.nav.energy', icon: 'energy', keywords: 'พลังงาน ไฟฟ้า แบตเตอรี่ โซลาร์' },
      { href: '/automation', label: 'ระบบอัตโนมัติ', labelKey: 'common.nav.automation', icon: 'automation', keywords: 'อัตโนมัติ ระบบอัตโนมัติ กฎ' },
      { href: '/relay', label: 'ควบคุมรีเลย์', labelKey: 'common.nav.relay', icon: 'relay', keywords: 'รีเลย์ ควบคุม สวิตช์ ปั๊มน้ำ ไฟ' },
    ],
  },
  {
    id: 'system',
    title: 'สุขภาพระบบ',
    titleKey: 'common.nav.system',
    icon: 'system',
    tabs: [
      { href: '/system', label: 'สุขภาพระบบ', labelKey: 'common.nav.system', icon: 'system', keywords: 'ระบบ สุขภาพ เซิร์ฟเวอร์ router' },
      { href: '/system-health', label: 'ความจริงระบบ', labelKey: 'common.nav.systemHealth', icon: 'system', keywords: 'ความจริง fingerprint build migration เกต verify prod truth รันโค้ดเก่า' },
      { href: '/alert-history', label: 'ประวัติแจ้งเตือน', labelKey: 'common.nav.alertHistory', icon: 'alerts', keywords: 'alert แจ้งเตือน telegram watchdog ประวัติ ยับ dedup ส่งสำเร็จ' },
    ],
  },
  {
    id: 'settings',
    title: 'ตั้งค่า',
    titleKey: 'common.nav.settings',
    icon: 'settings',
    tabs: [
      { href: '/settings', label: 'ตั้งค่า', labelKey: 'common.nav.settings', icon: 'settings', keywords: 'ตั้งค่า ปรับแต่ง clone export' },
      { href: '/backup', label: 'สำรองข้อมูล', labelKey: 'common.nav.backup', icon: 'backup', keywords: 'สำรอง ข้อมูล backup' },
      { href: '/change-password', label: 'เปลี่ยนรหัสผ่าน', labelKey: 'common.nav.changePassword', icon: 'key', keywords: 'รหัสผ่าน เปลี่ยน password' },
    ],
  },
];

/** ตัด trailing slash / query / hash เพื่อเทียบเส้นทาง */
export function normalizeNavHref(href: string): string {
  const clean = (href || '/').split('#')[0].split('?')[0].replace(/\/+$/, '');
  return clean || '/';
}

/** ศูนย์ของเส้นทางปัจจุบัน (ใช้กับ Sidebar/MobileNav/PageHeader) */
export function sectionForPath(pathname: string): NavSection | null {
  const clean = normalizeNavHref(pathname);
  for (const section of SECTIONS) {
    if (section.tabs.some((tab) => normalizeNavHref(tab.href) === clean)) return section;
  }
  return null;
}

/** รายการหน้าทั้งหมดแบบแบน (สำหรับ CommandPalette) — รวมแท็บของทุกศูนย์ด้วย */
export const ALL_PAGES: Array<NavItem & { group: string; groupKey: string }> = (() => {
  const navPages: Array<NavItem & { group: string; groupKey: string }> = NAV_GROUPS.flatMap((g) =>
    g.items.flatMap((i) => [
      { ...i, group: g.title, groupKey: g.titleKey },
      ...(i.children ?? []).map((c) => ({ ...c, group: g.title, groupKey: g.titleKey })),
    ])
  );
  const sectionPages: Array<NavItem & { group: string; groupKey: string }> = SECTIONS.flatMap((section) =>
    section.tabs.map((tab) => ({ ...tab, group: section.title, groupKey: section.titleKey }))
  );
  // กันซ้ำ: หน้าเจ้าบ้านอาจอยู่ในเมนูหลักแล้ว (เช่น /ai, /health, /trace)
  const seen = new Set<string>();
  return [...navPages, ...sectionPages].filter((p) => {
    if (seen.has(p.href)) return false;
    seen.add(p.href);
    return true;
  });
})();
