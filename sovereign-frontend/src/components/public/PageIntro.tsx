// src/components/public/PageIntro.tsx
// บล็อกอธิบายแบบ static สำหรับหน้าสาธารณะ (3/10/69)
// ทำไมต้องมี: เกณฑ์ thin content ใน tools/verify/seo-preflight.mjs จับได้ว่าหน้าสาธารณะ
// หลายหน้ามี HTML สั้นเกิน 800 ตัวอักษร เพราะเนื้อหาจริงมาจาก API ที่ยิงหลัง JS รัน
// (และการซ่อน Sidebar ทำให้ตัวเลขลดลงอีก เพราะเคยนับข้อความเมนูภายในไปด้วย)
// → วิธีแก้ที่ถูกคือ "เพิ่มเนื้อหาจริง" ไม่ใช่ลดเกณฑ์ เพราะเกณฑ์คือตัวแทนของสิ่งที่ Google ใช้ตัดสิน
//
// ข้อสำคัญ: ข้อความในนี้ต้องเป็นเนื้อหาที่ผู้อ่านได้ประโยชน์จริง ไม่ใช่การยัดคำให้ยาว
// และต้องตรงกับพฤติกรรมของระบบจริง (ห้ามอ้างตัวเลขที่ไม่ได้มาจากโค้ด/ฐานข้อมูล)
'use client';

export interface PageIntroLink {
  href: string;
  label: string;
}

export default function PageIntro({
  heading,
  paragraphs,
  links = [],
}: {
  heading: string;
  paragraphs: string[];
  links?: PageIntroLink[];
}) {
  return (
    <section className="card p-4 space-y-2" aria-label={heading}>
      <h2 className="font-ledger text-sm text-gray-300">{heading}</h2>
      {paragraphs.map((p) => (
        <p key={p} className="text-[11px] text-gray-500 leading-relaxed">{p}</p>
      ))}
      {links.length > 0 && (
        <p className="text-[11px] text-gray-500">
          ดูต่อที่{' '}
          {links.map((l, i) => (
            <span key={l.href}>
              {i > 0 && ' · '}
              <a href={l.href} className="text-cyan-300 underline underline-offset-2">{l.label}</a>
            </span>
          ))}
        </p>
      )}
    </section>
  );
}