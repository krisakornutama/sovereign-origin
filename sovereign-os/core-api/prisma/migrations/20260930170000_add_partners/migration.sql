-- พาร์ทเนอร์เครือข่าย (P16) — ร้านค้า SME/ช่าง/ผู้ให้บริการ สมัครเข้าแผนที่ร่วม
CREATE TABLE "partners" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'SHOP',
    "detail" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "contactEmail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decided_at" TIMESTAMPTZ(3),
    "note" TEXT,
    "user_agent" TEXT,
    "ip_hash" TEXT,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "partners_status_idx" ON "partners"("status");
CREATE INDEX "partners_created_at_idx" ON "partners"("created_at" DESC);
