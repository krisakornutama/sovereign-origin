// src/lib/visitorTrack.ts
// P10: เก็บพฤติกรรมผู้เยี่ยมชมหน้าสาธารณะ → POST /api/track
//  - cookieless ไม่มี PII (เก็บแค่ kind/page/detail/value — IP hash ที่ server)
//  - sendBeacon เมื่อยิงตอนออกจากหน้า · fetch keepalive สำหรับเหตุการณ์ระหว่างใช้งาน
//  - เงียบทุกกรณี — tracking ล้มต้องไม่กระทบการใช้งาน
import { getApiUrl } from './config';

type Kind = 'page_view' | 'demo_tab' | 'time_on_page' | 'survey' | 'question' | 'feedback_open' | 'outbound';

function send(kind: Kind, page: string, detail?: string, value?: string, useBeacon = false): void {
  if (typeof window === 'undefined') return;
  const url = `${getApiUrl()}/api/track`;
  // honeypot field `website` เป็นค่าว่างเสมอสำหรับผู้ใช้จริง (มีไว้หลอก bot ในฟอร์ม)
  const payload = JSON.stringify({ kind, page, detail, value, website: '' });
  try {
    if (useBeacon && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
      return;
    }
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(() => {});
  } catch {
    // เงียบ — สถิติไม่มีสิทธิ์ทำหน้าเว็บพัง
  }
}

/** เรียกครั้งเดียวเมื่อเข้าหน้า (แนบ time_on_page อัตโนมัติตอนออก) */
export function trackPageView(page: string): void {
  if (typeof window === 'undefined') return;
  const t0 = Date.now();
  send('page_view', page);
  const onLeave = () => {
    const sec = Math.min(3600, Math.round((Date.now() - t0) / 1000));
    if (sec >= 5) send('time_on_page', page, undefined, String(sec), true); // อย่างน้อย 5 วินาที = ใช้จริง
  };
  window.addEventListener('pagehide', onLeave, { once: true });
}

export function trackDemoTab(page: string, detail: string): void {
  send('demo_tab', page, detail);
}

export function trackSurvey(page: string, value: string): void {
  send('survey', page, undefined, value);
}

export function trackQuestion(page: string, detail: string, value: string): void {
  send('question', page, detail, value);
}

export function trackFeedbackOpen(page: string): void {
  send('feedback_open', page);
}

export function trackOutbound(page: string, detail: string): void {
  send('outbound', page, detail);
}
