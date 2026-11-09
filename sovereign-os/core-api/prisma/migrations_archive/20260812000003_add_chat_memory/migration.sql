-- P1: Conversational Memory — ChatMessage (ประวัติสนทนา AI)

CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "chat_messages_actor_created_at_idx" ON "chat_messages"("actor", "created_at");