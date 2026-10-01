-- P19 ต่อ — ปุ่ม "🚫 ไม่ได้โอน" ใน Telegram: ปฏิเสธรายการแจ้งชำระ (เก็บแถวไว้ตามรอย แต่ตัดออกจากทุกยอด)
ALTER TABLE "business_payments" ADD COLUMN IF NOT EXISTS "rejectedAt" TIMESTAMPTZ;
