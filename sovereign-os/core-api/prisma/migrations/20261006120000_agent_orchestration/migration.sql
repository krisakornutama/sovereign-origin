-- Agent orchestration: เครื่องที่รัน agent + ฟิลด์สำหรับ dispatch/approval
-- ทั้งหมดเป็นการเพิ่มล้วน ไม่ลบและไม่แก้ข้อมูลเดิม

-- CreateTable
CREATE TABLE "agent_machines" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "os" TEXT NOT NULL DEFAULT 'windows',
    "capabilities" JSONB NOT NULL DEFAULT '[]',
    "executors" JSONB NOT NULL DEFAULT '[]',
    "token_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'offline',
    "last_heartbeat" TIMESTAMPTZ,
    "version" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "agent_machines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_machines_token_hash_key" ON "agent_machines"("token_hash");

-- AlterTable
ALTER TABLE "agent_jobs" ADD COLUMN "machine_id" UUID,
ADD COLUMN "executor" TEXT,
ADD COLUMN "executor_model" TEXT,
ADD COLUMN "executor_agent" TEXT,
ADD COLUMN "workspace" TEXT,
ADD COLUMN "exit_code" INTEGER,
ADD COLUMN "log_tail" TEXT,
ADD COLUMN "screenshot_url" TEXT,
ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "dispatched_at" TIMESTAMPTZ,
ADD COLUMN "risk" TEXT,
ADD COLUMN "approved_by" TEXT,
ADD COLUMN "approved_at" TIMESTAMPTZ;

-- CreateIndex
CREATE INDEX "agent_jobs_status_created_at_idx" ON "agent_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "agent_jobs_status_machine_id_idx" ON "agent_jobs"("status", "machine_id");

-- AddForeignKey
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "agent_machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
