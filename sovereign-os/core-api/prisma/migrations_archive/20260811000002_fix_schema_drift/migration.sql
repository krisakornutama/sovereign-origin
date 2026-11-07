-- Fix schema drift: ทำให้ prisma migrate dev สร้าง DB ใหม่ได้ครบทุกโมเดล

-- AlterTable: devices ขาดคอลัมน์ last_heartbeat (schema มี แต่ migration เดิมไม่มี)
ALTER TABLE "devices" ADD COLUMN "last_heartbeat" TIMESTAMPTZ;

-- CreateTable: security_events ยังไม่มีใน migration เลย (schema มี SecurityEvent model)
CREATE TABLE "security_events" (
    "id" UUID NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "event_type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "source_ip" TEXT,
    "dest_ip" TEXT,
    "description" TEXT NOT NULL,
    "raw_data" JSONB,

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);
