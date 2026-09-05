-- CreateTable: รายงานสรุปอัตโนมัติจาก AI (รายวัน/รายสัปดาห์)
CREATE TABLE "daily_reports" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_reports_pkey" PRIMARY KEY ("id")
);
