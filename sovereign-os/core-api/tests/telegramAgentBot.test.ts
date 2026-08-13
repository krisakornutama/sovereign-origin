import './setup-env';
import { test } from 'node:test';
import assert from 'node:assert';
import {
  TelegramAgentBot,
  parseCommand,
  extractCallbackData,
  escapeHtml,
  isAllowedChatId,
} from '../src/services/telegram-agent-bot.service';

test('parseCommand understands /approve and /reject with an id', () => {
  assert.deepStrictEqual(parseCommand('/approve abc-123'), { action: 'approve', id: 'abc-123' });
  assert.deepStrictEqual(parseCommand('/reject xyz'), { action: 'reject', id: 'xyz' });
  assert.deepStrictEqual(parseCommand('  /APPROVE  9f0c1a2b '), { action: 'approve', id: '9f0c1a2b' });
});

test('parseCommand rejects non-commands and commands without an id', () => {
  assert.strictEqual(parseCommand('hello world'), null);
  assert.strictEqual(parseCommand('/approve'), null);
  assert.strictEqual(parseCommand(''), null);
});

test('extractCallbackData understands approve:<id> / reject:<id>', () => {
  assert.deepStrictEqual(extractCallbackData('approve:abc'), { action: 'approve', id: 'abc' });
  assert.deepStrictEqual(extractCallbackData('reject:xyz'), { action: 'reject', id: 'xyz' });
  assert.strictEqual(extractCallbackData('garbage'), null);
  assert.strictEqual(extractCallbackData('approve:'), null);
});

test('escapeHtml protects the HTML parse mode from user-controlled args', () => {
  assert.strictEqual(escapeHtml('<b>&"x"</b>'), '&lt;b&gt;&amp;&quot;x&quot;&lt;/b&gt;');
});

test('isAllowedChatId only allows the configured chat (string/number agnostic)', () => {
  assert.strictEqual(isAllowedChatId(123, '123'), true);
  assert.strictEqual(isAllowedChatId('123', 123), true);
  assert.strictEqual(isAllowedChatId(456, '123'), false);
  assert.strictEqual(isAllowedChatId(456, undefined), false);
});

test('notifyApprovalRequest sends a formatted message with approve/reject buttons', async () => {
  const sent: any[] = [];
  const bot = new TelegramAgentBot({
    send: async (text, buttons) => {
      sent.push({ text, buttons });
      return true;
    },
    token: 'test-token',
    allowedChatId: 123,
  });

  const ok = await bot.notifyApprovalRequest({ tool: 'blockIP', args: { ip: '1.2.3.4' }, approval_id: 'abc-123', source: 'chat' });
  assert.strictEqual(ok, true);
  assert.strictEqual(sent.length, 1);
  assert.match(sent[0].text, /blockIP/);
  assert.match(sent[0].text, /abc-123/);
  assert.deepStrictEqual(sent[0].buttons, [
    { text: '✅ อนุมัติ', data: 'approve:abc-123' },
    { text: '🚫 ปฏิเสธ', data: 'reject:abc-123' },
  ]);
});

test('notifyApprovalRequest is a no-op when the bot is not configured', async () => {
  const bot = new TelegramAgentBot({ token: '', allowedChatId: '' });
  const ok = await bot.notifyApprovalRequest({ tool: 'blockIP', args: {}, approval_id: 'x' });
  assert.strictEqual(ok, false);
});

test('callback button click approves the queued action and reports the result', async () => {
  const calls: any[] = [];
  const sent: any[] = [];
  const bot = new TelegramAgentBot({
    send: async (text) => {
      sent.push(text);
      return true;
    },
    actions: {
      approveApproval: async (id, actor) => {
        calls.push({ id, actor });
        return { status: 'ok', result: 'blocked 1.2.3.4' };
      },
      rejectApproval: (id) => ({ status: 'denied', reason: 'rejected' }),
    },
    resolveActor: async () => 'admin-uuid',
    allowedChatId: 123,
  });

  await bot.handleUpdate({
    callback_query: { id: 'cb-1', from: { id: 123 }, data: 'approve:abc-123' },
  });

  assert.deepStrictEqual(calls, [{ id: 'abc-123', actor: 'admin-uuid' }]);
  assert.ok(sent.some((t) => /blocked 1\.2\.3\.4/.test(t)));
});

test('commands from an unapproved chat are ignored', async () => {
  const calls: any[] = [];
  const bot = new TelegramAgentBot({
    send: async () => true,
    actions: {
      approveApproval: async (id) => {
        calls.push(id);
        return { status: 'ok', result: 'x' };
      },
      rejectApproval: () => ({ status: 'denied', reason: 'x' }),
    },
    resolveActor: async () => 'admin-uuid',
    allowedChatId: 123,
  });

  await bot.handleUpdate({ message: { from: { id: 999 }, text: '/approve abc-123' } });
  assert.deepStrictEqual(calls, []);
});

test('inline /reject command rejects the queued action', async () => {
  const calls: any[] = [];
  const bot = new TelegramAgentBot({
    send: async () => true,
    actions: {
      approveApproval: async () => ({ status: 'ok', result: 'x' }),
      rejectApproval: (id) => {
        calls.push(id);
        return { status: 'denied', reason: 'rejected by superadmin' };
      },
    },
    resolveActor: async () => 'admin-uuid',
    allowedChatId: 123,
  });

  await bot.handleUpdate({ message: { from: { id: 123 }, text: '/reject xyz-9' } });
  assert.deepStrictEqual(calls, ['xyz-9']);
});
