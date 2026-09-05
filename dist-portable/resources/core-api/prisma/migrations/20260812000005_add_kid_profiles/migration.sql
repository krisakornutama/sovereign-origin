-- AI สอนลูก: โปรไฟล์เด็ก + บันทึกบทเรียน/คะแนนแบบทดสอบที่เรียนจบ

CREATE TABLE "kid_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "age" INTEGER,
    "emoji" TEXT,
    "color" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kid_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "kid_lesson_progress" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kid_id" UUID NOT NULL,
    "lesson_item_id" UUID,
    "lesson_title" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "completed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kid_lesson_progress_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "kid_lesson_progress_kid_id_fkey" FOREIGN KEY ("kid_id") REFERENCES "kid_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "kid_lesson_progress_kid_id_completed_at_idx" ON "kid_lesson_progress"("kid_id", "completed_at");
