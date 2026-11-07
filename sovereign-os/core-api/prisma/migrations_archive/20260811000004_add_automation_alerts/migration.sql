-- CreateTable: ประวัติการแจ้งเตือนจาก Automation Engine (แทนการเก็บใน memory)
CREATE TABLE "automation_alerts" (
    "id" UUID NOT NULL,
    "rule_id" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "message" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_alerts_pkey" PRIMARY KEY ("id")
);
