-- Phase 5: Ambient Conversational Health Screening + Infrastructure (CV, Water, Radio, Equipment)

-- Enums
CREATE TYPE "HealthCategory" AS ENUM ('URINATION', 'SLEEP', 'APPETITE', 'FATIGUE', 'FEVER', 'DIGESTION', 'MOOD', 'OTHER');
CREATE TYPE "HealthFlagStatus" AS ENUM ('PENDING', 'CLEARED', 'ADDRESSED');

-- InventoryItem: shelf-life tracking
ALTER TABLE "inventory_items"
  ADD COLUMN "expiry_date" TIMESTAMPTZ,
  ADD COLUMN "shelf_life_days" INTEGER,
  ADD COLUMN "minimum_stock" DOUBLE PRECISION;

-- Health
CREATE TABLE "health_observations" (
    "id" UUID NOT NULL,
    "category" "HealthCategory" NOT NULL,
    "detail" TEXT,
    "source" TEXT NOT NULL DEFAULT 'conversation',
    "severity" INTEGER NOT NULL DEFAULT 1,
    "observed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "health_observations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "health_observations_category_observed_at_idx" ON "health_observations"("category", "observed_at");

CREATE TABLE "health_flags" (
    "id" UUID NOT NULL,
    "flag_type" TEXT NOT NULL,
    "category" "HealthCategory" NOT NULL,
    "status" "HealthFlagStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cleared_at" TIMESTAMPTZ,
    CONSTRAINT "health_flags_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "health_flags_status_idx" ON "health_flags"("status");

CREATE TABLE "health_consents" (
    "id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "health_consents_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "health_consents_category_key" ON "health_consents"("category");

CREATE TABLE "health_profiles" (
    "id" UUID NOT NULL,
    "conditions" JSONB NOT NULL,
    "medications" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "health_profiles_pkey" PRIMARY KEY ("id")
);

-- Perimeter / Computer Vision
CREATE TABLE "cameras" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "rtsp_url" TEXT,
    "location" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_event_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cameras_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "detection_events" (
    "id" UUID NOT NULL,
    "camera_id" UUID NOT NULL,
    "object_type" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "image_path" TEXT,
    "triggered_action" TEXT,
    "detected_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "detection_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "detection_events_detected_at_idx" ON "detection_events"("detected_at");
ALTER TABLE "detection_events" ADD CONSTRAINT "detection_events_camera_id_fkey"
  FOREIGN KEY ("camera_id") REFERENCES "cameras"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Water quality
CREATE TABLE "water_quality_readings" (
    "id" UUID NOT NULL,
    "tank_name" TEXT NOT NULL,
    "tds" DOUBLE PRECISION,
    "ph" DOUBLE PRECISION,
    "turbidity" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "measured_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "water_quality_readings_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "water_quality_readings_tank_name_measured_at_idx" ON "water_quality_readings"("tank_name", "measured_at");

-- Radio / mesh
CREATE TABLE "radio_messages" (
    "id" UUID NOT NULL,
    "direction" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "remote_id" TEXT,
    "is_emergency" BOOLEAN NOT NULL DEFAULT false,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "radio_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "radio_messages_received_at_idx" ON "radio_messages"("received_at");

-- Equipment maintenance
CREATE TABLE "equipment" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "run_hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "service_interval_hours" DOUBLE PRECISION,
    "last_service_at" TIMESTAMPTZ,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "equipment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "run_hours_logs" (
    "id" UUID NOT NULL,
    "equipment_id" UUID NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "logged_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "run_hours_logs_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "run_hours_logs" ADD CONSTRAINT "run_hours_logs_equipment_id_fkey"
  FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
