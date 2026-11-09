-- Idempotency keys (central) — กันงานซ้ำจากการ retry/เน็ตหลุด/คิวออฟไลน์
-- กติกา: เก็บเฉพาะผลสำเร็จ (2xx) · lease สั้นสำหรับคำขอที่ยังทำงาน · TTL ยาวสำหรับผลที่เก็บแล้ว
-- ปลอดภัยกับ production: ตารางใหม่ล้วน ไม่แตะตารางเดิม และไม่ต้อง backfill

CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'in_flight',
    "responseCode" INTEGER,
    "responseBody" JSONB,
    "userId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "idempotency_keys_scope_key_key" ON "idempotency_keys"("scope", "key");
CREATE INDEX "idempotency_keys_expiresAt_idx" ON "idempotency_keys"("expiresAt");
