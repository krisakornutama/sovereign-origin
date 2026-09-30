-- พฤติกรรมผู้เยี่ยมชมสาธารณะ (P10) — cookieless ไม่มี PII: ip → sha256 8 ตัว (นับ session)
CREATE TABLE "visitor_events" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "detail" TEXT,
    "value" TEXT,
    "user_agent" TEXT,
    "ip_hash" TEXT,

    CONSTRAINT "visitor_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "visitor_events_created_at_idx" ON "visitor_events"("created_at" DESC);
CREATE INDEX "visitor_events_kind_idx" ON "visitor_events"("kind");
