// src/services/telegram-agent-bot.service.ts
//
// Pushes AI agent approval requests to Telegram with ✅/🚫 inline buttons,
// and processes the replies (buttons or /approve <id> /reject <id> commands).
//
// Security: only the chat id configured in TELEGRAM_CHAT_ID is allowed to
// decide — every other chat is ignored (and its callback answered with a
// denial). Decisions are attributed to the first SUPERADMIN user so the
// audit trail stays a valid FK.
//
// Transport: long polling (getUpdates) — the hub is a private appliance with
// no public URL, so a webhook is not required.
import axios from 'axios';
import { prisma } from '../lib/prisma';
import { agentActions } from './agent-actions.service';
import { sendTelegramMessage } from '../modules/telegram/telegram.routes';


export interface ApprovalRequestInfo {
  tool: string;
  args: any;
  approval_id: string;
  source?: string;
}

// ---------- pure helpers (exported for tests) ----------

export function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function parseCommand(
  text: string
): { action: 'approve' | 'reject'; id: string } | null {
  const m = text.trim().match(/^\/(approve|reject)\s+([A-Za-z0-9-]+)/i);
  if (!m) return null;
  return { action: m[1].toLowerCase() as 'approve' | 'reject', id: m[2] };
}

export function extractCallbackData(
  data: string
): { action: 'approve' | 'reject'; id: string } | null {
  const m = data.match(/^(approve|reject):([A-Za-z0-9-]+)$/);
  if (!m) return null;
  return { action: m[1] as 'approve' | 'reject', id: m[2] };
}

export function isAllowedChatId(
  fromId: any,
  allowedChatId: string | number | undefined
): boolean {
  if (allowedChatId === undefined || allowedChatId === '') return false;
  return String(fromId) === String(allowedChatId);
}

type ActionResultLike = { status: string; result?: string; reason?: string };

export interface TelegramAgentBotDeps {
  send?: (text: string, buttons?: { text: string; data: string }[]) => Promise<boolean>;
  actions?: {
    approveApproval: (id: string, actor?: string) => Promise<ActionResultLike>;
    rejectApproval: (id: string, actor?: string) => ActionResultLike | null;
  };
  resolveActor?: () => Promise<string | undefined>;
  allowedChatId?: string | number;
  token?: string;
}

export class TelegramAgentBot {
  private send: NonNullable<TelegramAgentBotDeps['send']>;
  private actions: NonNullable<TelegramAgentBotDeps['actions']>;
  private resolveActor: NonNullable<TelegramAgentBotDeps['resolveActor']>;
  private allowedChatId?: string | number;
  private token: string;

  private offset = 0;
  private polling = false;
  private stopped = false;

  constructor(deps: TelegramAgentBotDeps = {}) {
    this.send =
      deps.send ||
      ((text, buttons) => sendTelegramMessage(text, buttons));
    this.actions = deps.actions || {
      approveApproval: (id, actor) => agentActions.approveApproval(id, actor),
      rejectApproval: (id, actor) => agentActions.rejectApproval(id, actor),
    };
    this.resolveActor = deps.resolveActor || this.lookupSuperadmin;
    this.allowedChatId = deps.allowedChatId ?? process.env.TELEGRAM_CHAT_ID;
    this.token = deps.token ?? (process.env.TELEGRAM_BOT_TOKEN || '');
  }

  get enabled(): boolean {
    return Boolean(this.token && this.allowedChatId);
  }

  // ---------- notification ----------

  formatApprovalMessage(info: ApprovalRequestInfo): string {
    return [
      '🤖 <b>AI Agent ขออนุมัติ Action</b>',
      `Tool: <code>${escapeHtml(info.tool)}</code>`,
      `Args: <code>${escapeHtml(JSON.stringify(info.args))}</code>`,
      `รหัสคำขอ: <code>${escapeHtml(info.approval_id)}</code>`,
      info.source ? `ที่มา: ${escapeHtml(info.source)}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  async notifyApprovalRequest(info: ApprovalRequestInfo): Promise<boolean> {
    if (!this.enabled) return false;
    return this.send(this.formatApprovalMessage(info), [
      { text: '✅ อนุมัติ', data: `approve:${info.approval_id}` },
      { text: '🚫 ปฏิเสธ', data: `reject:${info.approval_id}` },
    ]);
  }

  // ---------- update handling ----------

  async handleUpdate(update: any): Promise<void> {
    if (update?.message) {
      await this.handleMessage(update.message);
    } else if (update?.callback_query) {
      await this.handleCallback(update.callback_query);
    }
  }

  private async handleMessage(msg: any): Promise<void> {
    if (!isAllowedChatId(msg?.from?.id, this.allowedChatId)) return;
    const cmd = parseCommand(typeof msg.text === 'string' ? msg.text : '');
    if (!cmd) return;
    const actor = await this.resolveActor();
    let result: ActionResultLike | null;
    if (cmd.action === 'approve') {
      result = await this.actions.approveApproval(cmd.id, actor);
    } else {
      result = this.actions.rejectApproval(cmd.id, actor);
    }
    await this.sendDecisionResult(cmd.id, result, cmd.action);
  }

  private async handleCallback(cb: any): Promise<void> {
    const chatId = cb?.from?.id;
    if (!isAllowedChatId(chatId, this.allowedChatId)) {
      await this.answerCallback(cb?.id, '⛔ ไม่ได้รับอนุญาต');
      return;
    }
    const parsed = extractCallbackData(String(cb?.data || ''));
    if (!parsed) {
      await this.answerCallback(cb?.id, 'คำสั่งไม่รู้จัก');
      return;
    }
    const actor = await this.resolveActor();
    let result: ActionResultLike | null;
    if (parsed.action === 'approve') {
      result = await this.actions.approveApproval(parsed.id, actor);
    } else {
      result = this.actions.rejectApproval(parsed.id, actor);
    }
    const ok = !!result && result.status === 'ok';
    await this.answerCallback(cb?.id, ok ? '✅ อนุมัติแล้ว' : '🚫 ปฏิเสธแล้ว');
    await this.sendDecisionResult(parsed.id, result, parsed.action);
  }

  private async sendDecisionResult(
    id: string,
    result: ActionResultLike | null,
    action: 'approve' | 'reject'
  ): Promise<void> {
    const ok = !!result && result.status === 'ok';
    const lines = [
      `🤖 <b>ผลการตัดสินใจ (${action === 'approve' ? 'อนุมัติ' : 'ปฏิเสธ'})</b>`,
      `รหัสคำขอ: <code>${escapeHtml(id)}</code>`,
    ];
    if (ok && result!.result) {
      lines.push(`ผลลัพธ์: ${escapeHtml(result!.result)}`);
    } else if (result?.reason) {
      lines.push(`หมายเหตุ: ${escapeHtml(result.reason)}`);
    } else {
      lines.push('ไม่พบคำขอหรือถูกตัดสินใจไปแล้ว');
    }
    await this.send(lines.join('\n'));
  }

  private async answerCallback(callbackQueryId: string, text: string): Promise<void> {
    if (!this.token || !callbackQueryId) return;
    try {
      await axios.post(`https://api.telegram.org/bot${this.token}/answerCallbackQuery`, {
        callback_query_id: callbackQueryId,
        text,
        show_alert: false,
      });
    } catch (err) {
      console.error('Telegram answerCallbackQuery failed:', err);
    }
  }

  // Attribution for the audit trail: decisions made via Telegram are recorded
  // against the first SUPERADMIN (the person who owns the channel).
  private async lookupSuperadmin(): Promise<string | undefined> {
    try {
      const admin = await prisma.user.findFirst({
        where: { role: 'SUPERADMIN' },
        orderBy: { id: 'asc' },
      });
      return admin?.id;
    } catch (err) {
      console.error('Telegram actor lookup failed:', err);
      return undefined;
    }
  }

  // ---------- long polling ----------

  startPolling(): void {
    if (this.polling || !this.enabled) return;
    this.polling = true;
    this.stopped = false;
    void this.pollLoop();
  }

  stopPolling(): void {
    this.stopped = true;
    this.polling = false;
  }

  private async pollLoop(): Promise<void> {
    try {
      const updates = await this.getUpdates();
      for (const update of updates) {
        this.offset = update.update_id + 1;
        await this.handleUpdate(update).catch((err) =>
          console.error('Telegram update error:', err)
        );
      }
    } catch (err) {
      console.error('Telegram polling error:', err);
    } finally {
      if (!this.stopped) setTimeout(() => void this.pollLoop(), 1000);
    }
  }

  private async getUpdates(): Promise<any[]> {
    if (!this.token) return [];
    const res = await axios.get(`https://api.telegram.org/bot${this.token}/getUpdates`, {
      params: { offset: this.offset, timeout: 30, allowed_updates: ['message', 'callback_query'] },
      timeout: 45000,
    });
    return res.data?.ok ? res.data.result || [] : [];
  }
}

export const telegramAgentBot = new TelegramAgentBot();
