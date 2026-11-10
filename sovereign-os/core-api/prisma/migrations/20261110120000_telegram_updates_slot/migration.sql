-- 20261110120000_telegram_updates_slot
--
-- กันกดรัว GET /api/telegram/updates (10 พ.ย. 69)
--
-- เดิมเป็น Map ในหน่วยความจำ ⇒ กันได้เฉพาะ process เดียว และหายเมื่อรีสตาร์ท
-- ตารางนี้เก็บ "ครั้งล่าสุดที่ยอมให้ยิง getUpdates" ต่อผู้ใช้ เพื่อให้ทุก instance
-- ที่ต่อ DB เดียวกันเห็นสถานะร่วมกัน (atomic ด้วย ON CONFLICT … WHERE ตามเวลาที่ผ่านไป)
--
-- ขนาด: 1 แถวต่อผู้ใช้ที่เคยกด (หลักสิบ) ไม่ใช่ log — เขียนทับแถวเดิมทุกครั้ง
CREATE TABLE IF NOT EXISTS "telegram_updates_slot" (
  "user_key"    TEXT PRIMARY KEY,
  "last_hit_at" TIMESTAMPTZ NOT NULL
);
