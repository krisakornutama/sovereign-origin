// src/services/farm-executive.service.ts
//
// ── ภาพรวมฟาร์มสำหรับผู้บริหาร + แจ้งเตือนความเสี่ยงเชิงพาดหัว ──────────────
// ทำไมต้องมี: โมดูลฟาร์ม/ปศุสัตว์มีข้อมูลครบแต่กระจายอยู่หลายหน้า เจ้าของฟาร์ม
// ต้องไล่ดูทีละหน้าเพื่อรู้ว่า "วันนี้ต้องตัดสินใจอะไร" — ไฟล์นี้รวมเป็นคำตอบเดียว
//
// หลักการ:
//   · pure function เท่านั้น (รับข้อมูลที่ route ดึงมาแล้ว) → เทสได้ทุกกฎโดยไม่ต้องมี DB
//   · ทุกความเสี่ยงต้องมี "สิ่งที่ต้องทำ" และลิงก์ไปหน้าที่แก้ได้จริง
//   · ไม่มีข้อมูล = บอกว่าไม่มีข้อมูล ไม่ใช่สร้างความเสี่ยงปลอม
export type RiskSeverity = 'critical' | 'warning' | 'info';

const DAY_MS = 86_400_000;

export interface ExecutiveRisk {
  id: string;
  severity: RiskSeverity;
  title: string;
  detail: string;
  action: string;
  link: string;
}

export interface FarmExecutiveInput {
  now?: Date;
  plots: Array<{
    id: string;
    name: string;
    crop: string | null;
    status: string;
    expectedHarvestAt: Date | null;
  }>;
  groups: Array<{
    id: string;
    code: string;
    species: string;
    quantity: number;
    status: string;
    ageDays: number;
    quarantineEndAt: Date | null;
    medical: Array<{ drugName: string; safeHarvestAt: Date }>;
    vaccines: Array<{ vaccineName: string; targetAgeDays: number; completed: boolean }>;
    mortality7d: number;
  }>;
  silos: Array<{ siloCode: string; capacityKg: number; currentKg: number }>;
  climate: { thi: number; status: string } | null;
}

export interface FarmExecutiveResult {
  generatedAt: string;
  kpis: {
    plots: number;
    growing: number;
    upcomingHarvests7d: number;
    overdueHarvests: number;
    animals: number;
    groups: number;
    quarantineGroups: number;
    animalsInWithdrawal: number;
    vaccineOverdue: number;
    silosLow: number;
    latestThi: number | null;
    thiStatus: string | null;
    mortality7d: number;
    criticalRisks: number;
  };
  risks: ExecutiveRisk[];
}

const SEVERITY_ORDER: Record<RiskSeverity, number> = { critical: 0, warning: 1, info: 2 };

const fmtDate = (d: Date | null): string =>
  d ? d.toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' }) : 'ไม่ระบุ';

const daysUntil = (target: Date, now: Date): number => Math.ceil((target.getTime() - now.getTime()) / DAY_MS);

export function buildFarmExecutive(input: FarmExecutiveInput): FarmExecutiveResult {
  const now = input.now ?? new Date();
  const risks: ExecutiveRisk[] = [];

  const activePlots = input.plots.filter((p) => p.status !== 'harvested');
  const upcoming = activePlots.filter((p) => {
    if (!p.expectedHarvestAt) return false;
    const d = daysUntil(p.expectedHarvestAt, now);
    return d >= 0 && d <= 7;
  });
  const overdue = activePlots.filter((p) => p.expectedHarvestAt && p.expectedHarvestAt.getTime() < now.getTime());

  for (const plot of overdue) {
    risks.push({
      id: `plot-overdue-${plot.id}`,
      severity: 'critical',
      title: `แปลง ${plot.name} เลยกำหนดเก็บเกี่ยว`,
      detail: `${plot.crop ?? 'ไม่ระบุพืช'} · กำหนดไว้ ${fmtDate(plot.expectedHarvestAt)}`,
      action: 'ตรวจแปลงแล้วบันทึกเก็บเกี่ยวหรือเปลี่ยนเป็นพักแปลง',
      link: '/farm',
    });
  }
  for (const plot of upcoming) {
    const days = daysUntil(plot.expectedHarvestAt!, now);
    risks.push({
      id: `plot-soon-${plot.id}`,
      severity: 'info',
      title: `อีก ${days} วันถึงเก็บเกี่ยว: ${plot.name}`,
      detail: `${plot.crop ?? 'ไม่ระบุพืช'} · ${fmtDate(plot.expectedHarvestAt)}`,
      action: 'เตรียมแรงงาน/บรรจุภัณฑ์และตรวจราคารับซื้อ',
      link: '/farm',
    });
  }

  let animals = 0;
  let quarantineGroups = 0;
  let animalsInWithdrawal = 0;
  let vaccineOverdue = 0;
  let mortality7d = 0;

  for (const group of input.groups) {
    if (group.status === 'HARVESTED') continue;
    animals += group.quantity;
    mortality7d += group.mortality7d;

    if (group.status === 'QUARANTINE') {
      quarantineGroups++;
      risks.push({
        id: `quarantine-${group.id}`,
        severity: 'warning',
        title: `เล้า ${group.code} อยู่ระหว่างกักกัน`,
        detail: `ปลดล็อก ${fmtDate(group.quarantineEndAt)} · สัตว์ ${group.quantity} ตัว`,
        action: 'ห้ามย้ายสัตว์ออกจนครบกำหนด และบันทึกอาการรายวัน',
        link: '/livestock',
      });
    }

    const locked = group.medical.filter((m) => m.safeHarvestAt.getTime() > now.getTime());
    if (locked.length > 0) {
      const latest = locked.reduce((a, b) => (a.safeHarvestAt > b.safeHarvestAt ? a : b));
      animalsInWithdrawal += group.quantity;
      risks.push({
        id: `withdrawal-${group.id}`,
        severity: 'critical',
        title: `เล้า ${group.code} ยังติดระยะหยุดยา`,
        detail: `${locked.length} รายการ · ล่าสุด ${latest.drugName} ห้ามขายถึง ${fmtDate(latest.safeHarvestAt)}`,
        action: 'ห้ามจับขาย/แปรรูปจนพ้นวันที่กำหนด (ผิดกฎหมายและตรวจพบสารตกค้าง)',
        link: '/livestock',
      });
    }

    const overdueVaccines = group.vaccines.filter((v) => !v.completed && group.ageDays > v.targetAgeDays);
    if (overdueVaccines.length > 0) {
      vaccineOverdue += overdueVaccines.length;
      risks.push({
        id: `vaccine-${group.id}`,
        severity: 'critical',
        title: `วัคซีนเกินกำหนด ${overdueVaccines.length} รายการ — ${group.code}`,
        detail: overdueVaccines.map((v) => `${v.vaccineName} (เป้าหมาย ${v.targetAgeDays} วัน)`).join(' · '),
        action: 'ฉีดวัคซีนและบันทึกผล พร้อมตรวจสต็อกวัคซีนคงเหลือ',
        link: '/livestock',
      });
    } else {
      const dueSoon = group.vaccines.filter((v) => {
        if (v.completed) return false;
        const left = v.targetAgeDays - group.ageDays;
        return left >= 0 && left <= 3;
      });
      for (const v of dueSoon) {
        risks.push({
          id: `vaccine-soon-${group.id}-${v.vaccineName}`,
          severity: 'warning',
          title: `วัคซีน ${v.vaccineName} ใกล้ถึงกำหนด — ${group.code}`,
          detail: `อีก ${v.targetAgeDays - group.ageDays} วัน (อายุเป้าหมาย ${v.targetAgeDays} วัน)`,
          action: 'เตรียมวัคซีนและนัดหมายเจ้าหน้าที่',
          link: '/livestock',
        });
      }
    }

    if (group.quantity > 0) {
      const rate = group.mortality7d / group.quantity;
      if (rate > 0.02) {
        risks.push({
          id: `mortality-${group.id}`,
          severity: 'critical',
          title: `อัตราตายพุ่ง ${(rate * 100).toFixed(1)}% ใน 7 วัน — ${group.code}`,
          detail: `ตาย ${group.mortality7d} จาก ${group.quantity} ตัว`,
          action: 'แยกซากส่งตรวจ ตรวจน้ำ/อาหาร และแจ้งสัตวแพทย์ประจำฟาร์ม',
          link: '/livestock',
        });
      } else if (rate > 0.01) {
        risks.push({
          id: `mortality-watch-${group.id}`,
          severity: 'warning',
          title: `อัตราตายสูงกว่าปกติ ${(rate * 100).toFixed(1)}% — ${group.code}`,
          detail: `ตาย ${group.mortality7d} จาก ${group.quantity} ตัวใน 7 วัน`,
          action: 'เฝ้าดู 2-3 วันและตรวจคุณภาพน้ำดื่ม',
          link: '/livestock',
        });
      }
    }
  }

  let silosLow = 0;
  for (const silo of input.silos) {
    if (silo.capacityKg <= 0) continue;
    const ratio = silo.currentKg / silo.capacityKg;
    if (ratio < 0.15) {
      silosLow++;
      risks.push({
        id: `silo-${silo.siloCode}`,
        severity: 'critical',
        title: `ไซโล ${silo.siloCode} ใกล้หมด`,
        detail: `เหลือ ${silo.currentKg.toFixed(0)} / ${silo.capacityKg.toFixed(0)} กก. (${(ratio * 100).toFixed(0)}%)`,
        action: 'สั่งอาหารเพิ่มก่อนหมด เพื่อไม่ให้ต้องเปลี่ยนสูตรกะทันหัน',
        link: '/livestock',
      });
    } else if (ratio < 0.3) {
      risks.push({
        id: `silo-watch-${silo.siloCode}`,
        severity: 'warning',
        title: `ไซโล ${silo.siloCode} เหลือน้อยกว่า 30%`,
        detail: `เหลือ ${silo.currentKg.toFixed(0)} / ${silo.capacityKg.toFixed(0)} กก.`,
        action: 'วางแผนเติมอาหารในสัปดาห์นี้',
        link: '/livestock',
      });
    }
  }

  if (input.climate && Number.isFinite(input.climate.thi)) {
    if (input.climate.thi >= 78) {
      risks.push({
        id: 'climate-thi-critical',
        severity: 'critical',
        title: `ความเครียดจากความร้อนรุนแรง (THI ${input.climate.thi.toFixed(1)})`,
        detail: 'สัตว์อาจกินอาหารลดลงและตายได้ โดยเฉพาะช่วงบ่าย',
        action: 'เปิดพ่นหมอก/เพิ่มการระบายอากาศ และเลื่อนให้อาหารไปช่วงเย็น',
        link: '/livestock',
      });
    } else if (input.climate.thi >= 72) {
      risks.push({
        id: 'climate-thi-warning',
        severity: 'warning',
        title: `ความเครียดจากความร้อนเริ่มสูง (THI ${input.climate.thi.toFixed(1)})`,
        detail: 'ควรเพิ่มน้ำและลดความหนาแน่นในเล้า',
        action: 'ตรวจน้ำดื่มและเปิดระบายอากาศเพิ่ม',
        link: '/livestock',
      });
    }
  }

  risks.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  return {
    generatedAt: now.toISOString(),
    kpis: {
      plots: input.plots.length,
      growing: activePlots.length,
      upcomingHarvests7d: upcoming.length,
      overdueHarvests: overdue.length,
      animals,
      groups: input.groups.filter((g) => g.status !== 'HARVESTED').length,
      quarantineGroups,
      animalsInWithdrawal,
      vaccineOverdue,
      silosLow,
      latestThi: input.climate?.thi ?? null,
      thiStatus: input.climate?.status ?? null,
      mortality7d,
      criticalRisks: risks.filter((r) => r.severity === 'critical').length,
    },
    risks,
  };
}
