"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Sidebar from '../components/layout/Sidebar';
import PageHeader from '../components/ui/PageHeader';
import Icon from '../components/ui/Icon';
import { useLanguageStore } from '../stores/useLanguageStore';
import { markFirstRunSeen, readDoneSteps, writeDoneSteps } from '../lib/firstRun';

/**
 * /start — หน้าเริ่มใช้งานสำหรับ "คนในบ้าน" ที่ล็อกอินครั้งแรก
 *
 * ทำไมต้องมี: dashboard มีเมนูเต็มไปหมด ผู้ใช้ใหม่ไม่รู้ว่าเริ่มตรงไหน
 * หน้านี้ให้เช็กลิสต์สั้น ๆ ที่ (1) ลิงก์ไปหน้าที่มีจริง (2) จำว่าทำอะไรแล้ว
 * (3) ข้ามได้ตลอด — ไม่ขังผู้ใช้ และ (4) ล็อกอินครั้งแรกพามาที่นี่ครั้งเดียว
 * (ดู nextPathAfterLogin() ใน lib/firstRun.ts)
 */

/** จำนวนขั้นทั้งหมด — ใช้แสดงความคืบหน้า ไม่ต้องนับซ้ำ */
const TOTAL_STEPS = 6;

function StepRow({
  id,
  href,
  icon,
  title,
  description,
  checked,
  onToggle,
  doneLabel,
  openLabel,
}: {
  id: string;
  href: string;
  icon: string;
  title: string;
  description: string;
  checked: boolean;
  onToggle: (id: string) => void;
  doneLabel: string;
  openLabel: string;
}) {
  return (
    <li className="flex items-start gap-3 rounded-xl border border-gray-800 bg-gray-900/60 p-4">
      <input
        id={`step-${id}`}
        type="checkbox"
        checked={checked}
        onChange={() => onToggle(id)}
        className="mt-1 h-4 w-4 shrink-0 accent-emerald-500"
      />
      <div className="min-w-0 flex-1">
        <label htmlFor={`step-${id}`} className="flex items-center gap-2 text-sm font-semibold text-gray-100 cursor-pointer">
          <span className="text-emerald-400">
            <Icon name={icon} size={16} />
          </span>
          {title}
        </label>
        <p className="mt-1 text-xs leading-relaxed text-gray-400">{description}</p>
        <Link
          href={href}
          onClick={() => markFirstRunSeen()}
          className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-sky-400 hover:underline"
        >
          {openLabel}
          <Icon name="external" size={12} />
        </Link>
      </div>
      <span className="shrink-0 text-[11px] text-gray-500">{checked ? doneLabel : ''}</span>
    </li>
  );
}

export default function StartPage() {
  const t = useLanguageStore((s) => s.t);
  const router = useRouter();
  const [done, setDone] = useState<string[]>([]);

  // อ่านเฉพาะฝั่ง client — server กับ client render ค่าเริ่มต้น ([]) ตรงกัน จึงไม่ hydration mismatch
  useEffect(() => {
    setDone(readDoneSteps());
  }, []);

  const toggle = (id: string) => {
    setDone((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      writeDoneSteps(next);
      return next;
    });
  };

  // ทำครบทุกขั้น = ถือว่าเห็นหน้าเริ่มใช้งานแล้ว (ครั้งต่อไปเข้า dashboard)
  useEffect(() => {
    if (done.length === TOTAL_STEPS) markFirstRunSeen();
  }, [done.length]);

  const skip = () => {
    markFirstRunSeen();
    router.push('/dashboard');
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 p-4 lg:p-6 space-y-5 max-w-3xl mx-auto w-full">
          <PageHeader
            eyebrow={t('start.eyebrow', 'เริ่มต้นใช้งาน')}
            title={t('start.title', 'เริ่มใช้ระบบใน 6 ขั้น')}
            subtitle={t('start.subtitle', 'ทำทีละขั้นก็ได้ ไม่ต้องครบในวันเดียว — ระบบจำว่าทำอะไรแล้วไว้ให้')}
            icon={<Icon name="star" size={18} />}
            actions={
              <button type="button" onClick={skip} className="btn-ghost text-sm">
                {t('start.skip', 'ข้ามไปก่อน')}
              </button>
            }
          />

          <section className="card p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-gray-200 glow-text">{t('start.stepsTitle', 'ขั้นตอน')}</h2>
              <div className="text-sm text-gray-400">
                {t('start.progressLabel', 'ทำแล้ว')}{' '}
                <span className="font-bold text-emerald-300">{done.length}</span> / {TOTAL_STEPS}
              </div>
            </div>
            <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{ width: `${Math.round((done.length / TOTAL_STEPS) * 100)}%` }}
              />
            </div>

            <ul className="space-y-3 pt-1">
              <StepRow
                id="password"
                href="/change-password"
                icon="lock"
                title={t('start.steps.password.title', 'ตั้งรหัสผ่านของตัวเอง')}
                description={t('start.steps.password.desc', 'ถ้ายังใช้รหัสที่ผู้ดูแลตั้งให้ เปลี่ยนเป็นรหัสของคุณเองก่อน')}
                checked={done.includes('password')}
                onToggle={toggle}
                doneLabel={t('start.markDone', 'ทำแล้ว')}
                openLabel={t('start.open', 'เปิดหน้า')}
              />
              <StepRow
                id="sensors"
                href="/sensors"
                icon="sensors"
                title={t('start.steps.sensors.title', 'ตรวจว่าเซนเซอร์ต่อติด')}
                description={t('start.steps.sensors.desc', 'ดูว่าเซนเซอร์ในบ้านออนไลน์และส่งค่าล่าสุดเมื่อไร')}
                checked={done.includes('sensors')}
                onToggle={toggle}
                doneLabel={t('start.markDone', 'ทำแล้ว')}
                openLabel={t('start.open', 'เปิดหน้า')}
              />
              <StepRow
                id="energy"
                href="/energy"
                icon="energy"
                title={t('start.steps.energy.title', 'ดูพลังงานและแบตเตอรี่')}
                description={t('start.steps.energy.desc', 'รู้ว่าเหลือไฟเท่าไร ใช้ได้อีกกี่ชั่วโมง')}
                checked={done.includes('energy')}
                onToggle={toggle}
                doneLabel={t('start.markDone', 'ทำแล้ว')}
                openLabel={t('start.open', 'เปิดหน้า')}
              />
              <StepRow
                id="inventory"
                href="/inventory"
                icon="inventory"
                title={t('start.steps.inventory.title', 'บันทึกของใช้ในบ้าน')}
                description={t('start.steps.inventory.desc', 'ของกิน น้ำ เชื้อเพลิง ยา — ของที่หมดแล้วต้องรู้ก่อนจะหมด')}
                checked={done.includes('inventory')}
                onToggle={toggle}
                doneLabel={t('start.markDone', 'ทำแล้ว')}
                openLabel={t('start.open', 'เปิดหน้า')}
              />
              <StepRow
                id="alerts"
                href="/alerts"
                icon="alerts"
                title={t('start.steps.alerts.title', 'ตั้งการแจ้งเตือน')}
                description={t('start.steps.alerts.desc', 'เลือกว่าจะให้ระบบเตือนเรื่องอะไร และเตือนทางไหน')}
                checked={done.includes('alerts')}
                onToggle={toggle}
                doneLabel={t('start.markDone', 'ทำแล้ว')}
                openLabel={t('start.open', 'เปิดหน้า')}
              />
              <StepRow
                id="health"
                href="/system-health"
                icon="system"
                title={t('start.steps.health.title', 'ตรวจสุขภาพระบบครั้งแรก')}
                description={t('start.steps.health.desc', 'ดูว่าโค้ดที่รันตรงกับที่ติดตั้ง ฐานข้อมูลพร้อม และไม่มีอะไรค้าง')}
                checked={done.includes('health')}
                onToggle={toggle}
                doneLabel={t('start.markDone', 'ทำแล้ว')}
                openLabel={t('start.open', 'เปิดหน้า')}
              />
            </ul>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <p className="text-[11px] text-gray-500">{t('start.footer', 'กลับมาหน้านี้ได้ทุกเมื่อที่ /start')}</p>
              <Link href="/dashboard" onClick={() => markFirstRunSeen()} className="btn-primary text-sm">
                {t('start.goDashboard', 'ไปที่ Dashboard')}
              </Link>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
