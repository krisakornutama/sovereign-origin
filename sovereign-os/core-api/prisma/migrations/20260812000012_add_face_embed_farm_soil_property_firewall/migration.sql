-- Migration 12: face embeddings + farm soil readings + property map + firewall engine

-- 1) KnownFace: เก็บภาพจริง + dhash + embedding เวกเตอร์
ALTER TABLE "known_faces" ADD COLUMN "photo_data" TEXT;
ALTER TABLE "known_faces" ADD COLUMN "dhash" TEXT;
ALTER TABLE "known_faces" ADD COLUMN "embedding" JSONB;
ALTER TABLE "known_faces" ADD COLUMN "embed_method" TEXT;

-- 2) FarmPlot: ขนาด/รูป/ขอบเขตแปลง
ALTER TABLE "farm_plots" ADD COLUMN "width_m" DOUBLE PRECISION;
ALTER TABLE "farm_plots" ADD COLUMN "length_m" DOUBLE PRECISION;
ALTER TABLE "farm_plots" ADD COLUMN "layout_image_url" TEXT;
ALTER TABLE "farm_plots" ADD COLUMN "boundary" JSONB;

-- 3) ค่า NPK/ความชื้นของแปลง
CREATE TABLE "farm_soil_readings" (
  "id" TEXT NOT NULL,
  "plot_id" TEXT NOT NULL,
  "n" DOUBLE PRECISION,
  "p" DOUBLE PRECISION,
  "k" DOUBLE PRECISION,
  "ph" DOUBLE PRECISION,
  "moisture_pct" DOUBLE PRECISION,
  "ec" DOUBLE PRECISION,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "note" TEXT,
  "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "farm_soil_readings_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "farm_soil_readings_plot_id_recorded_at_idx" ON "farm_soil_readings"("plot_id", "recorded_at");
ALTER TABLE "farm_soil_readings" ADD CONSTRAINT "farm_soil_readings_plot_id_fkey"
  FOREIGN KEY ("plot_id") REFERENCES "farm_plots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4) แผนที่ที่ดิน + จุดยุทธศาสตร์
CREATE TABLE "property_zones" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'อื่น',
  "x" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "y" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "z" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "width_m" DOUBLE PRECISION NOT NULL DEFAULT 2,
  "length_m" DOUBLE PRECISION NOT NULL DEFAULT 2,
  "height_m" DOUBLE PRECISION NOT NULL DEFAULT 2,
  "color" TEXT,
  "note" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "property_zones_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "strategic_points" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'เซ็นเซอร์ตรวจจับ',
  "zone_id" TEXT,
  "x" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "y" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "z" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "radius_m" DOUBLE PRECISION NOT NULL DEFAULT 4,
  "reason" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "last_triggered_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "strategic_points_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "strategic_points_enabled_idx" ON "strategic_points"("enabled");

-- 5) Firewall: กฎ + นโยบายเริ่มต้น
CREATE TABLE "firewall_rules" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "action" TEXT NOT NULL DEFAULT 'DENY',
  "direction" TEXT NOT NULL DEFAULT 'BOTH',
  "protocol" TEXT NOT NULL DEFAULT 'ANY',
  "remote_ip" TEXT,
  "remote_port" TEXT,
  "local_port" TEXT,
  "priority" INTEGER NOT NULL DEFAULT 10,
  "description" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "firewall_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "firewall_config" (
  "id" INTEGER NOT NULL,
  "default_policy" TEXT NOT NULL DEFAULT 'ALLOW',
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "firewall_config_pkey" PRIMARY KEY ("id")
);
INSERT INTO "firewall_config" ("id", "default_policy", "updated_at")
VALUES (1, 'ALLOW', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
