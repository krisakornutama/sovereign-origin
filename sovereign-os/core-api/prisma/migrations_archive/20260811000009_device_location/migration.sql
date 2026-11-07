-- พิกัด GPS ของอุปกรณ์ (สำหรับ Global Map) — NULL = ยังไม่ได้ตั้ง
ALTER TABLE devices ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
