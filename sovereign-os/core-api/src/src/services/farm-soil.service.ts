// src/services/farm-soil.service.ts
//
// วิเคราะห์ดินแปลงฟาร์ม — NPK / pH / ความชื้น เทียบกับความต้องการของพืช
// บอกว่าพืชขาดอะไร + วิธีบำรุงดินให้เหมาะ (เช่น จะปลูกทุเรียนในดินจน ๆ ต้องปรับยังไง)

export interface SoilReadingInput {
  n?: number | null; // ไนโตรเจน (ppm หรือระดับ 0-100)
  p?: number | null; // ฟอสฟอรัส
  k?: number | null; // โพแทสเซียม
  ph?: number | null;
  moisture_pct?: number | null; // ความชื้น %
  ec?: number | null; // ค่าการนำไฟฟ้า (dS/m) — เกลือในดิน
}

interface Range {
  min: number;
  max: number;
}

type RangeLike = Range | [number, number];

function rng(r: RangeLike): Range {
  return Array.isArray(r) ? { min: r[0], max: r[1] } : r;
}

interface CropIdeal {
  ph: RangeLike;
  moisture: RangeLike; // %
  n: RangeLike;
  p: RangeLike;
  k: RangeLike;
  ec?: RangeLike; // dS/m
  soilNote: string;
}

// ตารางความต้องการของพืช (ค่าโดยประมาณจากความรู้เกษตรไทย)
export const CROP_IDEALS: Record<string, CropIdeal> = {
  ทุเรียน: {
    ph: [5.5, 6.5], moisture: [60, 80], n: [40, 70], p: [30, 60], k: [40, 80], ec: [0.5, 1.5],
    soilNote: 'ทุเรียนต้องการดินร่วนซุย ระบายน้ำดี อินทรียวัตถุสูง ระบบรากไวต่อน้ำขัง',
  },
  มะเขือเทศ: {
    ph: [6.0, 6.8], moisture: [60, 75], n: [40, 60], p: [30, 50], k: [50, 80], ec: [1.0, 2.5],
    soilNote: 'มะเขือเทศชอบดินร่วน pH ใกล้กลาง ต้องการโพแทสเซียมสูงช่วงออกดอก',
  },
  ข้าว: {
    ph: [5.0, 6.5], moisture: [80, 100], n: [50, 80], p: [20, 40], k: [30, 60], ec: [0.3, 1.0],
    soilNote: 'ข้าวชอบดินแฉะ/ขังน้ำช่วงกล้า ต้องการไนโตรเจนสูง',
  },
  ผักสลัด: {
    ph: [6.0, 7.0], moisture: [70, 85], n: [50, 80], p: [40, 70], k: [50, 90], ec: [1.0, 2.0],
    soilNote: 'ผักสลัดโตเร็ว ต้องการธาตุครบ + ความชื้นสม่ำเสมอ',
  },
  กล้วย: {
    ph: [5.5, 7.0], moisture: [60, 80], n: [40, 70], p: [25, 50], k: [60, 100], ec: [0.5, 1.5],
    soilNote: 'กล้วยกินโพแทสเซียมเยอะ ต้องการความชื้นสูงสม่ำเสมอ',
  },
  อ้อย: {
    ph: [5.5, 7.0], moisture: [50, 70], n: [40, 70], p: [25, 45], k: [50, 90], ec: [0.5, 2.0],
    soilNote: 'อ้อยทนแล้งได้ดี แต่ขาดโพแทสเซียมแล้วอ้อยผอม',
  },
  มะนาว: {
    ph: [5.5, 6.5], moisture: [55, 75], n: [40, 65], p: [30, 55], k: [40, 75], ec: [0.5, 1.8],
    soilNote: 'มะนาวไม่ชอบน้ำขัง ต้องการดินโปร่ง + แมกนีเซียม',
  },
  พริก: {
    ph: [5.5, 6.8], moisture: [60, 80], n: [45, 70], p: [35, 60], k: [45, 80], ec: [0.8, 2.2],
    soilNote: 'พริกต้องการฟอสฟอรัสช่วงออกดอก + ความชื้นสม่ำเสมอ',
  },
  // ── สมุนไพร S3 (10 ชนิด) ──
  ฟ้าทะลายโจร: { ph: [6.0, 7.0], moisture: [60, 75], n: [30, 50], p: [25, 45], k: [30, 50], ec: [0.5, 1.2], soilNote: 'ฟ้าทะลายโจรชอบดินร่วน ระบายน้ำดี ไม่แฉะ เก็บใบก่อนออกดอก' },
  ขมิ้นชัน: { ph: [6.0, 7.5], moisture: [65, 80], n: [35, 55], p: [25, 45], k: [40, 70], ec: [0.5, 1.5], soilNote: 'ขมิ้นชันชอบดินร่วนปนทราย มีอินทรียวัตถุสูง เก็บเหง้าอายุ 8-9 เดือน' },
  กระเจี๊ยบแดง: { ph: [5.5, 6.5], moisture: [55, 70], n: [30, 50], p: [20, 40], k: [35, 60], ec: [0.5, 1.2], soilNote: 'กระเจี๊ยบแดงทนแล้ง ดินโปร่ง เก็บกลีบเลี้ยง' },
  ขิง: { ph: [5.5, 6.5], moisture: [65, 80], n: [35, 60], p: [25, 45], k: [45, 75], ec: [0.5, 1.4], soilNote: 'ขิงชอบร่มรำไร ดินร่วนซุย ชื้นสม่ำเสมอ' },
  บัวบก: { ph: [6.0, 7.0], moisture: [70, 85], n: [30, 50], p: [20, 40], k: [30, 50], ec: [0.4, 1.0], soilNote: 'บัวบกชอบที่ชื้นแฉะ ริมน้ำ' },
  มะขามป้อม: { ph: [6.0, 7.5], moisture: [50, 70], n: [25, 45], p: [20, 35], k: [30, 55], ec: [0.5, 1.2], soilNote: 'มะขามป้อมเป็นไม้ยืนต้น ทนแล้ง' },
  ดอกคำฝอย: { ph: [6.0, 7.0], moisture: [50, 70], n: [30, 50], p: [25, 45], k: [35, 60], ec: [0.5, 1.5], soilNote: 'ดอกคำฝอยทนแล้ง ดินโปร่ง' },
  กระเพรา: { ph: [6.0, 7.0], moisture: [60, 75], n: [35, 55], p: [25, 40], k: [35, 60], ec: [0.5, 1.5], soilNote: 'กระเพราชอบแดด ดินร่วน' },
  ตะไคร้: { ph: [5.5, 6.5], moisture: [60, 75], n: [30, 50], p: [20, 40], k: [40, 70], ec: [0.5, 1.2], soilNote: 'ตะไคร้ชอบดินร่วน ระบายน้ำดี' },
  ว่านหางจระเข้: { ph: [6.0, 7.0], moisture: [40, 60], n: [20, 40], p: [15, 30], k: [25, 45], ec: [0.3, 1.0], soilNote: 'ว่านหางจระเข้ทนแล้งมาก ไม่ชอบน้ำขัง' },
};

export type SoilStatus = 'low' | 'ok' | 'high';

export function soilStatus(value: number | null | undefined, range: RangeLike): SoilStatus {
  if (value == null || !Number.isFinite(Number(value))) return 'ok';
  const v = Number(value);
  const r = rng(range);
  if (v < r.min) return 'low';
  if (v > r.max) return 'high';
  return 'ok';
}

export interface SoilFinding {
  kind: string; // n | p | k | ph | moisture | ec | structure
  severity: 'high' | 'medium' | 'info';
  status: SoilStatus | 'out';
  current: number | null;
  ideal: string;
  message: string;
  action: string;
}

export interface SoilAnalysis {
  crop: string;
  score: number; // 0-100
  findings: SoilFinding[];
  summary: string;
}

const FERTILIZER_HINTS: Record<string, string> = {
  n: 'ปุ๋ยไนโตรเจน เช่น ยูเรีย (46-0-0) หรือปุ๋ยคอกหมัก ใส่แบบโรยแล้วกลบ หลีกเลี่ยงช่วงดอก',
  p: 'ปุ๋ยฟอสฟอรัส เช่น หินฟอสเฟต (ใช้ได้นาน) หรือปุ๋ยสูตร 15-15-15 / 16-16-16 ใส่ก่อนปลูก',
  k: 'ปุ๋ยโพแทสเซียม เช่น โพแทสเซียมคลอไรด์ (0-0-60) หรือขี้เถ้าแกลบ ใส่ช่วงโต/ออกผล',
};

function severityOf(status: SoilStatus): 'high' | 'medium' {
  return status === 'low' ? 'high' : status === 'high' ? 'medium' : 'high';
}

/** วิเคราะห์ดินเทียบกับพืช — คืนรายการสิ่งที่ขาด/เกิน + วิธีแก้ */
export function analyzeSoil(reading: SoilReadingInput, crop: string): SoilAnalysis {
  const ideal = CROP_IDEALS[crop] ?? CROP_IDEALS['ผักสลัด'];
  const idealRng = { ph: rng(ideal.ph), moisture: rng(ideal.moisture), n: rng(ideal.n), p: rng(ideal.p), k: rng(ideal.k), ec: ideal.ec ? rng(ideal.ec) : null };
  const findings: SoilFinding[] = [];

  const checks: Array<{ kind: string; label: string; value: number | null | undefined; range: Range; unit: string; lowMsg: string; highMsg: string }> = [
    { kind: 'n', label: 'ไนโตรเจน (N)', value: reading.n, range: idealRng.n, unit: 'ppm', lowMsg: 'ใบเหลือง โตช้า', highMsg: 'ใบเขียวเข้มเกิน ดอก/ผลน้อย' },
    { kind: 'p', label: 'ฟอสฟอรัส (P)', value: reading.p, range: idealRng.p, unit: 'ppm', lowMsg: 'รากอ่อน ดอกน้อย ผลเล็ก', highMsg: 'ดูดซึมธาตุอื่นยาก' },
    { kind: 'k', label: 'โพแทสเซียม (K)', value: reading.k, range: idealRng.k, unit: 'ppm', lowMsg: 'ขอบใบไหม้ ลำต้นอ่อน', highMsg: 'ขัดขวางการดูด Ca/Mg' },
    { kind: 'moisture', label: 'ความชื้นดิน', value: reading.moisture_pct, range: idealRng.moisture, unit: '%', lowMsg: 'พืชขาดน้ำ เหี่ยวเฉา', highMsg: 'น้ำขัง รากเน่า' },
  ];
  for (const c of checks) {
    const status = soilStatus(c.value, c.range);
    if (status === 'ok') continue;
    const severity = c.kind === 'moisture' && status === 'low' ? 'high' : severityOf(status);
    const isLow = status === 'low';
    let action: string;
    if (c.kind === 'moisture') {
      action = isLow
        ? '💧 รดน้ำทันที (ให้ชุ่ม 2-3 วันติด) + ใช้วัสดุคลุมดิน (ฟาง/ใบไม้) ลดการระเหย — พิจารณาระบบน้ำหยด'
        : '🚱 ลดการให้น้ำ ระวังรากเน่า — ขุดร่องระบายน้ำรอบแปลง';
    } else if (c.kind === 'n' || c.kind === 'p' || c.kind === 'k') {
      action = isLow
        ? `ใส่${FERTILIZER_HINTS[c.kind]}`
        : `ลดการใช้ปุ๋ย${c.label}ลง — ตรวจสอบก่อนใส่เพิ่ม`;
    } else {
      action = '';
    }
    findings.push({
      kind: c.kind, severity, status, current: c.value ?? null,
      ideal: `${c.range.min}-${c.range.max} ${c.unit}`,
      message: `${c.label} ${isLow ? 'ต่ำ' : 'สูง'}เกินไป (${c.value ?? '—'}${c.unit} · ควร ${c.range.min}-${c.range.max}) — ${isLow ? c.lowMsg : c.highMsg}`,
      action,
    });
  }

  // pH
  const phStatus = soilStatus(reading.ph, idealRng.ph);
  if (phStatus !== 'ok') {
    const isLow = phStatus === 'low';
    findings.push({
      kind: 'ph', severity: severityOf(phStatus), status: phStatus,
      current: reading.ph ?? null, ideal: `${idealRng.ph.min}-${idealRng.ph.max}`,
      message: `pH ดิน ${isLow ? 'เป็นกรดเกินไป' : 'เป็นด่างเกินไป'} (${reading.ph ?? '—'} · ควร ${idealRng.ph.min}-${idealRng.ph.max})`,
      action: isLow
        ? '🧪 ใส่ปูนขาว (แคลเซียมคาร์บอเนต) หรือโดโลไมต์ ~200-400 กก./ไร่ แล้วไถกลบ รอ 2-4 สัปดาห์ก่อนปลูก'
        : '🧪 ใส่ปุ๋ยอินทรีย์/ปุ๋ยหมัก + กำมะถันผง (ปรับลด pH) หรือใช้ใบไม้/เข็มสนคลุมดิน',
    });
  }

  // EC (เกลือ) ถ้ามีค่า
  if (idealRng.ec && reading.ec != null) {
    const ecStatus = soilStatus(reading.ec, idealRng.ec);
    if (ecStatus === 'high') {
      findings.push({
        kind: 'ec', severity: 'medium', status: 'high', current: reading.ec,
        ideal: `${idealRng.ec!.min}-${idealRng.ec!.max} dS/m`,
        message: `เกลือในดินสูง (EC ${reading.ec} · ควร ≤ ${idealRng.ec!.max}) — รากดูดน้ำยาก`,
        action: '💦 ให้น้ำลึก ๆ ล้างเกลือ (leaching) หลายรอบ + งดปุ๋ยเคมีชั่วคราว ใช้ปุ๋ยอินทรีย์แทน',
      });
    }
  }

  // โครงสร้างดิน (จาก note พื้นฐานของพืช)
  if (reading.ph != null && reading.ph < idealRng.ph.min - 0.5 && reading.moisture_pct != null && reading.moisture_pct < idealRng.moisture.min) {
    findings.push({
      kind: 'structure', severity: 'medium', status: 'low', current: null, ideal: 'ดินร่วนซุย',
      message: 'ดินแน่น/แห้งกรัง — อินทรียวัตถุต่ำ',
      action: '🌾 ใส่ปุ๋ยหมัก/ปุ๋ยคอก 2-3 ตัน/ไร่ ไถพรวน ปลูกพืชคลุมดิน (ปอเทือง/ถั่ว) เพิ่มอินทรียวัตถุ',
    });
  }

  const score = Math.max(0, Math.min(100, 100 - findings.reduce((s, f) => s + (f.severity === 'high' ? 18 : 10), 0)));
  const summary =
    findings.length === 0
      ? `✅ ดินเหมาะสมกับการปลูก${crop}แล้ว — รักษาระดับความชื้นและธาตุอาหารต่อเนื่อง`
      : `${crop} ต้องการการดูแล: ${findings.filter((f) => f.severity === 'high').length} จุดเร่งด่วน, ${findings.filter((f) => f.severity === 'medium').length} จุดควรปรับ`;

  return { crop, score, findings, summary };
}

/** แผนบำรุงดินทีละขั้น (กรณีดินจน — อยากปลูกพืชที่ต้องการสารอาหารสูง) */
export function soilAmendmentPlan(reading: SoilReadingInput, crop: string): string[] {
  const ideal = CROP_IDEALS[crop] ?? CROP_IDEALS['ผักสลัด'];
  const idealRng = { ph: rng(ideal.ph), moisture: rng(ideal.moisture), n: rng(ideal.n), p: rng(ideal.p), k: rng(ideal.k) };
  const steps: string[] = [];
  steps.push(`🎯 เป้าหมาย: เตรียมดินให้เหมาะกับ ${crop} — ${ideal.soilNote}`);

  const ph = Number(reading.ph ?? 0);
  if (ph > 0 && (ph < idealRng.ph.min || ph > idealRng.ph.max)) {
    steps.push(ph < idealRng.ph.min
      ? `1) ปรับ pH จาก ${ph} → ${idealRng.ph.min}-${idealRng.ph.max}: ใส่ปูนขาว/โดโลไมต์ 200-400 กก./ไร่ ไถกลบ รอ 2-4 สัปดาห์`
      : `1) ปรับ pH จาก ${ph} → ${idealRng.ph.min}-${idealRng.ph.max}: ใส่ปุ๋ยหมัก + กำมะถัน ลดความเป็นด่าง`);
  } else {
    steps.push('1) ✅ pH อยู่ในช่วงที่พืชต้องการแล้ว');
  }

  const lowN = Number(reading.n ?? 99) < idealRng.n.min;
  const lowP = Number(reading.p ?? 99) < idealRng.p.min;
  const lowK = Number(reading.k ?? 99) < idealRng.k.min;
  if (lowN || lowP || lowK) {
    const missing = [lowN ? 'N' : '', lowP ? 'P' : '', lowK ? 'K' : ''].filter(Boolean).join('-');
    steps.push(`2) ธาตุหลักขาด (${missing || '—'}): ใส่ปุ๋ยรองพื้นสูตร ${lowP ? '16-16-16' : '15-15-15'} 30-50 กก./ไร่ + ปุ๋ยคอกหมัก 2-3 ตัน/ไร่ (แหล่งอินทรียวัตถุ + จุลินทรีย์)`);
  } else {
    steps.push('2) ✅ ธาตุหลัก (N-P-K) อยู่ในเกณฑ์ — ใส่ปุ๋ยคอกหมักบำรุงดินไว้ก่อน');
  }

  const moisture = Number(reading.moisture_pct ?? 100);
  if (moisture < idealRng.moisture.min) {
    steps.push(`3) ดินแห้ง (${moisture}% · ควร ${idealRng.moisture.min}-${idealRng.moisture.max}%): วางระบบน้ำหยด/สปริงเกลอร์ + คลุมดินด้วยฟาง 5-10 ซม. รดน้ำเช้า-เย็นช่วงแรก`);
  } else {
    steps.push('3) ✅ ความชื้นอยู่ในเกณฑ์ — เตรียมระบบระบายน้ำกันฝนทิ้งช่วง');
  }

  steps.push('4) ปลูกพืชคลุมดิน (ปอเทือง/ถั่วเขียว) ก่อนปลูกจริง 45-60 วัน แล้วไถกลบเป็นปุ๋ยพืชสด');
  steps.push('5) หลังปรับดินแล้ว ตรวจซ้ำ (NPK/pH/ความชื้น) ก่อนลงมือปลูก เพื่อยืนยันว่าพร้อมจริง');
  return steps;
}
