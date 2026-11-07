-- ฟีดแบ็กสาธารณะจากหน้า /demo (P: Publishing) — คัดกรองก่อนส่งถึงเจ้าของ (digest)
CREATE TABLE "feedback_notes" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "page" TEXT NOT NULL DEFAULT '/demo',
    "topic" TEXT NOT NULL DEFAULT 'general',
    "message" TEXT NOT NULL,
    "sender_email" TEXT,
    "useful" BOOLEAN,
    "sent_at" TIMESTAMPTZ(3),
    "user_agent" TEXT,
    "ip_hash" TEXT,

    CONSTRAINT "feedback_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "feedback_notes_created_at_idx" ON "feedback_notes"("created_at" DESC);
CREATE INDEX "feedback_notes_useful_idx" ON "feedback_notes"("useful");
