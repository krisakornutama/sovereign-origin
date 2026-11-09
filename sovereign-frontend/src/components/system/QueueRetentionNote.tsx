"use client";
// ─────────────────────────────────────────────────────────────
//  QueueRetentionNote — บรรทัดสรุปของ retention sweep ล่าสุด
//
//  ทำ 2 อย่างตอน mount (ครั้งแรกที่เปิดหน้า settings):
//    1) sweepExpiredQueue() — เก็บกวาดคิวเกิน 30 วัน (boot ก็ทำแล้วที่ initOfflineQueue
//       ตัวนี้กันกรณีเปิดแอปค้างข้ามวันไม่ได้ reload)
//    2) อ่านบันทึก audit ล่าสุดมาแสดง — เขียน audit ก่อนลบเสมอ (plan R3)
//
//  แยกเป็น component เพราะ settings.tsx ติดเพดาน 800 บรรทัดของ frontend-gate
// ─────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";
import { listAudit, sweepExpiredQueue } from "../../lib/offlineQueue";
import { QUEUE_MAX_AGE_DAYS, latestAudit, type RetentionAuditRecord } from "../../lib/offline/queue-retention";
import { useLanguageStore } from "../../stores/useLanguageStore";
import { fmtLocale } from "../../lib/formatDate";

export default function QueueRetentionNote() {
  const t = useLanguageStore((s) => s.t);
  const [last, setLast] = useState<RetentionAuditRecord | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      await sweepExpiredQueue();
      const records = await listAudit();
      if (alive) setLast(latestAudit(records));
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!last) return null;
  return (
    <div className="text-xs text-amber-300">
      {t("settings.queue.swept", "เก็บกวาดคิวเกินอายุ {days} วัน · รอบเมื่อ {time} · ลบ {n} รายการ", {
        days: QUEUE_MAX_AGE_DAYS,
        time: new Date(last.at).toLocaleTimeString(fmtLocale()),
        n: last.removedCount,
      })}
    </div>
  );
}
