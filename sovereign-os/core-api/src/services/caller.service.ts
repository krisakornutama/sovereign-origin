// src/services/caller.service.ts
//
// ระบบโทร — provider-agnostic
//
// เหตุผลที่แยกเป็น service แทนที่จะยัดเข้าไปในชั้นแจ้งเตือน:
// ผู้ใช้สั่ง "ระบบโทร" ได้ แต่ provider เป็นเรื่องของผู้ใช้ที่จะเปลี่ยนทีหลัง
// ⇒ โค้ดส่วนอื่นขอแค่ `placeCall(...)` ไม่ต้องรู้ว่าจะโทรผ่านเจ้าไหน
//
// หลักการที่ยึด:
// - default = `none` ⇒ ยิงอะไรไม่ออกนอกเครื่อง ปลอดภัยที่สุด ไม่มี key ก็ยังทำงานได้
// - ไม่ throw เด็ดขาด — การโทรล้มต้องไม่ทำให้งาน/worker พัง (คืน ok:false + reason)
// - เบอร์ต้องเป็น E.164 เท่านั้น ก่อนยิง request ออกข้างนอก
import axios from 'axios';

export type CallProvider = 'none' | 'bland' | 'twilio';

export interface CallRequest {
  to: string;
  message: string;
  /** บังคับ provider เฉพาะครั้งนี้ (ไม่ระบุ = ใช้ค่าใน env) */
  provider?: CallProvider | string;
}

export interface CallResult {
  ok: boolean;
  provider: CallProvider;
  callId?: string;
  /** true = ไม่ได้ยิงเพราะ provider ปิดอยู่/ไม่มี key เป็นการตั้งใจ ไม่ใช่ error */
  skipped?: boolean;
  reason?: string;
}

export interface CallerDeps {
  provider?: CallProvider;
  apiKey?: string;
  accountSid?: string;
  authToken?: string;
  from?: string;
  voiceId?: string;
  /** injectable สำหรับเทสต์ — ค่าเริ่มต้นคือ axios.post ของจริง */
  post?: (url: string, body: any, headers: Record<string, string>) => Promise<any>;
}

const E164 = /^\+[1-9]\d{7,14}$/;

/** เบอร์โทรต้องเป็น E.164 (+66...) — กันยิงผิดปลายทาง */
export function isDialableNumber(to: unknown): boolean {
  return E164.test(String(to ?? '').trim());
}

/** ค่าที่ไม่รู้จัก → none (ไม่เดา provider ให้ผู้ใช้ อาจยิงผิกบัญชี) */
export function resolveCallProvider(raw: unknown, env: Record<string, string | undefined> = process.env): CallProvider {
  const v = String(raw ?? env.CALL_PROVIDER ?? 'none').trim().toLowerCase();
  return v === 'bland' || v === 'twilio' ? v : 'none';
}

function defaultPost(url: string, body: any, headers: Record<string, string>) {
  return axios.post(url, body, { headers, timeout: 20000 });
}

export async function placeCall(req: CallRequest, deps: CallerDeps = {}): Promise<CallResult> {
  const provider = resolveCallProvider(
    req?.provider ?? deps.provider,
    { CALL_PROVIDER: deps.provider ?? process.env.CALL_PROVIDER }
  );
  const apiKey = deps.apiKey ?? process.env.BLAND_API_KEY ?? '';
  const accountSid = deps.accountSid ?? process.env.TWILIO_ACCOUNT_SID ?? '';
  const authToken = deps.authToken ?? process.env.TWILIO_AUTH_TOKEN ?? '';
  const from = deps.from ?? process.env.CALLER_FROM_NUMBER ?? '';
  const voiceId = deps.voiceId ?? process.env.BLAND_VOICE_ID ?? undefined;
  const post = deps.post ?? defaultPost;

  if (provider === 'none') {
    return { ok: false, provider: 'none', skipped: true, reason: 'CALL_PROVIDER=none — ไม่โทรออก' };
  }
  if (!isDialableNumber(req?.to)) {
    return { ok: false, provider, reason: 'เบอร์ต้องอยู่ในรูปแบบ E.164 เช่น +66812345678' };
  }
  const message = String(req?.message ?? '').trim();
  if (!message) return { ok: false, provider, reason: 'ข้อความที่จะพูดว่างเปล่า' };

  if (provider === 'bland' && !apiKey) {
    return { ok: false, provider, skipped: true, reason: 'ยังไม่ได้ตั้ง BLAND_API_KEY' };
  }
  if (provider === 'twilio' && (!accountSid || !authToken || !from)) {
    return {
      ok: false,
      provider,
      skipped: true,
      reason: 'ยังไม่ได้ตั้ง TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / CALLER_FROM_NUMBER',
    };
  }

  try {
    if (provider === 'bland') {
      const res = await post(
        'https://api.bland.ai/v1/calls',
        { phone_number: req.to, voice_id: voiceId, task: message, language: 'th' },
        { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
      );
      return { ok: true, provider, callId: res?.data?.id };
    }
    const form = new URLSearchParams({
      To: String(req.to),
      From: String(from),
      Twiml: `<Response><Say language="th-TH">${escapeXml(message)}</Say></Response>`,
    });
    const basic = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const res = await post(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`,
      form.toString(),
      { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' }
    );
    return { ok: true, provider, callId: res?.data?.sid };
  } catch (err) {
    // จุดสำคัญ: โทรไม่สำเร็จต้องไม่ลากทั้งระบบลง
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[caller] ${provider} call failed:`, reason);
    return { ok: false, provider, reason };
  }
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** ตั้งค่าปัจจุบัน (สำหรับหน้าเว็บแสดงสถานะ — ไม่คืน key) */
export function callerStatus() {
  const provider = resolveCallProvider(undefined);
  return {
    provider,
    enabled: provider !== 'none',
    blandReady: Boolean(process.env.BLAND_API_KEY),
    twilioReady: Boolean(
      process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.CALLER_FROM_NUMBER
    ),
    voiceId: process.env.BLAND_VOICE_ID ?? null,
    fromNumber: process.env.CALLER_FROM_NUMBER ?? null,
  };
}