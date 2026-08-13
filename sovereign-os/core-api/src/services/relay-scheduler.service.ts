import cron from 'node-cron';
import mqtt from 'mqtt';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const mqttClient = mqtt.connect({
  host: process.env.MQTT_HOST || 'localhost',
  port: Number(process.env.MQTT_PORT) || 1883,
  protocol: 'mqtt',
});

mqttClient.on('connect', () => console.log('⏰ Relay Scheduler MQTT connected'));

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * ตรวจสอบตารางเวลาทุก 1 นาที แล้วสั่ง relay ที่ถึงเวลา
 * - time เปรียบเทียบกับเวลาท้องถิ่นของเครื่อง server (HH:mm)
 * - last_fired กันการยิงซ้ำภายในวันเดียวกัน (เช่น restart กลางวัน)
 */
export class RelaySchedulerService {
  start() {
    cron.schedule('* * * * *', () => {
      this.checkSchedules().catch((err) => console.error('Relay scheduler error:', err));
    });
    console.log('⏰ Relay Scheduler started (checks every minute)');
  }

  private async checkSchedules(): Promise<void> {
    const now = new Date();
    const currentTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay(); // 1 = จันทร์ … 7 = อาทิตย์
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    const schedules = await prisma.relaySchedule.findMany({
      where: { enabled: true },
      include: { relay: true },
    });

    for (const schedule of schedules) {
      // ยิงไปแล้ววันนี้ → ข้าม
      if (schedule.last_fired === today) continue;
      // ยังไม่ถึงเวลา
      if (schedule.time !== currentTime) continue;

      // ตรวจวันในสัปดาห์: "*" = ทุกวัน หรือรายการเลขวัน 1-7
      const days = schedule.days.trim();
      const matchesDay =
        days === '*' ||
        days
          .split(',')
          .map((d) => parseInt(d.trim(), 10))
          .includes(dayOfWeek);
      if (!matchesDay) continue;

      const topic = `sovereign/${schedule.relay.node_id}/relay/${schedule.relay_id}`;
      mqttClient.publish(topic, String(schedule.state));

      // อัปเดตสถานะจริงใน DB + กันยิงซ้ำ
      await prisma.relay.update({
        where: { id: schedule.relay_id },
        data: { state: schedule.state },
      });
      await prisma.relaySchedule.update({
        where: { id: schedule.id },
        data: { last_fired: today },
      });

      console.log(
        `⏰ Scheduled fire: ${schedule.relay_id} -> ${schedule.state} at ${schedule.time} (${today})`
      );
    }
  }
}

export const relayScheduler = new RelaySchedulerService();
