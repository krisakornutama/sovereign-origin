// ai-agent-page-budget-truth — pages/ai-agent.tsx เกินเพดาน 800 ต้องย้าย types+hooks ออก (FE-005)
//
// เหตุผล: pages/ai-agent.tsx 1064 บรรทัด > เพดาน page 800 — เกิน 264
// วิธีแก้: ย้าย types/interfaces/AUTONOMY_META/fmtTime/fmtArgs ไป lib/ai-agent-types.ts
//   + แยก state/handlers 3 domain เป็น hook: use-ai-chat / use-ai-team / use-ai-policy
//   ย้าย verbatim · JSX ทั้งหมดคงเดิม (ไม่แยก panel รอบนี้) — ชื่อตัวแปร/props ใน JSX ไม่เปลี่ยน
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FE = path.join(ROOT, 'sovereign-frontend', 'src');
const PAGE = path.join(FE, 'pages', 'ai-agent.tsx');
const TYPES = path.join(FE, 'lib', 'ai-agent-types.ts');
const CHAT = path.join(FE, 'components', 'ai-agent', 'use-ai-chat.ts');
const TEAM = path.join(FE, 'components', 'ai-agent', 'use-ai-team.ts');
const POLICY = path.join(FE, 'components', 'ai-agent', 'use-ai-policy.ts');

test('pages/ai-agent.tsx ต้องจัดขนาดลง ≤ 800 บรรทัด (เพดาน pages)', () => {
  const n = readFileSync(PAGE, 'utf8').split('\n').length;
  assert.ok(n <= 800, `ai-agent.tsx = ${n} บรรทัด > เพดาน 800 — ย้าย types+hooks ตาม FE-005`);
});

test('lib/ai-agent-types.ts ต้องมี types/AUTONOMY_META/fmt ครบ (ย้ายตามเดิม)', () => {
  assert.ok(existsSync(TYPES), 'lib/ai-agent-types.ts ยังไม่มี');
  const src = readFileSync(TYPES, 'utf8');
  for (const k of ['AutonomyLevel', 'ToolKind', 'ApprovalStatus', 'AiToolInfo', 'AiPolicy', 'Approval', 'AiStatus', 'ChatMsg', 'AUTONOMY_META', 'fmtTime', 'fmtArgs']) {
    assert.match(src, new RegExp(`\\b${k}\\b`), `types ต้องมี ${k}`);
  }
  assert.match(src, /export (type|interface|const|function)/, 'ต้อง export ให้หน้า/hook ใช้ต่อ');
});

test('hook 3 ไฟล์ต้องมีอยู่ ≤ 400 และครบ logic domain (ย้ายตามเดิม)', () => {
  for (const [p, rel] of [[CHAT, 'use-ai-chat'], [TEAM, 'use-ai-team'], [POLICY, 'use-ai-policy']]) {
    assert.ok(existsSync(p), `components/ai-agent/${rel}.ts ยังไม่มี`);
    const n = readFileSync(p, 'utf8').split('\n').length;
    assert.ok(n <= 400, `${rel}.ts = ${n} บรรทัด > เพดาน 400`);
  }
  const chat = readFileSync(CHAT, 'utf8');
  for (const fn of ['sendChat', 'fileToBase64', 'useAiChatHistory']) assert.match(chat, new RegExp(`\\b${fn}\\b`), `use-ai-chat ต้องมี ${fn}`);
  assert.match(chat, /api\/ai\/chat/, 'sendChat ต้องยิง /api/ai/chat เหมือนเดิม');
  const team = readFileSync(TEAM, 'utf8');
  for (const fn of ['loadRoles', 'loadJobs', 'createRole', 'updateRole', 'deleteRole', 'runRole', 'cancelJob', 'deleteJob']) assert.match(team, new RegExp(`\\b${fn}\\b`), `use-ai-team ต้องมี ${fn}`);
  assert.match(team, /api\/agent\/roles/, 'team hook ต้องยิง /api/agent/roles เหมือนเดิม');
  const policy = readFileSync(POLICY, 'utf8');
  for (const fn of ['loadPolicy', 'loadApprovals', 'loadStatus', 'changeAutonomy', 'decideApproval']) assert.match(policy, new RegExp(`\\b${fn}\\b`), `use-ai-policy ต้องมี ${fn}`);
  assert.match(policy, /api\/ai\/policy/, 'policy hook ต้องยิง /api/ai/policy เหมือนเดิม');
});

test('หน้าไม่เหลือ state/handler เดิมค้าง — ต้อง import hook ครบ 3 + types', () => {
  const src = readFileSync(PAGE, 'utf8');
  for (const sig of ['useState<AiPolicy | null>', 'useState<AiStatus | null>', 'const sendChat', 'const createRole', 'const decideApproval', 'const changeAutonomy', 'const loadPolicy', 'useAiChatHistory(50']) {
    assert.ok(!src.includes(sig), `"${sig}" ยังค้างในหน้า — ต้องอยู่ใน hook/types`);
  }
  for (const fn of ['useAiChat', 'useAiTeam', 'useAiPolicy']) {
    assert.match(src, new RegExp(`\\b${fn}\\b`), `หน้าต้องเรียก ${fn}`);
  }
  assert.match(src, /from '..\/lib\/ai-agent-types'/, 'หน้าต้อง import types จาก lib/ai-agent-types');
});
