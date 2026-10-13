import { useState } from 'react';
import { useRouter } from 'next/router';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';
import EmptyState from '../components/ui/EmptyState';
import Modal from '../components/ui/Modal';
import { useSoverienStore } from '../stores/useSoverienStore';
import { useLanguageStore } from '../stores/useLanguageStore';
import { format } from 'date-fns';
import { th, enUS } from 'date-fns/locale';

export default function SoverienGuidePage() {
  const { t, locale } = useLanguageStore();

  const guideSections = [
    {
      title: 'หลักการขาย 6 ข้อ',
      icon: 'book',
      items: [
        {
          title: '1. ขาย "ความสบายใจ" ไม่ใช่ "อุปกรณ์"',
          content: 'อย่าพูดเรื่อง ESP8266 + DS18B20 → พูดว่า "ตู้แช่พังตอนตี 3 คุณจะรู้ทันที" ลูกค้าซื้อความปลอดภัย ไม่ได้ซื้อชิป'
        },
        {
          title: '2. ROI Calculator — ให้ลูกค้าคำนวณเอง',
          content: 'เสนอสูตรคำนวณ: (มูลค่าสินค้าที่สูญเสียได้หากไม่มีระบบ) ÷ (ราคาระบบ) = วันที่คุ้มทุน ตัวอย่าง: สินค้ามูลค่า 500,000 บาท ระบบ 50,000 บาท = คุ้มทุนใน 1 ครั้งที่ป้องกันได้'
        },
        {
          title: '3. ขายเป็น Package (Standard / Pro / Business)',
          content: 'Standard: เซ็นเซอร์ + สติกเกอร์ + แอปพื้นฐาน\nPro: + รับประกัน 1 ปี + สติกเกอร์ QR + แอปพรีเมียม\nBusiness: + API + Dashboard หลายสาขา + ระบบจัดการทีม'
        },
        {
          title: '4. Live Demo — พกกล่องไปโชว์หน้าร้าน',
          content: 'เตรียมกล่องดิโม: อุปกรณ์ตัวจริง + แบตเตอรี่พาวเวอร์แบงก์ + น้ำแข็ง + น้ำร้อน สาธิตจริงหน้าลูกค้า: แช่น้ำแข็ง → อุณหภูมิลด → แจ้งเตือน Telegram แจ้งทันที'
        },
        {
          title: '5. รับประกัน 2 ชั้น',
          content: 'Hardware 1 ปี: เซ็นเซอร์ ชิป แบตเตอรี่ เสียจากโรงงาน → เปลี่ยนใหม่ฟรี\nService ตลอดชีพ: แอป อัปเดต ฟีเจอร์ใหม่ ซัพพอร์ต LINE ตลอดอายุอุปกรณ์'
        },
        {
          title: '6. Follow-up หลังขาย',
          content: 'วันที่ 7: โทรถาม "ใช้งานเป็นไงบ้าง?"\nวันที่ 30: ส่งไลน์ "เช็คสติกเกอร์ยังติดอยู่ไหม?"\nวันที่ 90: โทรเสนอ "อัปเกรด Pro / เพิ่มอุปกรณ์"'
        }
      ]
    },
    {
      title: 'ROI Calculator สำหรับลูกค้า',
      icon: 'calculator',
      content: `สูตรคำนวณ ROI:
      
1. มูลค่าสินค้าที่เสี่ยง (ต่อตู้/ตู้เย็น) = ราคาขาย × จำนวนชิ้น
2. โอกาสเสียหาย (ประมาณ) = 5-10% ต่อปี
3. ค่าเสียหายคาดการณ์ = มูลค่า × โอกาสเสียหาย
4. ROI = (ค่าเสียหายคาดการณ์ - ราคาระบบ) / ราคาระบบ × 100%

ตัวอย่าง:
- ตู้แช่ 5 ตู้ × 200,000 = 1,000,000 บาท
- โอกาสเสีย 10% = ค่าเสียหายคาดการณ์ 100,000 บาท/ปี
- ระบบ Soverien = 50,000 บาท
- ROI = (100,000 - 50,000) / 50,000 = 100% (คุ้มทุนใน 6 เดือน)`
    },
    {
      title: 'แพ็กเกจสินค้า',
      icon: 'package',
      items: [
        { title: 'Standard', price: '4,900 บาท', features: ['เซ็นเซอร์อุณหภูมิ 1 จุด', 'สติกเกอร์ QR 10 แผ่น', 'แอปพื้นฐาน (Telegram)', 'รับประกัน Hardware 1 ปี'] },
        { title: 'Pro', price: '9,900 บาท', features: ['เซ็นเซอร์อุณหภูมิ 3 จุด', 'เซ็นเซอร์ความชื้น 1 จุด', 'สติกเกอร์ QR 30 แผ่น', 'แอปพรีเมียม (Dashboard)', 'รับประกัน Hardware 1 ปี + Service ตลอดชีพ', 'QR Code สแกนเช็คประกัน'] },
        { title: 'Business', price: '24,900 บาท', features: ['ไม่จำกัดเซ็นเซอร์', 'Dashboard หลายสาขา', 'API สำหรับเชื่อมต่อ ERP', 'ระบบจัดการทีม/ช่าง', 'White-label App', 'Priority Support 24/7'] }
      ]
    },
    {
      title: 'Live Demo Checklist',
      icon: 'clipboard',
      items: [
        'กล่องดิโมครบชิ้น: เซ็นเซอร์ + Gateway + แบตเตอรี่พาวเวอร์แบงก์',
        'น้ำแข็ง + น้ำร้อน (ในขวด تيرมอส) สำหรับสาธิตอุณหภูมิเปลี่ยน',
        'โทรศัพท์ติดตั้งแอป Soverien + LINE สำหรับสาธิตแจ้งเตือน',
        'สติกเกอร์ตัวอย่าง (พร้อม QR Code) แบบ peel-off ได้',
        'แคตตาล็อก PDF + ราคาประกอบ + QR Code ลงทะเบียนทดลองใช้ 14 วัน',
        '名刺 (Business Card) พร้อม QR Code ลงทะเบียนทดลองใช้'
      ]
    },
    {
      title: 'Warranty & Service Policy',
      icon: 'shield',
      content: `รับประกัน Hardware 1 ปี:
- เซ็นเซอร์ ชิป แบตเตอรี่ เสียจากโรงงาน → เปลี่ยนใหม่ฟรี (ค่าส่งฝากเรา)
- ไม่ครอบคลุม: แตกแยก ใช้อุปกรณ์ผิดวิธี น้ำท่วม ไฟไหม้

Service ตลอดชีพ:
- แอปอัปเดตฟีเจอร์ใหม่ตลอดอายุอุปกรณ์
- ซัพพอร์ต LINE ตอบภายใน 2 ชม. (วันทำการ 9-18 น.)
- Firmware OTA อัปเดตผ่านแอป (ไม่ต้องส่งคืน)

Void Warranty (ประกันสิ้นสุดทันที):
- เปิดเคสอุปกรณ์เอง
- ต่อไฟผิดปลาย / โวลต์ไม่ตรง
- นำไปซ่อมที่ไม่ได้รับอนุมัติ`
    }
  ];

  return (
    <div className="atmo-system min-h-screen bg-gray-950 text-gray-100">
      <Sidebar />
      <div className="lg:pl-64">
        <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-8">
          <PageHeader
            title="คู่มือขาย Soverien"
            subtitle="คู่มือขายสำหรับทีมขาย IoT สินค้าเฝ้าสังเกตอุณหภูมิ — 6 หลักการขาย + ROI + Package + Demo + Warranty"
            theme="system"
            icon={<Icon name="book" size={26} />}
          />

          <div className="space-y-8">
            {guideSections.map((section, idx) => (
              <div key={idx} className="card p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-primary/20 rounded-xl">
                    <Icon name={section.icon} size={24} className="text-primary" />
                  </div>
                  <h2 className="text-xl font-bold">{section.title}</h2>
                </div>

                {section.content && (
                  <div className="prose prose-invert max-w-none whitespace-pre-wrap text-slate-300">
                    {section.content}
                  </div>
                )}

                {section.items && (
                  <div className="space-y-4">
                    {section.items.map((item, i) => (
                      <div key={i} className="card p-4 border-l-4 border-primary/50">
                        {item.title && <h3 className="font-semibold text-lg mb-2">{item.title}</h3>}
                        {item.price && <div className="text-lg font-bold text-purple-400 mb-2">{item.price}</div>}
                        {item.content ? (
                          <div className="prose prose-invert max-w-none whitespace-pre-wrap text-slate-300">
                            {item.content}
                          </div>
                        ) : (
                          <ul className="space-y-1">
                            {item.features?.map((f, fi) => (
                              <li key={fi} className="flex items-center gap-2 text-slate-300">
                                <Icon name="check" size={14} className="text-green-400" />
                                {f}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}