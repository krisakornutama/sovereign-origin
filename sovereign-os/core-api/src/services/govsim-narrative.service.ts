// ── GovSim Narrative Engine — LLM สร้างข่าวจำลอง/จดหมายขู่/บทวิเคราะห์ ──
// ผ่าน Ollama (local) — ถ้า Offline ใช้ fallback แบบ deterministic จากตัวเลขสถานะ
// (ไม่ปลอมข้อมูล ไม่ตาย — แสดง source ให้ UI ทราบว่า LLM หรือ template)

import axios from 'axios';
import { govsimSnapshot } from './governance-sim.service';
import { getModelForTask } from './ai-router.service';

export const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
export const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || '2m';
const MODEL = process.env.GOVSIM_MODEL || process.env.RISK_MODEL || process.env.OLLAMA_MODEL || 'gemma3:4b';

export interface NarrativeResult {
  kind: string;
  title: string;
  text: string;
  source: 'ollama' | 'template';
}

function snapshotText(id: string): string {
  const s = govsimSnapshot(id);
  if (!s) return '';
  return [
    `ปี ${s.year} เดือน ${s.month} (tick ${s.tick})`,
    `สถานะ: ${s.status} | Legitimacy ${Math.round(s.legitimacy.total)} | Asabiyyah ${Math.round(s.asabiyyah)}`,
    `Unrest ${Math.round(s.unrestRisk)} | Gini ${Math.round(s.gini)} | Scarcity ${Math.round(s.scarcity)}`,
    `Friction ${Math.round(s.friction)} | Resistance ${Math.round(s.resistance)} | Pacification ${Math.round(s.pacification)} | Collaborator ${Math.round(s.collaboratorRatio * 100)}%`,
    `Insurgency ${Math.round(s.insurgencyStrength * 100)}% | RebellionProb ${Math.round(s.rebellionProbability * 100)}%`,
    `Treasury ${Math.round(s.treasury)} | GDP ${Math.round(s.gdpIndex)} | Inflation ${Math.round(s.inflation)}`,
    `MediaControl ${Math.round(s.mediaControl)} | PropagandaGap ${Math.round(s.propagandaGap)} | CounterNarrative ${Math.round(s.counterNarrative)}`,
    `ForeignProxy ${Math.round(s.foreignProxy)} | Sanctions ${Math.round(s.sanctions)} | Sanctuary ${Math.round(s.sanctuary)} | ExternalThreat ${Math.round(s.externalThreat)}`,
    `SuppressionRecord ${Math.round(s.suppressionRecord)} | Coercion ${s.levers.coercion}`,
    `Factions: ${s.factions.map((f) => `${f.label}: sat ${f.satisfaction} rad ${f.radicalization}`).join(' | ')}`,
    `Territories: ${s.territories.map((t) => `${t.label}: tension ${t.tension}`).join(' | ')}`,
  ].join('\n');
}

function templateNarrative(id: string, kind: string): NarrativeResult | null {
  const s = govsimSnapshot(id);
  if (!s) return null;
  const statusLabel: Record<string, string> = {
    stable: 'สงบเรียบร้อย', unstable: 'ตึงเครียด', civil_war: 'เกิดสงครามกลางเมือง', collapsed: 'ล่มสลาย', integrated: 'กลืนกลายเป็นหนึ่งเดียว',
  };
  const econWord = s.scarcity > 60 ? 'ราคาสินค้าพุ่ง ประชาชนเดือดร้อนหนัก' : s.scarcity > 40 ? 'สินค้าบางรายการขาดตลาด' : 'ตลาดยังประคองตัวอยู่ได้';
  if (kind === 'newspaper') {
    const headline =
      s.status === 'civil_war' ? `กลุ่มกบฏประกาศยึด ${s.territories.find((t) => t.tension >= 60)?.label || 'พื้นที่ชายแดน'}!` :
      s.status === 'collapsed' ? `รัฐล่ม — อนาธิปไตยครอบคลุมทั้งประเทศ` :
      s.status === 'integrated' ? `ชัยชนะของการปรองดอง — เมืองยึดครองเข้าสู่การปกครองร่วม` :
      s.unrestRisk > 55 ? `ม็อบนับหมื่นรวมตัวหน้าทำเนียบ — รัฐออกคำสั่ง ${['', 'เฝ้าระวัง', 'ตรึงกำลังตำรวจ', 'ประกาศเคอร์ฟิว', 'กวาดล้าง'][s.levers.coercion]}` :
      `รัฐแถลง GDP โต — แต่ ${econWord}`;
    return {
      kind,
      title: headline,
      text: `📰 หนังสือพิมพ์ราชอาณาจักร (ฉบับจำลอง)\n\n${headline}\n\nรายงานข่าว: สถานการณ์โดยรวมอยู่ในระดับ "${statusLabel[s.status]}" — ดัชนีความชอบธรรมของรัฐ ${Math.round(s.legitimacy.total)}/100 ดัชนีความยึดโยง Asabiyyah ${Math.round(s.asabiyyah)}/100 ความไม่สงบ ${Math.round(s.unrestRisk)}/100 ความเหลื่อมล้ำ Gini ${Math.round(s.gini)} และ ${econWord} ฝ่ายปกครองยืนยันว่าการควบคุมสถานการณ์เป็นไปตามแผน และความร่วมมือของผู้นำท้องถิ่น (${Math.round(s.collaboratorRatio * 100)}%) ช่วยลดแรงเสียดทานในพื้นที่ยึดครอง`,
      source: 'template',
    };
  }
  if (kind === 'threat_letter') {
    const org = s.insurgencyStrength > 0.2 ? 'กองทัพปลดปล่อยประชาชน' : 'คณะกรรมการต่อต้านรัฐ';
    return {
      kind,
      title: `จดหมายขู่จาก ${org}`,
      text: `✉️ จดหมายขู่ (จำลอง)\n\nถึง "ผู้ครองเมือง"\n\nจาก ${org}\n\nพวกเราจะไม่มีวันยอมจำนนต่อการปกครองที่บีบคั้นประชาชนเช่นนี้ เรามีแนวร่วม ${Math.round(s.insurgencyStrength * 100)}% ของประชากร และได้รับการสนับสนุนจากภายนอก (Proxy ${Math.round(s.foreignProxy)}) ดินแดนของพวกเราทุกตารางนิ้วต้องกลับคืน หากรัฐยังไม่หยุดการปราบปราม (บันทึกปราบปราม ${Math.round(s.suppressionRecord)}) ภายใน 30 วัน พวกเราจะยกระดับการต่อสู้สู่ทุกเมือง\n\n— ความต้านทานของเรา ${Math.round(s.resistance)}/100 และยังเพิ่มขึ้นทุกวัน`,
      source: 'template',
    };
  }
  if (kind === 'analysis') {
    const advice =
      s.legitimacy.total < 35 ? 'รัฐต้องฟื้นฟูความชอบธรรมทันที — เปิดพื้นที่ร่วม (Power Sharing) และลดการใช้กำลัง' :
      s.friction > 50 ? 'เมืองยึดครองยังมีแรงเสียดทานสูง — เพิ่มบริการขั้นพื้นฐาน/สวัสดิการ (กฎเหล็ก: ความต้านทานลดด้วยคุณภาพชีวิต ไม่ใช่ทหาร) + ใช้กลยุทธ์ Indirect/Economic' :
      s.gini > 60 ? 'ความเหลื่อมล้ำกัดเซาะ Asabiyyah — อุดหนุนราคาอาหาร เพิ่ม Welfare ลดภาษีคนจน' :
      s.counterNarrative > 55 ? 'Epistemic Collapse ใกล้มา — ลดช่องว่างโฆษณาชวนเชื่อ เพิ่มความโปร่งใส' :
      'สถานการณ์ทรงตัว — รักษานโยบายปัจจุบัน ระวัง Second-Order Effect ของการซื้อใจผู้นำท้องถิ่น';
    return {
      kind,
      title: 'บทวิเคราะห์เชิงยุทธศาสตร์',
      text: `🔬 บทวิเคราะห์เชิงยุทธศาสตร์ (จำลอง)\n\nสถานะ: "${statusLabel[s.status]}"\n\n1. ความชอบธรรม (Legitimacy ${Math.round(s.legitimacy.total)}) — Performance ${Math.round(s.legitimacy.performance)} / Ideology ${Math.round(s.legitimacy.ideology)} / Procedural ${Math.round(s.legitimacy.procedural)}\n2. ความยึดโยง (Asabiyyah ${Math.round(s.asabiyyah)}) — ถูกกัดเซาะโดย Gini ${Math.round(s.gini)} และถูกหลอมรวมโดยภัยคุกคามภายนอก ${Math.round(s.externalThreat)}\n3. ความเสี่ยงปฏิวัติ: ${Math.round(s.rebellionProbability * 100)}% | กบฏในพื้นที่: ${Math.round(s.insurgencyStrength * 100)}%\n4. การกลืนกลาย: Friction ${Math.round(s.friction)} / Resistance ${Math.round(s.resistance)} / Pacification ${Math.round(s.pacification)}\n\nข้อเสนอแนะ: ${advice}`,
      source: 'template',
    };
  }
  return null;
}

export async function generateNarrative(id: string, kind: string): Promise<NarrativeResult> {
  const snapshot = snapshotText(id);
  const fallback = templateNarrative(id, kind);
  if (!snapshot || !fallback) return { kind, title: 'ไม่มีสถานการณ์', text: 'Scenario ไม่พบ', source: 'template' };
  const kindLabel: Record<string, string> = {
    newspaper: 'หนังสือพิมพ์ราชอาณาจักรฉบับจำลอง',
    threat_letter: 'จดหมายขู่จากกลุ่มกบฏ',
    analysis: 'บทวิเคราะห์เชิงยุทธศาสตร์',
  };
  const prompt = `คุณคือนักข่าว/นักวิเคราะห์ในระบบจำลองการปกครอง (Sovereign GovSim)\nจงเขียน "${kindLabel[kind] || kind}" ภาษาไทย ความยาว 3-6 ประโยค อ้างอิงตัวเลขจากสถานะนี้เท่านั้น ห้ามเพิ่มข้อเท็จจริงใหม่:\n\n${snapshot}\n\nตอบเป็นข้อความภาษาไทยล้วน เริ่มต้นด้วยชื่อเรื่องหนึ่งบรรทัด ตามด้วยเนื้อหา`;
  try {
    const resp = await axios.post(
      `${OLLAMA_URL}/api/generate`,
      { model: await getModelForTask('REASONING_GOVERNOR', MODEL), prompt, stream: false, options: { temperature: 0.8, num_predict: 512 }, keep_alive: OLLAMA_KEEP_ALIVE },
      { timeout: 60000 }
    );
    const raw: string = resp.data?.response?.trim() || '';
    if (raw.length < 10) return fallback;
    const [title, ...rest] = raw.split('\n').filter((l) => l.trim());
    return { kind, title: (title || fallback.title).slice(0, 120), text: [title, ...rest].join('\n').slice(0, 2000), source: 'ollama' };
  } catch {
    return fallback;
  }
}