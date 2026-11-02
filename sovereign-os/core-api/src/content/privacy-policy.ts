// src/content/privacy-policy.ts
//
// เนื้อนโยบายความเป็นส่วนตัว (PDPA) — แหล่งความจริงเดียวที่ผูกกับ CONSENT_POLICY_VERSION
// เหตุผลที่อยู่ในโค้ด: เวอร์ชันในหลักฐานความยินยอมต้องตรงกับข้อความที่ผู้ใช้เห็นจริง
// ถ้าแก้ข้อความ ต้อง bump CONSENT_POLICY_VERSION ไม่งั้นหลักฐานจะอ้างนโยบายผิดฉบับ
//
// หมายเหตุสำหรับเจ้าของ: ชื่อ/อีเมลผู้ควบคุมข้อมูลอ่านจาก env (ไม่ hardcode)
//   PRIVACY_CONTROLLER_NAME, PRIVACY_CONTACT_EMAIL, PRIVACY_CONTACT_ADDRESS
// ถ้ายังไม่ตั้ง ระบบจะบอกตรง ๆ ว่า "ยังไม่ได้ระบุผู้ควบคุมข้อมูล" — ห้ามเผยแพร่ก่อนเติม

export interface PolicySection {
  id: string;
  title: string;
  paragraphs: string[];
  titleEn: string;
  paragraphsEn: string[];
}

export const PRIVACY_EFFECTIVE_DATE = '2026-11-03';

export function privacyController() {
  return {
    name: process.env.PRIVACY_CONTROLLER_NAME || null,
    email: process.env.PRIVACY_CONTACT_EMAIL || null,
    address: process.env.PRIVACY_CONTACT_ADDRESS || null,
  };
}

export function privacyPolicySections(): PolicySection[] {
  return [
    {
      id: 'who',
      title: 'ผู้ควบคุมข้อมูลส่วนบุคคล',
      paragraphs: [
        'ข้อมูลส่วนบุคคลที่เก็บในระบบนี้อยู่ภายใต้ความรับผิดชอบของผู้ให้บริการที่ระบุไว้ด้านล่างนี้',
        'หากยังไม่มีการระบุชื่อและช่องทางติดต่อ ถือว่านโยบายฉบับนี้ยังไม่สมบูรณ์และห้ามนำไปใช้เก็บข้อมูลของบุคคลภายนอก',
        'ติดต่อได้ทางอีเมลที่ระบุไว้ในหัวข้อ "ช่องทางติดต่อ" ด้านล่าง',
      ],
      titleEn: 'Data controller',
      paragraphsEn: [
        'Personal data in this system is controlled by the provider identified below.',
        'If no controller name and contact are configured, this policy is incomplete and must not be used to collect third-party data.',
        'Contact details are listed in the "Contact" section below.',
      ],
    },
    {
      id: 'data',
      title: 'ข้อมูลที่เราเก็บ',
      paragraphs: [
        'ข้อมูลบัญชี: ชื่อผู้ใช้ รหัสผ่านที่ผ่านการเข้ารหัสทางเดียว (ไม่สามารถอ่านย้อนกลับได้) บทบาทและสิทธิ์การใช้งาน',
        'ข้อมูลการใช้งานระบบ: บันทึกการทำงาน (audit log) เวลาที่เข้าใช้งาน ที่อยู่ IP และประเภทอุปกรณ์/เบราว์เซอร์ที่ใช้เชื่อมต่อ',
        'ข้อมูลที่คุณสร้างเอง: ข้อมูลธุรกิจ สินค้า ลูกค้า เอกสาร หรือข้อมูลสุขภาพที่คุณบันทึกเข้าไปในระบบ',
        'ข้อมูลเครื่องที่เชื่อมต่อ: ชื่อเครื่อง สถานะการเชื่อมต่อ และข้อมูลทางเทคนิคที่จำเป็นต่อการสั่งงานระยะไกล',
        'เราไม่เก็บข้อมูลบัตรชำระเงินแบบเต็มรูปแบบ — ระบบไม่รับและไม่จัดเก็บเลขบัตร เครดิต/เดบิต',
      ],
      titleEn: 'What we collect',
      paragraphsEn: [
        'Account data: username, one-way hashed password (not reversible), role and permissions.',
        'Usage data: audit logs, access times, IP address, device/browser type used to connect.',
        'Content you create: business, product, customer, document or health records you enter into the system.',
        'Connected devices: machine name, connection status and technical data required for remote commands.',
        'We do not store full card numbers — the system does not accept or retain credit/debit card data.',
      ],
    },
    {
      id: 'purpose',
      title: 'วัตถุประสงค์และฐานทางกฎหมาย',
      paragraphs: [
        'ให้บริการตามสัญญา: ให้บัญชี การเข้าสู่ระบบ การทำงานหลัก และการสนับสนุนผู้ใช้ (ฐานสัญญา)',
        'ความปลอดภัยของระบบ: ตรวจจับการบุกรุก ป้องกันการใช้งานผิดวัตถุประสงค์ และเก็บหลักฐานการตรวจสอบ (ฐานประโยชน์โดยชอบด้วยกฎหมาย)',
        'ปฏิบัติตามกฎหมาย: เก็บรักษาบันทึกเท่าที่กฎหมายกำหนด เช่น กฎหมายบัญชีและภาษี (ฐานหน้าที่ตามกฎหมาย)',
        'การตลาด การวิเคราะห์ และข้อมูลสุขภาพ: ใช้เฉพาะเมื่อคุณให้ความยินยอม และถอนได้ทุกเมื่อที่หน้า "ความยินยอม"',
      ],
      titleEn: 'Purposes and legal bases',
      paragraphsEn: [
        'Service delivery: account, sign-in, core features and support (contract basis).',
        'Security: intrusion detection, abuse prevention and audit evidence (legitimate interest).',
        'Legal compliance: records retention required by accounting/tax law (legal obligation).',
        'Marketing, analytics and health data: only with your consent, withdrawable any time on the Consent page.',
      ],
    },
    {
      id: 'retention',
      title: 'ระยะเวลาการเก็บรักษา',
      paragraphs: [
        'ข้อมูลบัญชี: เก็บตลอดระยะเวลาที่บัญชีใช้งาน และไม่เกิน 90 วันหลังบัญชีถูกปิดหรือถูกลบ',
        'บันทึกการตรวจสอบ (audit log): เก็บตามที่จำเป็นต่อความปลอดภัยและการสอบทานย้อนหลัง',
        'ข้อมูลที่คุณลบเอง: ลบหรือทำให้ไม่ระบุตัวตนภายในเวลาที่ระบบประมวลผล (โดยปกติไม่เกิน 30 วัน) เว้นแต่มีหน้าที่ต้องเก็บตามกฎหมาย',
        'เมื่อครบกำหนด ระบบจะลบหรือทำให้ข้อมูลไม่สามารถระบุตัวบุคคลได้',
      ],
      titleEn: 'Retention',
      paragraphsEn: [
        'Account data: kept while the account is active, and no longer than 90 days after closure or deletion.',
        'Audit logs: retained as required for security and retrospective review.',
        'Content you delete: removed or anonymised within normal processing time (typically within 30 days) unless retention is legally required.',
        'After the retention period, data is deleted or irreversibly de-identified.',
      ],
    },
    {
      id: 'sharing',
      title: 'การเปิดเผยข้อมูลและการโอนไปต่างประเทศ',
      paragraphs: [
        'เราไม่ขายข้อมูลส่วนบุคคลของคุณ',
        'อาจเปิดเผยต่อผู้ให้บริการที่จำเป็นต่อการทำงาน เช่น ผู้ให้บริการโครงสร้างพื้นฐาน/โฮสติ้ง ผู้ให้บริการแจ้งเตือน และผู้ให้บริการชำระเงิน โดยจำกัดเฉพาะข้อมูลที่จำเป็นและผูกด้วยสัญญาประมวลผลข้อมูล',
        'หากมีการโอนข้อมูลออกนอกประเทศไทย เราจะใช้มาตรการคุ้มครองตามที่กฎหมายกำหนด และแจ้งให้ทราบผ่านนโยบายฉบับนี้',
      ],
      titleEn: 'Disclosure and cross-border transfer',
      paragraphsEn: [
        'We do not sell your personal data.',
        'Data may be shared with processors strictly necessary to operate the service (hosting/infrastructure, notification and payment providers), limited to what is required and bound by data-processing terms.',
        'Where data is transferred outside Thailand, legally required safeguards apply and will be reflected in this policy.',
      ],
    },
    {
      id: 'rights',
      title: 'สิทธิ์ของคุณ',
      paragraphs: [
        'สิทธิ์เข้าถึงและขอสำเนาข้อมูลส่วนบุคคลของคุณ',
        'สิทธิ์ขอแก้ไขข้อมูลที่ไม่ถูกต้อง',
        'สิทธิ์ขอลบหรือทำลายข้อมูล (สิทธิ์ถูกลืม) — ใช้ได้ที่หน้า "ความยินยอม" หรือติดต่อผู้ควบคุมข้อมูล',
        'สิทธิ์ขอระงับการใช้ข้อมูล และสิทธิ์คัดค้านการประมวลผล',
        'สิทธิ์ถอนความยินยอมเมื่อใดก็ได้ โดยไม่กระทบการประมวลผลที่ทำไปแล้วอย่างชอบด้วยกฎหมาย',
        'สิทธิ์ร้องเรียนต่อสำนักงานคณะกรรมการคุ้มครองข้อมูลส่วนบุคคล (สคส.) หากเห็นว่าการประมวลผลไม่ชอบด้วยกฎหมาย',
        'เราจะตอบสนองคำขอภายใน 30 วันนับจากวันที่ได้รับคำขอที่ตรวจสอบตัวตนได้',
      ],
      titleEn: 'Your rights',
      paragraphsEn: [
        'Right to access and obtain a copy of your personal data.',
        'Right to rectify inaccurate data.',
        'Right to erasure — available on the Consent page or by contacting the controller.',
        'Right to restrict processing and right to object.',
        'Right to withdraw consent at any time, without affecting lawful processing already carried out.',
        'Right to lodge a complaint with the Thai Personal Data Protection Committee (PDPC).',
        'We respond to verifiable requests within 30 days.',
      ],
    },
    {
      id: 'security',
      title: 'มาตรการรักษาความปลอดภัย',
      paragraphs: [
        'ข้อมูลอ่อนไหวถูกเข้ารหัสก่อนบันทึก และรหัสผ่านถูกเก็บแบบ hash ทางเดียว',
        'การเข้าถึงถูกจำกัดตามบทบาท และทุกการเปลี่ยนแปลงสำคัญถูกบันทึกใน audit log',
        'การเชื่อมต่อกับระบบใช้การเข้ารหัสระหว่างทาง (HTTPS) เมื่อให้บริการผ่านโดเมนจริง',
        'แม้มีมาตรการข้างต้น ไม่มีระบบใดปลอดภัย 100% — หากพบเหตุละเมิดข้อมูล เราจะแจ้งตามที่กฎหมายกำหนด',
      ],
      titleEn: 'Security measures',
      paragraphsEn: [
        'Sensitive fields are encrypted at rest and passwords are stored as one-way hashes.',
        'Access is role-based and material changes are recorded in an audit log.',
        'Traffic is encrypted in transit (HTTPS) when served on a real domain.',
        'No system is perfectly secure; if a breach occurs we will notify as required by law.',
      ],
    },
    {
      id: 'children',
      title: 'ผู้เยาว์',
      paragraphs: [
        'ระบบนี้ไม่ได้ออกแบบสำหรับผู้ใช้อายุต่ำกว่า 20 ปี หากจำเป็นต้องเก็บข้อมูลผู้เยาว์ ต้องได้รับความยินยอมจากผู้ใช้อำนาจปกครองตามกฎหมาย',
      ],
      titleEn: 'Minors',
      paragraphsEn: [
        'This system is not designed for users under 20. Where data of minors is necessary, consent from a legal guardian is required.',
      ],
    },
    {
      id: 'changes',
      title: 'การเปลี่ยนแปลงนโยบาย',
      paragraphs: [
        'เมื่อมีการแก้ไขสาระสำคัญ เราจะเพิ่มเวอร์ชันนโยบายและขอความยินยอมใหม่ในส่วนที่เกี่ยวข้อง',
        'เวอร์ชันที่ใช้บังคับแสดงอยู่ที่หน้า "ความยินยอม" และในบันทึกความยินยอมของคุณ',
      ],
      titleEn: 'Changes to this policy',
      paragraphsEn: [
        'Material changes bump the policy version and trigger a fresh consent request for the affected purposes.',
        'The version in force is shown on the Consent page and recorded with your consent history.',
      ],
    },
    {
      id: 'contact',
      title: 'ช่องทางติดต่อ',
      paragraphs: [
        'ผู้ควบคุมข้อมูล: ระบุในช่องด้านล่าง (ถ้าว่าง = ยังไม่ได้ตั้งค่า ห้ามเผยแพร่)',
        'อีเมลติดต่อ: ระบุในช่องด้านล่าง',
        'ที่อยู่สำหรับติดต่อเป็นลายลักษณ์อักษร: ระบุในช่องด้านล่าง',
      ],
      titleEn: 'Contact',
      paragraphsEn: [
        'Data controller: shown below (blank means not configured — do not publish).',
        'Contact email: shown below.',
        'Postal address: shown below.',
      ],
    },
  ];
}
