-- Migration: Coding Agent workspace + Skill Queue + Notes
-- เพิ่มคอลัมน์เลือกโมเดล/ระดับเหตุผล/autonomy/รูปภาพ ให้ coding_jobs
-- สร้างตาราง skill_queue_items (คิวทักษะ + ระดับอัตโนมัติ) และ notes (ปุ่มโน้ต)

ALTER TABLE "coding_jobs"
  ADD COLUMN IF NOT EXISTS "model" TEXT,
  ADD COLUMN IF NOT EXISTS "reasoning_effort" TEXT,
  ADD COLUMN IF NOT EXISTS "autonomy" TEXT,
  ADD COLUMN IF NOT EXISTS "image_base64" TEXT;

CREATE TABLE IF NOT EXISTS "skill_queue_items" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "autonomy" TEXT NOT NULL DEFAULT 'manual',
  "model" TEXT,
  "reasoning_effort" TEXT,
  "job_id" TEXT,
  "result" TEXT,
  "error" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMPTZ,
  "completed_at" TIMESTAMPTZ,
  CONSTRAINT "skill_queue_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "notes" (
  "id" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);