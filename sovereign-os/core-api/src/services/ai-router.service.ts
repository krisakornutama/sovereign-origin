import { prisma } from '../lib/prisma';

// ────────────────────────────────────────────────────────────────────────────
// AI Task Router — ผูก "โดเมนงาน" ของระบบ → โมเดล Ollama ที่ใช้
// เก็บค่าใน SystemSetting (key = ai.route.<TASK>) — override ได้จาก UI
// บริการอื่นเรียก getModelForTask('CODING_AGENT') แทนการฝังชื่อโมเดลตายตัว
// ────────────────────────────────────────────────────────────────────────────

export const TASK_TYPES = ['CODING_AGENT', 'VISION_AI', 'REASONING_GOVERNOR', 'GENERAL_ASSISTANT'] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const DEFAULT_ROUTES: Record<TaskType, string> = {
  CODING_AGENT: 'qwen3:8b',
  VISION_AI: 'qwen3-vl:8b',
  REASONING_GOVERNOR: 'deepseek-r1:8b',
  GENERAL_ASSISTANT: 'gemma3:4b',
};

const keyOf = (task: string) => `ai.route.${task}`;

function isTaskType(t: string): t is TaskType {
  return (TASK_TYPES as readonly string[]).includes(t);
}

/**
 * คืนโมเดลที่ผูกกับโดเมนงาน — ลำดับ: DB override > legacyFallback (env เดิม) > spec default
 * ไม่เคย throw (fallback ซ้อนเสมอ เพื่อไม่ให้ระบบอื่นสะดุด)
 * @param legacyFallback ค่า env เดิมของ service ผู้เรียก (เช่น CODING_MODEL) — ใช้เมื่อยังไม่ตั้ง override ใน Matrix
 */
export async function getModelForTask(taskType: string, legacyFallback?: string): Promise<string> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: keyOf(taskType) } });
    const v = row?.value?.trim();
    if (v) return v;
  } catch { /* DB มีปัญหา → ตกไป fallback */ }
  const legacy = legacyFallback?.trim();
  if (legacy) return legacy;
  if (!isTaskType(taskType)) return DEFAULT_ROUTES.GENERAL_ASSISTANT;
  return DEFAULT_ROUTES[taskType];
}

/**
 * คืนแผนที่ effective ทั้งหมด — DB override ทับ legacy defaults ทับ spec default
 * @param legacyDefaults แผนที่ env เดิมของแต่ละโดเมน (จาก constants ของ services) เพื่อแสดงค่าที่ใช้จริง
 */
export async function getAllRoutes(legacyDefaults?: Partial<Record<TaskType, string>>): Promise<Record<TaskType, string>> {
  const out: Record<TaskType, string> = { ...DEFAULT_ROUTES };
  if (legacyDefaults) {
    for (const task of TASK_TYPES) {
      const legacy = legacyDefaults[task]?.trim();
      if (legacy) out[task] = legacy;
    }
  }
  try {
    const rows = await prisma.systemSetting.findMany({
      where: { key: { startsWith: 'ai.route.' } },
    });
    for (const row of rows) {
      const task = row.key.replace('ai.route.', '');
      if (isTaskType(task) && row.value.trim()) out[task] = row.value.trim();
    }
  } catch { /* ใช้ default ทั้งชุด */ }
  return out;
}

/** ตั้งค่า routing — validate task + รูปแบบชื่อโมเดลเบื้องต้น */
export async function setModelForTask(taskType: string, model: string): Promise<{ ok: boolean; error?: string }> {
  if (!isTaskType(taskType)) return { ok: false, error: `taskType ไม่รู้จัก — ใช้ได้: ${TASK_TYPES.join(', ')}` };
  const m = model.trim();
  if (!m || !/^[a-zA-Z0-9._\-/:]+$/.test(m)) return { ok: false, error: 'ชื่อโมเดลไม่ถูกต้อง' };
  await prisma.systemSetting.upsert({
    where: { key: keyOf(taskType) },
    update: { value: m },
    create: { key: keyOf(taskType), value: m },
  });
  return { ok: true };
}

/** ล้าง override → กลับไปใช้ default */
export async function resetModelForTask(taskType: string): Promise<void> {
  await prisma.systemSetting.deleteMany({ where: { key: keyOf(taskType) } });
}
