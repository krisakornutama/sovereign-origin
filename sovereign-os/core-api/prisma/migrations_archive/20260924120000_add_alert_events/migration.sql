-- ประวัติ alert ทั้งหมดของระบบ (Telegram dispatcher + truth-watchdog + nightly verify)
CREATE TABLE "alert_events" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "severity" TEXT NOT NULL,
    "event_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "sent" BOOLEAN NOT NULL DEFAULT false,
    "suppressed" TEXT,
    "source" TEXT NOT NULL DEFAULT 'dispatcher',

    CONSTRAINT "alert_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "alert_events_created_at_idx" ON "alert_events"("created_at" DESC);
CREATE INDEX "alert_events_event_key_idx" ON "alert_events"("event_key");
