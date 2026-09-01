import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { agentPolicy, AGENT_TOOLS } from '../../services/agent-policy.service';
import { agentActions } from '../../services/agent-actions.service';
import * as chatMemory from '../../services/chat-memory.service';
import * as advisor from '../../services/advisor.service';
import axios from 'axios';
import os from 'os';
import { getModelForTask } from '../../services/ai-router.service';
import { prisma } from '../../lib/prisma';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const CURRENT_MODEL = process.env.AI_MODEL || 'gemma3:4b';

const router = Router();

// Heuristic voice command parser (fallback when Ollama is slow/unavailable)
function parseVoiceCommandHeuristic(text: string): any {
  const t = text.toLowerCase().trim();
  
  // Intent detection
  let intent = 'help';
  if (/(เพิ่ม|ใส่|เพิ่มเข้า).*(น้ำ|water)/.test(t)) intent = 'inventory_add';
  else if (/(นำออก|เอาออก|ลด).*(น้ำ|water)/.test(t)) intent = 'inventory_remove';
  else if (/(เพิ่ม|ใส่).*(อาหาร|ข้าว|ผัก|ผลไม้|food)/.test(t)) intent = 'inventory_add';
  else if (/(เก็บเกี่ยว|เก็บ).*(ข้าว|ผัก|ผลไม้|crop)/.test(t)) intent = 'farm_harvest';
  else if (/(ปลูก|หว่าน).*(ข้าว|ผัก|crop)/.test(t)) intent = 'farm_plant';
  else if (/(ความดัน|bp|บีพี)/.test(t)) intent = 'health_bp';
  else if (/(น้ำหนัก|weight)/.test(t)) intent = 'health_weight';
  else if (/(น้ำตาล|sugar|glucose)/.test(t)) intent = 'health_sugar';
  else if (/(สั่ง|order).*(อาหาร|ข้าว|menu)/.test(t)) intent = 'restaurant_order';
  else if (/(จ่าย|pay|ชำระ)/.test(t)) intent = 'restaurant_pay';
  else if (/(เช็ค|check).*(เซ็นเซอร์|sensor|น้ำ|water|แบต|battery)/.test(t)) intent = 'sensor_check';
  else if (/(สถานะ|status).*(ระบบ|system)/.test(t)) intent = 'system_status';

  // Kids domain
  else if (/(งานบ้าน|chore|ภาระ)/.test(t)) intent = 'kids_chore';
  else if (/(บิล|cost|ค่าใช้จ่าย|cost).*(ลูก|kid|con)/.test(t)) intent = 'kids_bill';
  else if (/(ค่าขนม|allowance|เงินกิน|pocket money)/.test(t)) intent = 'kids_allowance';
  else if (/(แลกคูปอง|redeem|coupon)/.test(t)) intent = 'kids_coupon';
  else if (/(เรียน|lesson|quiz|แบบทดสอบ|คะแนน)/.test(t)) intent = 'kids_lesson';
  else if (/(พอร์ต|portfolio|หุ้น|stock).*(ลูก|kid)/.test(t)) intent = 'kids_portfolio';
  else if (/(กระปุก|piggy|เก็บเงิน|ออม)/.test(t)) intent = 'kids_piggy';

  // Security/Relay/Automation
  else if (/(รีเลย์|relay|สวิตช์|switch|ปิด|เปิด).*(ไฟ|light|ปั๊ม|pump|พัดลม|fan)/.test(t)) intent = 'relay_control';
  else if (/(อัตโนมัติ|automation|กฎ|rule).*(เพิ่ม|เพิ่มเข้า|สร้าง|create)/.test(t)) intent = 'automation_create';
  else if (/(อัตโนมัติ|automation|กฎ|rule).*(ลบ|delete|ปิด|disable)/.test(t)) intent = 'automation_delete';
  else if (/(ความปลอดภัย|security|กล้อง|camera|การตรวจจับ|detection)/.test(t)) intent = 'security_check';
  else if (/(ล็อก|lock|ปลดล็อก|unlock).*(ประตู|door|ประตูหน้า|front door)/.test(t)) intent = 'door_lock';

  // Energy/Power
  else if (/(พลังงาน|energy|ไฟฟ้า|electric|แบตเตอรี่|battery|โซล่า|solar|inverter)/.test(t)) intent = 'energy_status';
  else if (/(ชาร์จ|charge|ชาร์จ).*(แบต|battery|โซล่า|solar)/.test(t)) intent = 'energy_charge';

  // Query intents (ask about status/behavior)
  else if (/(ลูก|kid|con).*(ทำอะไร|ทำไร|พฤติกรรม|behavior|เรียน|เรียนรู้|course|progress)/.test(t)) intent = 'kids_query';
  else if (/(เซ็นเซอร์|sensor|น้ำ|water|แบต|battery|ไฟ|power|ไฟฟ้า).*(สถานะ|status|ค่า|value|คือเท่าไหร่|เท่าไหร่)/.test(t)) intent = 'sensor_query';
  else if (/(ระบบ|system|เซิร์ฟเวอร์|server).*(สถานะ|status|ปกติไหม|ปกติไหม|ทำงานไหม)/.test(t)) intent = 'system_query';
  else if (/(ฟาร์ม|farm|แปลง|plot|พืช|crop|เก็บเกี่ยว|harvest).*(สถานะ|status|พร้อมไหม|พร้อมไหม|เมื่อไหร่)/.test(t)) intent = 'farm_query';
  else if (/(คลัง|inventory|ของ|stock|วัตถุดิบ|ingredient).*(มีอะไร|มีเท่าไหร่|เหลือเท่าไหร่|หมดอะไร)/.test(t)) intent = 'inventory_query';
  else if (/(ลูก|kid|con).*(กิน|กินอะไร|กินแล้วไหม|กินยัง|อาหาร|food)/.test(t)) intent = 'kids_food_query';
  else if (/(เงิน|money|กระเป๋า|wallet|พอร์ต|portfolio|หุ้น|stock|กำไร|profit|ขาดทุน|loss)/.test(t)) intent = 'finance_query';

  // Help
  else if (/(ช่วย|help|วิธีใช้|วิธี|คำสั่ง|command|ทำได้อะไร|ทำได้อะไร)/.test(t)) intent = 'help';

  // Entity extraction
  const entities: any = {};
  
  // Numbers with units — ห้ามติดลบและเกิน 10000
  const qtyMatch = t.match(/(\d+(?:\.\d+)?)\s*(ลิตร|ล|กิโลกรัม|กิโล|กก\.|กิโลกรัม|mg\/dl|mmhg|จาน|ชิ้น|ถ้วย|ช้อน)/);
  if (qtyMatch) {
    const q = parseFloat(qtyMatch[1]);
    if (q < 0 || q > 10000) return { intent: 'help', entities: {}, confidence: 0.9, action: undefined };
    entities.quantity = q;
    entities.unit = qtyMatch[2].replace('กิโลกรัม', 'กิโลกรัม').replace('กก.', 'กิโลกรัม').replace('กิโล', 'กิโลกรัม').replace('ลิตร', 'ลิตร').replace('ล', 'ลิตร');
  }

  // Water
  if (/(น้ำ|water)/.test(t)) entities.category = 'water';
  
  // Blood pressure — validate range 70-250 / 40-150
  const bpMatch = t.match(/(\d{2,3})\s*[/\\\/]\s*(\d{2,3})/);
  if (bpMatch) {
    const sys = parseInt(bpMatch[1]); const dia = parseInt(bpMatch[2]);
    if (sys >= 70 && sys <= 250 && dia >= 40 && dia <= 150) {
      entities.systolic = sys; entities.diastolic = dia;
    } else {
      return { intent: 'help', entities: {}, confidence: 0.9, action: undefined };
    }
  }

  // Numbers without units (generic value)
  const numMatch = t.match(/(?:ค่า|value|เช็ค|check)\s*(\d+(?:\.\d+)?)/);
  if (numMatch && !entities.value) entities.value = parseFloat(numMatch[1]);

  // Table number
  const tableMatch = t.match(/(โต๊ะ|table)\s*([A-Z]?\d+)/i);
  if (tableMatch) entities.table = tableMatch[2].toUpperCase();

  // Payment
  if (/promptpay|พรอมต์เพย์/.test(t)) entities.payment = 'promptpay';
  else if (/เงินสด|cash/.test(t)) entities.payment = 'cash';

  // Kids entities
  if (/(ลูก|kid|con|ลูกชาย|ลูกสาว|son|daughter)/.test(t)) {
    const kidNameMatch = t.match(/(ลูก|kid|con|ลูกชาย|ลูกสาว|son|daughter)\s*([ก-๙a-zA-Z]+)/);
    if (kidNameMatch) entities.kidName = kidNameMatch[2];
  }
  if (/(ช็อค|chore|ภาระ|งานบ้าน|ทำ|ทำไร)/.test(t)) entities.choreType = 'chore';
  if (/(บิล|bill|ค่าใช้จ่าย|cost|จ่าย)/.test(t)) entities.billType = 'bill';
  if (/(คูปอง|coupon|แลก|redeem|รางวัล|reward)/.test(t)) entities.couponType = 'coupon';
  if (/(บทเรียน|lesson|เรียน|quiz|แบบทดสอบ|คะแนน|score)/.test(t)) entities.lessonType = 'lesson';
  if (/(พอร์ต|portfolio|หุ้น|stock|ซื้อ|buy|ขาย|sell)/.test(t)) entities.portfolioAction = 'portfolio';

  // Security/Relay
  if (/(รีเลย์|relay|สวิตช์|switch|ปิด|เปิด|on|off).*(ไฟ|light|ปั๊ม|pump|พัดลม|fan|น้ำ|water)/.test(t)) {
    entities.relayAction = /(ปิด|off)/.test(t) ? 'off' : 'on';
    const relayMatch = t.match(/(relay|รีเลย์)\s*(\d+)/i);
    if (relayMatch) entities.relayId = relayMatch[2];
  }
  if (/(ล็อก|lock|ปลดล็อก|unlock)/.test(t)) entities.lockAction = /(ปลดล็อก|unlock)/.test(t) ? 'unlock' : 'lock';
  if (/(กล้อง|camera|การตรวจจับ|detection|คนแปลก|stranger)/.test(t)) entities.securityCheck = true;

  // Energy
  if (/(แบตเตอรี่|battery|โซล่า|solar|inverter|ชาร์จ|charge)/.test(t)) {
    entities.energyType = 'battery';
    const chargeMatch = t.match(/(ชาร์จ|charge)\s*(\d+)\s*%/);
    if (chargeMatch) entities.targetPercent = parseInt(chargeMatch[1]);
  }

  // Query entities
  if (/status|สถานะ|ค่า|value|เท่าไหร่|เท่าไร|คือเท่าไหร่/.test(t)) {
    if (/(น้ำ|water)/.test(t)) entities.queryMetric = 'water_level_cm';
    else if (/(แบต|battery|แบตเตอรี่)/.test(t)) entities.queryMetric = 'battery_soc';
    else if (/(ไฟ|power|electric|พลังงาน|energy)/.test(t)) entities.queryMetric = 'power_kw';
    else if (/(อุณหภูมิ|temp|temperature)/.test(t)) entities.queryMetric = 'temperature';
    else if (/(ความชื้น|humidity|concentration)/.test(t)) entities.queryMetric = 'humidity';
  }

  // Confidence based on how many entities found
  const entityCount = Object.keys(entities).length;
  const confidence = Math.min(0.5 + entityCount * 0.15, 0.9);

  return {
    intent,
    entities,
    confidence,
    action: intent !== 'help' ? { endpoint: `/api/${intent}`, method: 'POST', payload: entities } : undefined,
  };
}

// GET /api/ai/local-status — สวิตช์ AI ในเครื่อง (default ปิด — ต้องกดเปิดในแอป)
router.get('/local-status', authenticate, async (_req, res) => {
  const { getAiEnabled } = await import('../../services/local-llm.service');
  const s = await getAiEnabled();
  res.json(s);
});

// PUT /api/ai/enabled {enabled: bool} — เปิด/ปิด AI ในเครื่อง (SUPERADMIN)
router.put('/enabled', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  const { setAiEnabled } = await import('../../services/local-llm.service');
  const enabled = !!req.body?.enabled;
  const r = await setAiEnabled(enabled);
  res.json(r);
});

// PUT /api/ai/model {model: string} — เลือกโมเดล (SUPERADMIN)
router.put('/model', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  try {
    const { setAiModel } = await import('../../services/local-llm.service');
    await setAiModel(String(req.body?.model || ''));
    res.json({ success: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/ai/status — สถานะ AI: Ollama ออนไลน์ไหม, โมเดลที่ใช้, ทรัพยากรระบบ
router.get('/status', authenticate, async (_req, res) => {
  let ollamaOnline = false;
  let models: Array<{ name: string; size: string }> = [];
  try {
    const r = await axios.get(`${OLLAMA_URL}/api/tags`, { timeout: 4000 });
    ollamaOnline = true;
    models = ((r.data?.models as any[]) || []).map((m) => ({
      name: m.name,
      size: m.size != null ? (m.size / 1024 / 1024 / 1024).toFixed(1) + ' GB' : '?',
    }));
  } catch {
    ollamaOnline = false;
  }

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const load = os.loadavg();
  const cpuCount = os.cpus().length;

  res.json({
    ollamaOnline,
    ollamaUrl: OLLAMA_URL,
    currentModel: await getModelForTask('GENERAL_ASSISTANT', CURRENT_MODEL),
    models,
    resources: {
      cpuCores: cpuCount,
      cpuUsagePercent: cpuCount > 0 ? Math.min(100, Math.round((load[0] / cpuCount) * 100)) : null,
      memoryTotalGb: Number((totalMem / 1024 / 1024 / 1024).toFixed(1)),
      memoryFreeGb: Number((freeMem / 1024 / 1024 / 1024).toFixed(1)),
      memoryUsedPercent: totalMem > 0 ? Math.round(((totalMem - freeMem) / totalMem) * 100) : null,
    },
    uptimeSeconds: os.uptime(),
  });
});

// GET /api/ai/policy — ระดับ autonomy ปัจจุบัน + สิทธิ์ของแต่ละ tool
router.get('/policy', authenticate, (req, res) => {
  const autonomy = agentPolicy.getAutonomy();
  const tools = Object.entries(AGENT_TOOLS).map(([name, tool]) => ({
    name,
    kind: tool.kind,
    description: tool.description,
    available: tool.kind === 'read-only' || autonomy !== 'view',
  }));
  res.json({
    autonomy,
    approvalTtlMs: agentPolicy.getApprovalTtlMs(),
    protectedIps: agentPolicy.getProtectedIps(),
    protectedProcesses: agentPolicy.getProtectedProcesses(),
    tools,
  });
});

// PUT /api/ai/policy — เปลี่ยนระดับ autonomy (Superadmin เท่านั้น)
router.put('/policy', authenticate, requireRole('SUPERADMIN'), (req, res) => {
  const { autonomy } = req.body;
  if (!autonomy) return res.status(400).json({ error: 'autonomy is required' });
  try {
    agentPolicy.setAutonomy(autonomy);
    res.json({ autonomy: agentPolicy.getAutonomy() });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/ai/approvals — รายการคำขออนุมัติ (pending + ประวัติล่าสุด)
router.get('/approvals', authenticate, requireRole('SUPERADMIN'), (req, res) => {
  res.json(agentActions.listApprovals());
});

// POST /api/ai/approvals/:id/approve — อนุมัติและสั่งให้ดำเนินการ
router.post('/approvals/:id/approve', authenticate, requireRole('SUPERADMIN'), async (req, res) => {
  const result = await agentActions.approveApproval(req.params.id, req.user?.id);
  if (result.status === 'denied') {
    return res.status(400).json(result);
  }
  res.json(result);
});

// POST /api/ai/approvals/:id/reject — ปฏิเสธคำขอ
router.post('/approvals/:id/reject', authenticate, requireRole('SUPERADMIN'), (req, res) => {
  const result = agentActions.rejectApproval(req.params.id, req.user?.id);
  if (!result) {
    return res.status(404).json({ error: 'Approval not found or already decided' });
  }
  res.json(result);
});

// ── P1: Conversational Memory — ประวัติสนทนา ──

// GET /api/ai/history — ประวัติการสนทนาล่าสุด (?limit=, default 50, max 200)
router.get('/history', authenticate, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '50'), 10) || 50, 1), 200);
    const rows = await chatMemory.listHistory(String(req.user?.id), limit);
    res.json({
      history: rows.map((r) => ({
        id: r.id,
        role: r.role,
        content: r.content,
        created_at: r.created_at,
      })),
    });
  } catch (err) {
    console.error('Chat history error:', err);
    res.status(500).json({ error: 'Failed to load chat history' });
  }
});

// DELETE /api/ai/history — ล้างประวัติทั้งหมด (ทุกคนในบ้านใช้ร่วม?)
router.delete('/history', authenticate, async (req, res) => {
  const count = await chatMemory.clearHistory(String(req.user?.id));
  res.json({ success: true, deleted: count });
});

// DELETE /api/ai/history/:id — ลบข้อความเดียว
router.delete('/history/:id', authenticate, async (req, res) => {
  const ok = await chatMemory.deleteMessage(req.params.id, String(req.user?.id));
  if (!ok) return res.status(404).json({ error: 'Message not found' });
  res.json({ success: true });
});

// ── P2: Decision Support AI — ถาม "ควรทำอะไรดี" จากข้อมูลจริง ──

// POST /api/ai/advisor — วิเคราะห์จากสถานการณ์จริง → คำแนะนำไทย
router.post('/advisor', authenticate, async (req, res) => {
  const question = String(req.body?.question || '').trim();
  if (!question) return res.status(400).json({ error: 'question is required' });
  if (question.length > 2000) return res.status(400).json({ error: 'question too long (max 2000)' });
  try {
    const context = await advisor.buildSituationContext();
    const advice = await advisor.askAdvisor(question, context);
    res.json({ question, advice, context });
  } catch (err) {
    console.error('Advisor route error:', err);
    res.status(500).json({ error: 'Advisor failed' });
  }
});

// POST /api/ai/advisor/what-if — สถานการณ์จำลอง (ฝนไม่ตก/ไฟไม่มี/ค่าใช้จ่ายขึ้น)
router.post('/advisor/what-if', authenticate, async (req, res) => {
  const scenario = String(req.body?.scenario || '');
  const days = Math.floor(Number(req.body?.days));
  if (!advisor.WHAT_IF_SCENARIOS.includes(scenario as any)) {
    return res.status(400).json({ error: `invalid scenario (${advisor.WHAT_IF_SCENARIOS.join('|')})` });
  }
  if (!(days >= 1 && days <= 365)) {
    return res.status(400).json({ error: 'days must be a number 1-365' });
  }
  try {
    const context = await advisor.buildSituationContext();
    const computed = advisor.runWhatIf(context, { scenario: scenario as any, days });
    const advice = await advisor.summarizeImpact(computed, context);
    res.json({ params: { scenario, days }, computed, advice, context });
  } catch (err) {
    console.error('Advisor what-if route error:', err);
    res.status(500).json({ error: 'What-if failed' });
  }
});

// POST /api/ai/voice-command — parse เสียงพูด → intent + entities + action ที่พร้อม execute
router.post('/voice-command', authenticate, async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text is required' });
  if (text.length > 500) return res.status(400).json({ error: 'text too long (max 500)' });

  try {
    const prompt = `คุณคือ Voice Command Parser สำหรับ Sovereign OS
ผู้ใช้พูด: "${text}"

โปรดแปลงเป็น JSON เท่านั้น:
{
  "intent": "inventory_add|inventory_remove|farm_harvest|farm_plant|health_bp|health_weight|health_sugar|restaurant_order|restaurant_pay|sensor_check|system_status|help",
  "entities": {
    "item": "ชื่อสิ่งของ (ถ้ามี)",
    "quantity": จำนวน (number ถ้ามี),
    "unit": "หน่วย (ลิตร|กิโลกรัม|กิโล|ลิตร|mg/dL|mmHg|kg)",
    "crop": "ชื่อพืช (ถ้ามี)",
    "systolic": จำนวน (ถ้ามี),
    "diastolic": จำนวน (ถ้ามี),
    "value": ค่าเลขทั่วไป (ถ้ามี),
    "category": "หมวดหมู่ (water|food|fuel|seed|medicine|tool)",
    "menu": "ชื่อเมนู (ถ้ามี)",
    "table": "หมายเลขโต๊ะ (ถ้ามี)",
    "payment": "cash|promptpay",
    "metric": "metric name สำหรับ sensor_check"
  },
  "confidence": 0-1,
  "action": {
    "endpoint": "API endpoint ที่ต้องเรียก",
    "method": "POST|GET|PUT",
    "payload": {}
  }
}

ตัวอย่าง:
"เพิ่มน้ำ 20 ลิตร" → intent: inventory_add, entities: {item:"น้ำ", quantity:20, unit:"ลิตร", category:"water"}
"เก็บเกี่ยวข้าวหอมมะลิ 50 กิโลกรัม" → intent: farm_harvest, entities: {crop:"ข้าวหอมมะลิ", quantity:50, unit:"กิโลกรัม"}
"บันทึกความดัน 130 สlash 85" → intent: health_bp, entities: {systolic:130, diastolic:85}
"เช็คน้ำ 30 เซนติเมตร" → intent: sensor_check, entities: {metric:"water_level_cm", value:30}
"สั่งข้าวผัด 2 จาน โต๊ะ A1 จ่าย promptpay" → intent: restaurant_order, entities: {menu:"ข้าวผัด", quantity:2, table:"A1", payment:"promptpay"}

ห้ามตอบอย่างอื่น — ตอบ JSON เท่านั้น`;

    const { getModelForTask } = await import('../../services/ai-router.service');
    const model = await getModelForTask('GENERAL_ASSISTANT', process.env.AI_MODEL || 'gemma3:4b');
    
    // Try Ollama first with short timeout, fallback to heuristic parser
    let parsed: any = null;
    try {
      const response = await axios.post(`${OLLAMA_URL}/api/generate`, {
        model,
        prompt,
        stream: false,
        options: { temperature: 0.1, num_predict: 300 },
      }, { timeout: 8000 });

      const raw = response.data?.response?.trim() || '';
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
    } catch (ollamaErr: any) {
      console.warn('Voice command Ollama timeout/fallback:', ollamaErr?.message || ollamaErr);
    }

    // Fallback: simple heuristic parser (fast, no Ollama)
    if (!parsed) {
      parsed = parseVoiceCommandHeuristic(text);
    }

    res.json({ success: true, ...parsed, originalText: text });
  } catch (err: any) {
    console.error('Voice command error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

  // GET /api/ai/voice-query — ถามสถานะ/ข้อมูลระบบด้วยเสียง (auto-execute query)
  router.get('/voice-query', authenticate, async (req, res) => {
    const text = String(req.query.text || '').trim();
    if (!text) return res.status(400).json({ error: 'text query parameter is required' });
    if (text.length > 500) return res.status(400).json({ error: 'text too long (max 500)' });

    try {
      const parsed = parseVoiceCommandHeuristic(text);
      // Query intents - auto-execute and return real data
      const queryIntents = ['sensor_query', 'system_query', 'farm_query', 'inventory_query', 'kids_query', 'kids_food_query', 'finance_query', 'energy_status', 'security_check', 'kids_query', 'help', 'kids_chore', 'kids_bill', 'kids_allowance', 'kids_coupon', 'kids_lesson', 'kids_portfolio', 'kids_piggy', 'relay_control', 'automation_create', 'automation_delete', 'security_check', 'door_lock', 'energy_status', 'energy_charge', 'kids_food_query', 'finance_query'];
      if (parsed.intent === 'help') {
        return res.json({ success: true, ...parsed, originalText: text, help: true, helpText: VOICE_HELP_TEXT });
      }
      if (!queryIntents.includes(parsed.intent)) {
        return res.json({ success: true, ...parsed, originalText: text, message: 'คำสั่งนี้ต้องใช้ voice-command (POST) เพื่อดำเนินการ' });
      }

      // Auto-execute query based on intent
      let queryResult: any = null;
      try {
        switch (parsed.intent) {
          case 'sensor_query':
            queryResult = await executeSensorQuery(parsed.entities);
            break;
          case 'system_query':
            queryResult = await executeSystemQuery(parsed.entities);
            break;
          case 'farm_query':
            queryResult = await executeFarmQuery(parsed.entities);
            break;
          case 'inventory_query':
            queryResult = await executeInventoryQuery(parsed.entities);
            break;
          case 'kids_query':
            queryResult = await executeKidsQuery(parsed.entities);
            break;
          case 'kids_food_query':
            queryResult = await executeKidsFoodQuery(parsed.entities);
            break;
          case 'finance_query':
            queryResult = await executeFinanceQuery(parsed.entities);
            break;
          case 'energy_status':
            queryResult = await executeEnergyQuery(parsed.entities);
            break;
          case 'security_check':
            queryResult = await executeSecurityQuery(parsed.entities);
            break;
          case 'kids_chore':
            queryResult = await executeKidsChoreQuery(parsed.entities);
            break;
          case 'kids_bill':
            queryResult = await executeKidsBillQuery(parsed.entities);
            break;
          case 'kids_allowance':
            queryResult = await executeKidsAllowanceQuery(parsed.entities);
            break;
          case 'kids_coupon':
            queryResult = await executeKidsCouponQuery(parsed.entities);
            break;
          case 'kids_lesson':
            queryResult = await executeKidsLessonQuery(parsed.entities);
            break;
          case 'kids_portfolio':
            queryResult = await executeKidsPortfolioQuery(parsed.entities);
            break;
          case 'kids_piggy':
            queryResult = await executeKidsPiggyQuery(parsed.entities);
            break;
          case 'relay_control':
            queryResult = await executeRelayQuery(parsed.entities);
            break;
          case 'security_check':
            queryResult = await executeSecurityQuery(parsed.entities);
            break;
          case 'finance_query':
            queryResult = await executeFinanceQuery(parsed.entities);
            break;
          case 'energy_status':
          case 'energy_charge':
            queryResult = await executeEnergyQuery(parsed.entities);
            break;
          case 'kids_food_query':
            queryResult = await executeKidsFoodQuery(parsed.entities);
            break;
          default:
            queryResult = { message: 'Query type not fully implemented yet' };
        }
      } catch (queryErr: any) {
        console.error('Query execution error:', queryErr.message);
        queryResult = { error: queryErr.message };
      }

      res.json({ success: true, ...parsed, originalText: text, isQuery: true, queryResult });
    } catch (err: any) {
      console.error('Voice query error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/ai/voice-history — เก็บประวัติเสียง (frontend ส่งมาหลัง parse สำเร็จ)
  const voiceHistoryMem:any[]=[]; const voiceHistoryPath='/app/data/voice_history.json';
  try{const f=require('fs'); if(f.existsSync(voiceHistoryPath)) voiceHistoryMem.push(...JSON.parse(f.readFileSync(voiceHistoryPath,'utf8')).slice(0,200)); else if(f.existsSync('/tmp/voice_history.json')) voiceHistoryMem.push(...JSON.parse(f.readFileSync('/tmp/voice_history.json','utf8')).slice(0,200));}catch{}
  router.post('/voice-history', authenticate, async (req, res) => {
    const {text,intent,entities}=req.body||{} as any;
    const row={id:Date.now().toString(),text,intent,entities,user_id:(req as any).user?.id||(req as any).user?.userId,created_at:new Date().toISOString()};
    voiceHistoryMem.unshift(row); if(voiceHistoryMem.length>200) voiceHistoryMem.pop();
    try{const f=require('fs'); f.mkdirSync('/app/data',{recursive:true}); f.writeFileSync(voiceHistoryPath,JSON.stringify(voiceHistoryMem.slice(0,200)));}catch{} try{require('fs').writeFileSync('/tmp/voice_history.json',JSON.stringify(voiceHistoryMem.slice(0,200)));}catch{}
    res.json({success:true,row});
  });
  router.get('/voice-history', authenticate, async (req,res)=>{
    const limit=Math.min(100, Number(req.query.limit)||20);
    res.json(voiceHistoryMem.slice(0,limit));
  });

  // Voice help text constant
  const VOICE_HELP_TEXT = `คำสั่งเสียงที่รองรับ:

📦 คลังสินค้า (Inventory):
- "เพิ่มน้ำ 20 ลิตร" / "เพิ่มข้าว 5 กก." / "เพิ่มอาหาร 3 ชิ้น"
- "เอาน้ำออก 10 ลิตร" / "ลดข้าว 2 กก."

🌾 ฟาร์ม:
- "เก็บเกี่ยวข้าว 50 กก." / "ปลูกข้าวหอมมะลิ"
- "เช็คฟาร์มสถานะ" / "ฟาร์มพร้อมเก็บเกี่ยวไหม"

🏥 สุขภาพ:
- "บันทึกความดัน 130/85" / "บันทึกน้ำหนัก 65 กก." / "บันทึกน้ำตาล 120"

🍽️ ร้านอาหาร:
- "สั่งข้าวผัด 2 จาน โต๊ะ A1" / "จ่ายบิลโต๊ะ A1 promptpay"

🔧 ระบบ/อุปกรณ์:
- "เปิดไฟ" / "ปิดปั๊มน้ำ" / "ล็อกประตูหน้า" / "ปลดล็อกประตูหลัง"
- "เช็คน้ำ 30 เซนติเมตร" / "เช็คแบตเตอรี่" / "เช็คไฟฟ้า"
- "สถานะระบบ" / "เช็คกล้อง" / "เช็คเซ็นเซอร์"

⚡ พลังงาน:
- "ชาร์จแบตเตอรี่ 80%" / "สถานะแบตเตอรี่" / "สถานะโซล่าเซลล์"

👶 ลูก:
- "ลูกน้ำทำภาระเสร็จ" / "ลูกชายกินข้าวยัง" / "ค่าขนมลูก 50 บาท"
- "แลกคูปองลูก" / "พอร์ตลูกซื้อหุ้น" / "บันทึกบทเรียนลูก"
- "ลูกน้ำทำภาระเสร็จ" / "บิลลูกชาย 50 บาท" / "ค่าขนมลูก 50 บาท"
- "แลกคูปองลูกน้ำ" / "พอร์ตลูกชายซื้อหุ้น" / "บันทึกบทเรียนลูกสาว"

❓ ช่วยเหลือ: "ช่วย" / "วิธีใช้" / "ทำได้อะไร"

ใช้ POST /api/ai/voice-command สำหรับคำสั่งที่ทำ action (เพิ่ม/ลด/สั่ง/จ่าย)
ใช้ GET /api/ai/voice-query?text=... สำหรับถามสถานะ/ข้อมูล (query only)`;

// Voice query execution functions
async function executeSensorQuery(entities: any) {
  const metric = entities.queryMetric || 'water_level_cm';
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT value, time FROM sensor_telemetry WHERE metric = $1 ORDER BY time DESC LIMIT 1`,
    metric
  );
  if (!rows.length) return { metric, message: 'No data available' };
  const latest = rows[0];
  return { metric, value: latest.value, time: latest.time, unit: getMetricUnit(metric) };
}

async function executeSystemQuery(entities: any) {
  const os = await import('os');
  const uptime = os.uptime();
  const cpuUsage = (os.loadavg()[0] / os.cpus().length * 100).toFixed(1) + '%';
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const memory = ((totalMem - freeMem) / totalMem * 100).toFixed(1) + '%';
  return { uptime: Math.floor(uptime / 3600) + 'h ' + Math.floor((uptime % 3600) / 60) + 'm', cpuUsage, memory };
}

async function executeFarmQuery(entities: any) {
  const plots = await prisma.farmPlot.findMany({ include: { soil_readings: { orderBy: { recorded_at: 'desc' }, take: 1 } } });
  return { total: plots.length, growing: plots.filter(p => p.status === 'growing').length, harvested: plots.filter(p => p.status === 'harvested').length, plots: plots.map(p => ({ id: p.id, name: p.name, crop: p.crop, status: p.status, soil: p.soil_readings[0] })) };
}

async function executeInventoryQuery(entities: any) {
  const category = entities.category;
  const where: any = {};
  if (category) where.category = category;
  const items = await prisma.inventoryItem.findMany({ where });
  return { total: items.length, items: items.map(i => ({ name: i.name, category: i.category, quantity: i.quantity, unit: i.unit, location: i.location, expiry: i.expiry_date })) };
}

async function executeKidsQuery(entities: any) {
  const kidName = entities.kidName;
  const where: any = {};
  if (kidName) where.name = { contains: kidName, mode: 'insensitive' };
  const kids = await prisma.kidProfile.findMany({ where, include: { chores: true, bills: true, progress: true } });
  return { count: kids.length, kids: kids.map(k => ({ name: k.name, age: k.age, pendingChores: k.chores.filter((c: any) => c.status === 'pending').length, unpaidBills: k.bills.filter((b: any) => b.status === 'unpaid').length, wallet: 0, lessons: k.progress.length })) };
}

async function executeKidsFoodQuery(entities: any) {
  const kidName = entities.kidName;
  return { message: `Food query for ${kidName || 'all kids'} - not fully implemented yet` };
}

async function executeFinanceQuery(entities: any) {
  const userId = 'f7aa134b-7436-475b-9346-5e914ab4a3e7';
  const positions = await prisma.assetPosition.findMany({ where: { user_id: userId } });
  const totalValue = positions.reduce((sum, p) => sum + p.quantity * (p.avg_cost_usd || 0), 0);
  return { totalValue: totalValue.toFixed(2), positions: positions.map(p => ({ symbol: p.symbol, quantity: p.quantity, value: (p.quantity * (p.avg_cost_usd || 0)).toFixed(2) })) };
}

async function executeEnergyQuery(entities: any) {
  const rows: any[] = await prisma.$queryRawUnsafe(`SELECT DISTINCT ON (metric) metric, value FROM sensor_telemetry WHERE metric IN ('battery_soc', 'power_kw', 'solar_radiation') ORDER BY metric, time DESC`);
  const data: Record<string, any> = {};
  rows.forEach(r => data[r.metric] = r.value);
  return data;
}

async function executeSecurityQuery(entities: any) {
  const events = await prisma.securityEvent.findMany({ orderBy: { timestamp: 'desc' }, take: 10 });
  return { recent: events.map(e => ({ type: e.event_type, severity: e.severity, description: e.description, time: e.timestamp })) };
}

async function executeKidsChoreQuery(entities: any) {
  const kidName = entities.kidName;
  const where: any = {};
  if (kidName) where.kid = { name: { contains: kidName, mode: 'insensitive' } };
  const chores = await prisma.kidChore.findMany({ where, include: { kid: true } });
  return { pending: chores.filter(c => c.status === 'pending').length, done: chores.filter(c => c.status === 'done').length, chores: chores.map(c => ({ kid: c.kid.name, title: c.title, status: c.status, reward: c.reward })) };
}
async function executeKidsAllowanceQuery(entities: any) {
  const kids = await prisma.kidProfile.findMany({ where: { allowance_amount: { not: null } } });
  return { kids: kids.map(k => ({ name: k.name, allowance: k.allowance_amount, day: k.allowance_day, lastPaid: k.allowance_last_paid })) };
}
async function executeKidsPortfolioQuery(entities: any) {
  const kidName = entities.kidName;
  const where: any = {};
  if (kidName) where.kid = { name: { contains: kidName, mode: 'insensitive' } };
  const portfolios = await prisma.kidInvestment.findMany({ where, include: { kid: true } });
  return { portfolios: portfolios.map(p => ({ kid: p.kid.name, symbol: p.symbol, units: p.units, avgCost: p.avg_cost })) };
}
async function executeRelayQuery(entities: any) {
  const relays = await prisma.relay.findMany({ include: { schedules: true } });
  return { relays: relays.map(r => ({ id: r.id, label: r.label, state: r.state, schedules: r.schedules.length })) };
}


function getMetricUnit(metric: string): string {
  const units: Record<string, string> = {
    water_level_cm: 'cm',
    battery_soc: '%',
    power_kw: 'kW',
    temperature: '°C',
    humidity: '%',
    soil_moisture: '%',
    ec_value: 'dS/m',
    ph: 'pH',
  };
  return units[metric] || '';
}



async function executeKidsLessonQuery(entities: any) {
  const kidName = entities.kidName;
  const where: any = {};
  if (kidName) where.kid = { name: { contains: kidName, mode: 'insensitive' } };
  const lessons = await prisma.kidLessonProgress.findMany({ where, include: { kid: true } });
  return { lessons: lessons.map(l => ({ kid: l.kid.name, lessonTitle: l.lesson_title, score: l.score, total: l.total, completedAt: l.completed_at })) };
}

async function executeKidsPiggyQuery(entities: any) {
  const kidName = entities.kidName;
  const where: any = {};
  if (kidName) where.kid = { name: { contains: kidName, mode: 'insensitive' } };
  const piggy = await prisma.kidPiggyTx.findMany({ where, include: { kid: true } });
  return { transactions: piggy.map(p => ({ kid: p.kid.name, amount: p.amount, note: p.note, time: p.created_at })) };
}



async function executeKidsBillQuery(entities: any) {
  return { message: 'Kids bill query - not fully implemented yet' };
}

async function executeKidsCouponQuery(entities: any) {
  return { message: 'Kids coupon query - not fully implemented yet' };
}






export default router;
