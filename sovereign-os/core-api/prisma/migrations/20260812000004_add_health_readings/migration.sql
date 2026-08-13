-- P6: Health Reading Tracker �?" บันทึกค่าวัดด้วยมือ + AI วิเคราะห์แนวโน้ม (z-score จาก P4)

CREATE TYPE "HealthReadingType" AS ENUM ('WEIGHT', 'BP', 'SUGAR', 'TEMP');

CREATE TABLE "health_readings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" "HealthReadingType" NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "systolic" INTEGER,
    "diastolic" INTEGER,
    "note" TEXT,
    "measured_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "health_readings_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "health_readings_type_measured_at_idx" ON "health_readings"("type", "measured_at");