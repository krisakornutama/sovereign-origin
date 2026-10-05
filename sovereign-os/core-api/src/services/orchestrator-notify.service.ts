// src/services/orchestrator-notify.service.ts
//
// ชั้นแจ้งเตือน 3 ระดับของ Agent Orchestration
//
//   1. text  → Telegram ข้อความ (มีอยู่แล้วในระบบ เสถียรที่สุด)
//   2. voice → Telegram เสียงพูดไทย (สังเคราะห์ผ่าน Piper ตัวเดิมของระบบ)
//   3. call  → โทรจริง (Bland/Twilio — ปิดไว้เป็นค่าเริ่มต้น)
//
// เหตุผลที่ทำเป็น service แยก: งานที่รันบนเครื่องคอมจบที่ไหนก็ตาม
// ต้องแจ้งคนโดยไม่รู้ว่าจะส่งผ่านอะไร และชั้นนี้ต้องพังเงียบ ๆ ได้
// (ถ้าส่งไม่สำเร็จห้ามทำให้ job ที่เพิ่งเสร็จกลายเป็น error)
import { sendTelegramMessage } from '../modules/telegram/telegram.routes';
import { sendTelegramVoice } from '../modules/telegram/telegram.routes';
import { placeCall, type CallResult } from './caller.service';

export const ORCHESTRATOR_ALERT_TIERS = ['text', 'voice', 'call'] as const;
export type AlertTier = (typeof ORCHESTRATOR_ALERT_TIERS)[number];

/** ค่าเริ่มต้น = ข้อความอย่างเดียว — เสียงและโทรต้องให้ผู้ใช้เปิดเอง */
export const DEFAULT_ALERT_TIERS: AlertTier[] = ['text'];

export interface NotifyDeps {
  sendText?: (text: string, buttons?: { text: string; data: string }[]) => Promise<boolean>;
  sendVoice?: (text: string) => Promise<boolean>;
  call?: (req: { to: string; message: string }) => Promise<CallResult>;
}

/** แยกเป็นรายชั้นเพื่อทดสอบ — และเพื่อไม่ต้องส่งจริง */
export function resolveAlertTiers(raw: unknown): AlertTier[] {
  const v = String(raw ?? '').trim();
  if (!v) return [...DEFAULT_ALERT_TIERS];
  const out = v
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is AlertTier => (ORCHESTRATOR_ALERT_TIERS as readonly string[]).includes(s));
  return out;
}

export interface JobAlert {
  status: string;
  jobId: string;
  machineName?: string | null;
  executor?: string | null;
  model?: string | null;
  result?: string | null;
  error?: string | null;
  exitCode?: number | null;
}

function esc(text: unknown): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** ตัดข้อความยาวเกินไป — Telegram ตัดที่ 4096 ตัวอักษร */
function clip(text: string, max = 1500): string {
  const t = String(text ?? '').trim();
  if (!t) return '';
  return t.length > max ? `${t.slice(0, max)}… (ตัดท้อง)` : t;
}

/** ข้อความแจ้งเตือนที่คนอ่านต้องรู้ทันที: เสร็จ/ล้มเหลว + ผล + เครื่อง + ตัวแปรที่สั่ง */
export function buildJobAlertText(a: JobAlert): string {
  const ok = a.status === 'done';
  const head = ok ? '✅ <b>งานเสร็จแล้ว</b>' : `⚠️ <b>งาน${a.status === 'error' ? 'ล้มเหลว' : `สถานะ ${esc(a.status)}`}</b>`;
  const lines = [
    head,
    `เครื่อง: ${esc(a.machineName || 'HUB')}`,
    `agent: ${esc(a.executor || '-')}${a.model ? ` · โมเดล: ${esc(a.model)}` : ''}`,
    `รหัสงาน: <code>${esc(a.jobId)}</code>`,
  ];
  if (a.error) lines.push(`error: <code>${esc(clip(a.error))}</code>`);
  else if (a.result) lines.push(`ผลลัพธ์: ${esc(clip(a.result))}`);
  if (a.exitCode != null && a.exitCode !== 0) lines.push(`exit ${a.exitCode}`);
  return lines.join('\n');
}

/** ปุ่มอนุมัติงานเสี่ยง — prefix ของตัวเองเพื่อไม่ชนกับ approve:/reject: ของ agent action */
export function buildApprovalButtons(jobId: string): { text: string; data: string }[] {
  return [
    { text: '✅ อนุมัติให้รัน', data: `jobok:${jobId}` },
    { text: '🚫 ยกเลิกงาน', data: `jobreject:${jobId}` },
  ];
}

export interface NotifyOptions {
  tiers?: AlertTier[];
  /** เบอร์ที่จะโทร (ผู้ใช้ตั้งเองต่องาน — ไม่ hardcode) */
  callTo?: string | null;
}

export interface NotifyResult {
  delivered: boolean;
  tiers: { tier: AlertTier; ok: boolean; reason?: string }[];
  error?: string;
}

async function runTier(
  tier: AlertTier,
  text: string,
  deps: NotifyDeps,
  callTo?: string | null
): Promise<{ ok: boolean; reason?: string }> {
  try {
    if (tier === 'text') {
      const send = deps.sendText ?? ((t: string) => sendTelegramMessage(t));
      const ok = await send(text);
      return { ok: !!ok, reason: ok ? undefined : 'telegram ส่งไม่สำเร็จ' };
    }
    if (tier === 'voice') {
      const send = deps.sendVoice ?? ((t: string) => sendTelegramVoice(t));
      const ok = await send(text);
      return { ok: !!ok, reason: ok ? undefined : 'ส่งเสียงไม่สำเร็จ' };
    }
    if (!callTo) return { ok: false, reason: 'ยังไม่ได้ระบุเบอร์โทร' };
    const call = deps.call ?? ((r: { to: string; message: string }) => placeCall(r));
    const res = await call({ to: String(callTo), message: plainText(text) });
    return { ok: !!res?.ok, reason: res?.ok ? undefined : res?.reason || 'โทรไม่สำเร็จ' };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[orchestrator-notify] tier ${tier} failed:`, reason);
    return { ok: false, reason };
  }
}

/** ตัด HTML ออกก่อนพูด/ก่อนโทร — เสียงและเสียงโทรไม่ต้องอ่าน markup */
function plainText(html: string): string {
  return String(html ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function defaultTiers(opts?: NotifyOptions): AlertTier[] {
  return opts?.tiers ?? resolveAlertTiers(process.env.ORCHESTRATOR_ALERT_TIERS);
}

/**
 * แจ้งเตือนว่างานบนเครื่องคอมจบแล้ว
 * คืน delivered=false เมื่อทุกชั้นล้มเหลว แต่ **ไม่ throw**
 */
export async function notifyJobFinished(a: JobAlert, deps: NotifyDeps = {}, opts: NotifyOptions = {}): Promise<NotifyResult> {
  const text = buildJobAlertText(a);
  const tiers = defaultTiers(opts);
  const results: { tier: AlertTier; ok: boolean; reason?: string }[] = [];
  for (const tier of tiers) {
    const r = await runTier(tier, text, deps, opts.callTo);
    results.push({ tier, ok: r.ok, ...(r.reason ? { reason: r.reason } : {}) });
  }
  const delivered = results.some((r) => r.ok);
  const out: NotifyResult = { delivered, tiers: results };
  if (!delivered) out.error = results.find((r) => r.reason)?.reason || 'ส่งแจ้งเตือนไม่สำเร็จทุกชั้น';
  return out;
}

/** ข้อความขออนุมัติงานเสี่ยง (pure — ใช้ร่วมกันได้ทั้งจาก service และจากคำสั่ง Telegram) */
export function buildApprovalText(a: {
  jobId: string;
  machineName?: string | null;
  executor?: string | null;
  prompt?: string | null;
}): string {
  return [
    '⏸ <b>งานเสี่ยง — รอกดอนุมัติใน Telegram</b>',
    `เครื่อง: ${esc(a.machineName || 'HUB')}`,
    `agent: ${esc(a.executor || '-')}`,
    `รหัสงาน: <code>${esc(a.jobId)}</code>`,
    a.prompt ? `งาน: ${esc(clip(a.prompt, 400))}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * แจ้งว่างานเสี่ยงรอกด — ผูกกับปุ่มที่จะตัดสินใจใน Telegram
 * (ผู้เรียกจากระบบคำสั่งควรใช้ buildApprovalText + buildApprovalButtons ผ่านช่องทางของตัวเอง
 *  เพื่อให้ chat-id allowlist ของบอทคุมได้จุดเดียว)
 */
export async function notifyJobNeedsApproval(
  a: { jobId: string; machineName?: string | null; executor?: string | null; prompt?: string | null },
  deps: NotifyDeps = {},
  opts: NotifyOptions = {}
): Promise<NotifyResult> {
  const text = buildApprovalText(a);
  const text2 = deps.sendText ?? ((t: string, b?: any) => sendTelegramMessage(t, b));
  try {
    const ok = await text2(text, buildApprovalButtons(a.jobId));
    return { delivered: !!ok, tiers: [{ tier: 'text', ok: !!ok }] };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error('[orchestrator-notify] approval notify failed:', reason);
    return { delivered: false, tiers: [{ tier: 'text', ok: false, reason }], error: reason };
  }
}