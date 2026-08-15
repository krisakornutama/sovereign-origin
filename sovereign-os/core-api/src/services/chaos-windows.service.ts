import { PrismaClient } from '@prisma/client';
import { config } from '../config';

const prisma = new PrismaClient();

// ── Chaos Windows Engine (ภัย 1 + 3 — "Embrace Natural Chaos") ──
// ระบบนี้เกิดมาเพื่อคุมสภาพแวดล้อมให้ "นิ่งปลอดภัย" — แต่ธรรมชาติของมนุษย์ต้องการความ
// ผันผวน (Hygiene Hypothesis + Circadian Rhythm):
//   ภัย 1: ร่างกายต้องปะทะ Microbial Diversity → ช่องเปิดรับอากาศธรรมชาติทุกวัน
//   ภัย 3: นาฬิกาชีวิตผูกกับแสงจริง/อุณหภูมิจริง → รายงานจังหวะธรรมชาติ (sunrise/sunset,
//          ช่วง dim, คราบอุณหภูมิ) อย่างที่ธรรมชาติเป็น
// ส่งเป็น ADVISORY (มนุษย์คือ actuator) — ไม่เพิ่ม actuator ใหม่เพื่อ "ควบคุมช่องว่าง"

export interface DayPlan {
  date: string; // YYYY-MM-DD
  daylight: { sunrise: string; sunset: string; dayLengthMin: number };
  exposure: {
    recommendedMin: number;
    achievedMinToday: number;
    achievedMin7dAvg: number;
    status: 'excellent' | 'ok' | 'low' | 'none';
  };
  temperature: {
    naturalIdealMinC: number;
    naturalIdealMaxC: number;
    driftC: number;
    note: string;
  };
  light: { dimStart: string; blueCutoff: string; note: string };
  warnings: string[];
}

// ── สูตรคำนวณพระอาทิตย์ขึ้น/ตก (NOAA แบบย่อ — แม่น ±10 นาที พอใช้งานที่บ้าน) ──
function solarTimes(date: Date, lat: number, lon: number): { sunrise: Date; sunset: Date; dayLengthMin: number } {
  const doy = Math.floor((date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86400000);
  const rad = Math.PI / 180;
  const decl = -23.44 * Math.cos(rad * (360 / 365) * (doy + 10));
  const latRad = lat * rad;
  const hourAngle = Math.acos(Math.max(-1, Math.min(1, -Math.tan(latRad) * Math.tan(decl * rad))));
  const dayLength = (2 * hourAngle) / rad / 15; // ชั่วโมง
  // Solar noon ใน UTC = 12 - lon/15 (lon ตะวันออกเป็น +) → ชั่วโมงทั้งหมดเป็น UTC
  const noonUtc = 12 - lon / 15;
  const sunriseHour = noonUtc - dayLength / 2;
  const sunsetHour = noonUtc + dayLength / 2;
  // สร้างเป็น timestamp UTC แล้วให้ toLocaleTimeString แปลงเป็นเวลาท้องถิ่นเอง
  const mk = (h: number) =>
    new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), Math.floor(h), Math.round((h % 1) * 60), 0));
  return { sunrise: mk(sunriseHour), sunset: mk(sunsetHour), dayLengthMin: Math.round(dayLength * 60) };
}

const fmtTime = (d: Date) => {
  const shifted = new Date(d.getTime() + config.lifestyle.utcOffsetMin * 60000);
  return shifted.toISOString().slice(11, 16); // "HH:MM" ตามโซนบ้าน (container รัน UTC)
};

// ── นับนาทีที่ประตู/หน้าต่างเปิดวันนี้ จาก sensor_telemetry (door_state = 1) ──
export async function exposureMinutes(days = 1): Promise<{ todayMin: number; avg7dMin: number }> {
  let todayMin = 0;
  let avg7dMin = 0;
  try {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const rows: { open_min: bigint }[] = await prisma.$queryRaw`
      SELECT COUNT(*)::bigint AS open_min
      FROM (
        SELECT time_bucket('1 minute', time) AS bucket
        FROM sensor_telemetry
        WHERE metric = 'door_state' AND value = 1 AND time >= ${since}
        GROUP BY bucket
      ) t`;
    todayMin = Number(rows[0]?.open_min ?? 0);

    const weekAgo = new Date(Date.now() - 6 * 86400000);
    weekAgo.setHours(0, 0, 0, 0);
    const week: { d: Date; open_min: bigint }[] = await prisma.$queryRaw`
      SELECT date_trunc('day', bucket) AS d, COUNT(*)::bigint AS open_min
      FROM (
        SELECT time_bucket('1 minute', time) AS bucket
        FROM sensor_telemetry
        WHERE metric = 'door_state' AND value = 1 AND time >= ${weekAgo}
        GROUP BY bucket
      ) t
      GROUP BY d`;
    if (week.length) {
      avg7dMin = Math.round(week.reduce((a, r) => a + Number(r.open_min), 0) / 7);
    }
  } catch {
    // DB ไม่พร้อม (test) → ถือว่าไม่มีข้อมูล
  }
  return { todayMin, avg7dMin };
}

// ── อุณหภูมิจริงในบ้านล่าสุด (ใช้บอกว่าธรรมชาติภายในวันนี้ควรเป็นเท่าไหร่) ──
async function latestTemperatureC(): Promise<number | null> {
  try {
    const row: { value: number }[] = await prisma.$queryRaw`
      SELECT value FROM sensor_telemetry
      WHERE metric = 'temperature'
      ORDER BY time DESC LIMIT 1`;
    return row[0]?.value ?? null;
  } catch {
    return null;
  }
}

export async function getDayPlan(): Promise<DayPlan> {
  const now = new Date();
  const s = solarTimes(now, config.lifestyle.latitude, config.lifestyle.longitude);
  const exposure = await exposureMinutes();
  const curTemp = await latestTemperatureC();
  const l = config.lifestyle;

  const status: DayPlan['exposure']['status'] =
    exposure.todayMin >= l.targetExposureMin ? 'excellent' :
    exposure.todayMin >= l.minExposureMin ? 'ok' :
    exposure.todayMin > 0 ? 'low' : 'none';

  const warnings: string[] = [];
  if (status === 'none') {
    warnings.push(`วันนี้ยังไม่เปิดรับอากาศธรรมชาติเลย — เป้าหมาย ${l.targetExposureMin} นาที/วัน (ภูมิคุ้มกันต้องการปะทะจุลินทรีย์ในธรรมชาติ: Hygiene Hypothesis)`);
  } else if (status === 'low') {
    warnings.push(`เปิดรับอากาศแค่ ${exposure.todayMin} นาที (เป้า ${l.targetExposureMin}) — เหมาะเปิดหน้าต่างช่วงเช้าอีกสักครั้ง`);
  }
  if (exposure.avg7dMin > 0 && exposure.avg7dMin < l.minExposureMin) {
    warnings.push(`เฉลี่ย 7 วันแค่ ${exposure.avg7dMin} นาที/วัน — ร่างกายกำลังพลาดการฝึกภูมิคุ้มกันจากโลกจริง`);
  }
  if (now.getHours() >= 20 && exposure.todayMin < l.minExposureMin) {
    warnings.push('ดึกแล้ว — ถ้าพรุ่งนี้เปิดหน้าต่างเช้า 08:00 หลังเปิดประตูเสร็จ 30 นาทีจะพอดี');
  }
  warnings.push(
    `แสงเช้าวันนี้เริ่ม ${fmtTime(s.sunrise)} — แนะนำให้เปิดม่าน/รับแสงจริงช่วงเช้า (blue light ตอนเช้าปรับ Melatonin ให้กลางคืนหลับลึก: Circadian)`
  );

  const driftC = l.tempDriftC;
  const naturalLow = curTemp != null ? Math.round((curTemp - driftC) * 10) / 10 : null;
  const naturalHigh = curTemp != null ? Math.round((curTemp + driftC) * 10) / 10 : null;

  const dimStart = new Date(s.sunset.getTime() - 45 * 60000);
  const blueCutoff = s.sunset;

  return {
    date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
    daylight: {
      sunrise: fmtTime(s.sunrise),
      sunset: fmtTime(s.sunset),
      dayLengthMin: s.dayLengthMin,
    },
    exposure: {
      recommendedMin: l.targetExposureMin,
      achievedMinToday: exposure.todayMin,
      achievedMin7dAvg: exposure.avg7dMin,
      status,
    },
    temperature: {
      naturalIdealMinC: naturalLow ?? 24,
      naturalIdealMaxC: naturalHigh ?? 26,
      driftC,
      note: naturalLow != null
        ? `บ้านควรอยู่ระหว่าง ${naturalLow}–${naturalHigh}°C (ปล่อยให้ไหลตามธรรมชาติ ±${driftC}°C รอบอุณหภูมิจริง) — ห้าม "ปรับให้ราบรื่นนิ่ง" เพราะ Circadian ต้องการการเปลี่ยนแปลง`
        : `ปล่อยให้อุณหภูมิไหลตามธรรมชาติ ±${driftC}°C — ห้าม "ปรับให้ราบรื่นนิ่ง" เพราะ Circadian ต้องการการเปลี่ยนแปลง`,
    },
    light: {
      dimStart: fmtTime(dimStart),
      blueCutoff: fmtTime(blueCutoff),
      note: 'เริ่มหรี่แสง 45 นาทีก่อนตะวันตก ตัดแสงสีฟ้าหลังมืด — ไม่ใช่ "ปรับแสงเพื่อประสิทธิภาพ" แต่เป็นจังหวะที่โลกเป็น',
    },
    warnings,
  };
}