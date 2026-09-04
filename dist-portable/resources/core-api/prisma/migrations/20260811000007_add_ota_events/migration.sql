-- CreateTable: สถานะ OTA (คำสั่ง deploy จาก server + ผลรายงานจากอุปกรณ์)
CREATE TABLE "ota_events" (
    "id" UUID NOT NULL,
    "node_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "firmware" TEXT,
    "version" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ota_events_pkey" PRIMARY KEY ("id")
);
