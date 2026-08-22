import { prisma } from '../lib/prisma';
import { EventEmitter } from 'events';
import { livingMode } from './living-mode.service';

export { prisma };
export const automationEmitter = new EventEmitter();

// Anti-Goodhart Shield (ภัย 2): metrics ที่เป็น "ร่องรอยการมีชีวิต" — ระบบห้ามลงโทษ/เตือนรบกวน
// (ควันจากการทำอาหาร, ค่าไฟ, เสียง ฯลฯ) เมื่อ Living Mode เปิดอยู่
export const LIFESTYLE_METRICS = new Set<string>([
  'power_kw', 'energy_kwh', 'smoke', 'sound_level', 'co2_level', 'pm25',
  'light_intensity', 'temperature', 'humidity',
]);

export interface Rule {
  id: string;
  metric: string;
  condition: 'gt' | 'lt' | 'eq';
  threshold: number;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  enabled: boolean;
  is_default: boolean;
}

// กฎสำเร็จรูป — seed เข้า DB ครั้งแรก (is_default = true ไม่ให้ลบได้)
const DEFAULT_RULES: Omit<Rule, 'id' | 'is_default'>[] = [
  {
    metric: 'battery_soc',
    condition: 'lt',
    threshold: 20,
    message: '🔋 แบตเตอรี่ต่ำกว่า 20%! กรุณาชาร์จหรือลดการใช้พลังงาน',
    severity: 'critical',
    enabled: true,
  },
  {
    metric: 'rain_detect',
    condition: 'eq',
    threshold: 1,
    message: '🌧️ ตรวจพบฝนตก! ปิดหน้าต่างและตรวจสอบอุปกรณ์ภายนอก',
    severity: 'warning',
    enabled: true,
  },
  {
    metric: 'temperature',
    condition: 'gt',
    threshold: 45,
    message: '🌡️ อุณหภูมิสูงเกิน 45°C! ตรวจสอบระบบระบายความร้อน',
    severity: 'warning',
    enabled: true,
  },
  {
    metric: 'smoke',
    condition: 'eq',
    threshold: 1,
    message: '🔥 ตรวจพบควันไฟ! ตรวจสอบพื้นที่ทันที!',
    severity: 'critical',
    enabled: true,
  },
  {
    metric: 'water_level_cm',
    condition: 'lt',
    threshold: 20,
    message: '💧 ระดับน้ำต่ำกว่า 20%! ตรวจสอบปั๊มน้ำ',
    severity: 'warning',
    enabled: true,
  },
  {
    metric: 'door_state',
    condition: 'eq',
    threshold: 1,
    message: '🚪 ประตูเปิดอยู่! ตรวจสอบความปลอดภัย',
    severity: 'info',
    enabled: true,
  },
  {
    metric: 'gas_leak',
    condition: 'eq',
    threshold: 1,
    message: '💨 ตรวจพบแก๊สรั่ว! อพยพทันที!',
    severity: 'critical',
    enabled: true,
  },
  {
    metric: 'soil_moisture',
    condition: 'lt',
    threshold: 30,
    message: '🌱 ความชื้นดินต่ำ! เปิดระบบรดน้ำอัตโนมัติ',
    severity: 'warning',
    enabled: true,
  },
  {
    metric: 'security_connections',
    condition: 'gt',
    threshold: 50,
    message: '⚠️ จำนวนการเชื่อมต่อเครือข่ายสูงผิดปกติ! ตรวจสอบการบุกรุกทันที',
    severity: 'warning',
    enabled: true,
  },
  {
    metric: 'firewall_active',
    condition: 'eq',
    threshold: 0,
    message: '🚨 ไฟร์วอลล์ถูกปิดการทำงาน! เปิดทันทีเพื่อความปลอดภัย',
    severity: 'critical',
    enabled: true,
  },
];

export class AutomationEngine {
  private rules: Rule[] = [];
  private lastTriggered: Record<string, number> = {};
  private cooldownMs = 60000;
  paused = false; // Manual Day — พัก automation ทั้งหมด (embracing chaos: มนุษย์เป็นคนควบคุมเองวันนี้)
  pausedBy = '';

  constructor() {
    // โหลดกฎจาก DB (seed กฎเริ่มต้นถ้ายังไม่มี) — ทำแบบไม่บล็อก
    this.loadRules().catch((err) => {
      console.error('⚙️ Failed to load automation rules (run `npx prisma migrate dev` first):', err.message);
    });
  }

  async loadRules(): Promise<void> {
    const count = await prisma.automationRule.count();
    if (count === 0) {
      await prisma.automationRule.createMany({
        data: DEFAULT_RULES.map((r) => ({ ...r, is_default: true })),
      });
      console.log(`⚙️ Seeded ${DEFAULT_RULES.length} default automation rules`);
    }
    // Prisma คืน condition/severity เป็น string — cast ให้ตรงกับ Rule union (ค่าจาก DB มาจาก DEFAULT_RULES เสมอ)
    this.rules = (await prisma.automationRule.findMany({
      orderBy: [{ is_default: 'desc' }, { created_at: 'asc' }],
    })) as Rule[];
    console.log(`⚙️ Automation Engine loaded ${this.rules.length} rules from DB`);
  }

  async addRule(data: Omit<Rule, 'id' | 'is_default'>): Promise<Rule> {
    const rule = (await prisma.automationRule.create({ data: { ...data, is_default: false } })) as Rule;
    this.rules.push(rule);
    return rule;
  }

  async updateRule(id: string, data: Partial<Omit<Rule, 'id' | 'is_default'>>): Promise<Rule> {
    const rule = (await prisma.automationRule.update({ where: { id }, data })) as Rule;
    const idx = this.rules.findIndex((r) => r.id === id);
    if (idx >= 0) this.rules[idx] = rule;
    return rule;
  }

  async toggleRule(id: string, enabled: boolean): Promise<void> {
    await prisma.automationRule.update({ where: { id }, data: { enabled } });
    const rule = this.rules.find((r) => r.id === id);
    if (rule) rule.enabled = enabled;
  }

  async removeRule(id: string): Promise<void> {
    await prisma.automationRule.delete({ where: { id } });
    this.rules = this.rules.filter((r) => r.id !== id);
  }

  checkMetrics(metrics: Record<string, number>): string[] {
    const alerts: string[] = [];
    // Manual Day: พักกฎทั้งหมด — วันนี้ใช้มือเปิดไฟ เปิดน้ำเอง (Cognitive Grounding)
    if (this.paused) return alerts;
    for (const rule of this.rules) {
      if (!rule.enabled) continue;
      // Living Mode (Anti-Goodhart): กฎที่วัด "การมีชีวิต" (ควันจากการทำอาหาร, ค่าไฟ, เสียง) ห้ามเตือน/ลงโทษ
      if (livingMode.isActive() && LIFESTYLE_METRICS.has(rule.metric)) continue;
      const value = metrics[rule.metric];
      if (value === undefined || value === null) continue;
      let triggered = false;
      switch (rule.condition) {
        case 'gt': triggered = value > rule.threshold; break;
        case 'lt': triggered = value < rule.threshold; break;
        case 'eq': triggered = value === rule.threshold; break;
      }
      if (triggered) {
        const lastTime = this.lastTriggered[rule.id] || 0;
        if (Date.now() - lastTime < this.cooldownMs) continue;
        this.lastTriggered[rule.id] = Date.now();
        const alert = {
          ruleId: rule.id,
          metric: rule.metric,
          value,
          threshold: rule.threshold,
          message: rule.message,
          severity: rule.severity,
          timestamp: new Date().toISOString(),
        };
        alerts.push(rule.message);
        automationEmitter.emit('alert', alert);
      }
    }
    return alerts;
  }

  getRules(): Rule[] { return this.rules; }
}

export const automationEngine = new AutomationEngine();
