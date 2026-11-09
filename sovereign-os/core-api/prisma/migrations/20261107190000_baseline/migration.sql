-- 20261107190000_baseline — baseline เดียวที่ตรงกับ prisma/schema.prisma ปัจจุบัน
--
-- ทำไมต้อง squash: migration chain เดิมสร้าง schema ที่ไม่ตรงกับ schema.prisma แล้ว
-- (เช่น users.token_version ไม่เคยถูกบันทึกเป็น migration, id หลายตารางเป็น TEXT ขณะที่ schema เป็น UUID)
-- การสร้างส่วนต่างแบบ incremental ต้อง DROP COLUMN/DROP CONSTRAINT 24+ จุด ซึ่งทำลายข้อมูลจริง
-- migration เดิมทั้งหมดถูกเก็บไว้ที่ prisma/migrations_archive/ เพื่อการตรวจย้อนหลัง
--
-- DB ที่มีข้อมูลอยู่แล้ว (dev/prod): ห้ามรัน baseline นี้ — ใช้ `npx prisma migrate resolve --applied 20261107190000_baseline`
-- แล้วจึงรัน `npx prisma migrate deploy` (จะไม่มีอะไรค้าง)

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPERADMIN', 'NODE_ADMIN', 'OPERATOR', 'SYSTEM_AI', 'SITE_ADMIN', 'KID');

-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('CRYPTO', 'STOCK', 'COMMODITY');

-- CreateEnum
CREATE TYPE "HealthCategory" AS ENUM ('URINATION', 'SLEEP', 'APPETITE', 'FATIGUE', 'FEVER', 'DIGESTION', 'MOOD', 'OTHER');

-- CreateEnum
CREATE TYPE "HealthFlagStatus" AS ENUM ('PENDING', 'CLEARED', 'ADDRESSED');

-- CreateEnum
CREATE TYPE "HealthReadingType" AS ENUM ('WEIGHT', 'BP', 'SUGAR', 'TEMP');

-- CreateTable
CREATE TABLE "invite_codes" (
    "id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "label" TEXT,
    "role" "Role" NOT NULL DEFAULT 'OPERATOR',
    "max_uses" INTEGER NOT NULL DEFAULT 1,
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "created_by" UUID,
    "used_by" UUID,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invite_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'OPERATOR',
    "mfa_secret" TEXT,
    "pending_mfa_secret" TEXT,
    "mfa_backup_hash" TEXT,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "deleted_at" TIMESTAMPTZ,
    "assigned_node_id" UUID,
    "assigned_site_id" UUID,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nodes" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "gis_location" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_sync_time" TIMESTAMPTZ,

    CONSTRAINT "nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "node_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "mqtt_topic" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_heartbeat" TIMESTAMPTZ,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "relays" (
    "id" TEXT NOT NULL,
    "node_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "state" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "relays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "relay_schedules" (
    "id" UUID NOT NULL,
    "relay_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "time" TEXT NOT NULL,
    "state" INTEGER NOT NULL,
    "days" TEXT NOT NULL,
    "last_fired" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "relay_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_events" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "severity" TEXT NOT NULL,
    "event_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "sent" BOOLEAN NOT NULL DEFAULT false,
    "suppressed" TEXT,
    "source" TEXT NOT NULL DEFAULT 'dispatcher',

    CONSTRAINT "alert_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_notes" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "page" TEXT NOT NULL DEFAULT '/demo',
    "topic" TEXT NOT NULL DEFAULT 'general',
    "message" TEXT NOT NULL,
    "sender_email" TEXT,
    "useful" BOOLEAN,
    "sent_at" TIMESTAMPTZ,
    "user_agent" TEXT,
    "ip_hash" TEXT,

    CONSTRAINT "feedback_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partners" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT NOT NULL,
    "name_normalized" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'SHOP',
    "detail" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "phone_hash" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "contact_phone_hash" TEXT,
    "contactEmail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decided_at" TIMESTAMPTZ,
    "note" TEXT,
    "user_agent" TEXT,
    "ip_hash" TEXT,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visitor_events" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "detail" TEXT,
    "value" TEXT,
    "user_agent" TEXT,
    "ip_hash" TEXT,

    CONSTRAINT "visitor_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID,
    "action_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sensor_telemetry" (
    "time" TIMESTAMPTZ NOT NULL,
    "node_id" UUID NOT NULL,
    "device_id" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL
);

-- CreateTable
CREATE TABLE "energy_readings" (
    "id" UUID NOT NULL,
    "node_id" UUID NOT NULL,
    "device_id" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "read_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "energy_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "energy_thresholds" (
    "id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeName" TEXT NOT NULL,
    "metric" TEXT NOT NULL DEFAULT 'power_kw',
    "maxKw" DOUBLE PRECISION NOT NULL,
    "windowMin" INTEGER NOT NULL DEFAULT 60,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "energy_thresholds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_positions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "type" "AssetType" NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "wallet_address" TEXT,
    "notes" TEXT,
    "strategy_family" TEXT NOT NULL DEFAULT 'FUNDAMENTAL',
    "avg_cost_usd" DOUBLE PRECISION,
    "company_name" TEXT,
    "allocation_pct" DOUBLE PRECISION,
    "total_return_pct" DOUBLE PRECISION,
    "total_return_usd" DOUBLE PRECISION,
    "expected_dividend_yield_pct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "catalyst_note" TEXT,
    "last_dividend_usd" DOUBLE PRECISION,
    "last_dividend_at" TIMESTAMPTZ,
    "realized_gain_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sold_qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "asset_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personal_balance_sheets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "liquid_cash_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "liabilities_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "monthly_burn_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "monthly_income_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "personal_balance_sheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survival_runways" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "months" DOUBLE PRECISION NOT NULL,
    "liquid_cash_usd" DOUBLE PRECISION NOT NULL,
    "annualized_dividend_usd" DOUBLE PRECISION NOT NULL,
    "monthly_burn_usd" DOUBLE PRECISION NOT NULL,
    "snapshot_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "survival_runways_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treasury_events" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "symbol" TEXT,
    "asset_position_id" UUID,
    "amount_usd" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "treasury_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_orders" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "direction" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "amount_usd" DOUBLE PRECISION NOT NULL,
    "amount_thb" DOUBLE PRECISION,
    "payee" TEXT,
    "bank" TEXT,
    "account_number" TEXT,
    "note" TEXT,
    "ref_code" TEXT NOT NULL,
    "qr_payload" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "txid" TEXT,
    "evidence_url" TEXT,
    "requested_by" UUID NOT NULL,
    "verified_by" UUID,
    "verified_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "transfer_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dime_statements" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "statement_period" TEXT NOT NULL,
    "message_id" TEXT,
    "raw_text_hash" TEXT,
    "source" TEXT NOT NULL DEFAULT 'EMAIL',
    "subject" TEXT,
    "assets" JSONB NOT NULL,
    "skipped" JSONB,
    "account_no" TEXT,
    "investment_account_no" TEXT,
    "tax_id" TEXT,
    "tax_invoice_no" TEXT,
    "branch_no" TEXT,
    "fx_rate" DOUBLE PRECISION,
    "total_balance_usd" DOUBLE PRECISION,
    "total_balance_thb" DOUBLE PRECISION,
    "cash_balance_usd" DOUBLE PRECISION,
    "cash_balance_thb" DOUBLE PRECISION,
    "total_return_pct" DOUBLE PRECISION,
    "total_return_usd" DOUBLE PRECISION,
    "sectors" JSONB,
    "parsed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dime_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wealth_history" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "total_usd_value" DOUBLE PRECISION NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "wealth_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_events" (
    "id" UUID NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "event_type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "source_ip" TEXT,
    "dest_ip" TEXT,
    "description" TEXT NOT NULL,
    "raw_data" JSONB,

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ota_events" (
    "id" UUID NOT NULL,
    "node_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "firmware" TEXT,
    "version" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ota_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_rules" (
    "id" UUID NOT NULL,
    "metric" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "message" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'warning',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_reports" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_embeddings" (
    "id" BIGSERIAL NOT NULL,
    "file" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL DEFAULT 0,
    "content" TEXT NOT NULL,
    "embedding" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_alerts" (
    "id" UUID NOT NULL,
    "rule_id" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "message" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_prices" (
    "time" TIMESTAMPTZ NOT NULL,
    "symbol" TEXT NOT NULL,
    "type" "AssetType" NOT NULL,
    "price_usd" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "unit_price_usd" DOUBLE PRECISION NOT NULL,
    "location" TEXT,
    "expiry_date" TIMESTAMPTZ,
    "shelf_life_days" INTEGER,
    "minimum_stock" DOUBLE PRECISION,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_feature_grants" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "feature" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_feature_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_plots" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "crop" TEXT,
    "area_sqm" DOUBLE PRECISION,
    "width_m" DOUBLE PRECISION,
    "length_m" DOUBLE PRECISION,
    "layout_image_url" TEXT,
    "boundary" JSONB,
    "soil_notes" TEXT,
    "planted_at" TIMESTAMPTZ,
    "expected_harvest_at" TIMESTAMPTZ,
    "status" TEXT NOT NULL DEFAULT 'active',
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "farm_plots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_soil_readings" (
    "id" UUID NOT NULL,
    "plot_id" UUID NOT NULL,
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

-- CreateTable
CREATE TABLE "health_observations" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "category" "HealthCategory" NOT NULL,
    "detail" TEXT,
    "source" TEXT NOT NULL DEFAULT 'conversation',
    "severity" INTEGER NOT NULL DEFAULT 1,
    "observed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_flags" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "flag_type" TEXT NOT NULL,
    "category" "HealthCategory" NOT NULL,
    "status" "HealthFlagStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cleared_at" TIMESTAMPTZ,

    CONSTRAINT "health_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_consents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT false,
    "policy_version" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'web',
    "ip" TEXT,
    "granted_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_events" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "policy_version" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'web',
    "ip" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_consents" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "category" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "conditions" JSONB NOT NULL,
    "medications" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_readings" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "type" "HealthReadingType" NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "systolic" INTEGER,
    "diastolic" INTEGER,
    "note" TEXT,
    "measured_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
CREATE TABLE "run_hours_logs" (
    "id" UUID NOT NULL,
    "equipment_id" UUID NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "logged_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "run_hours_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_headlines" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "summary" TEXT,
    "published" TIMESTAMPTZ NOT NULL,
    "category" TEXT,
    "fetched_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_headlines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "threat_index" (
    "id" UUID NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "overall" DOUBLE PRECISION NOT NULL,
    "categories" JSONB NOT NULL,
    "summary" TEXT,
    "model" TEXT NOT NULL,
    "headline_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "threat_index_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "defcon_events" (
    "id" UUID NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "level" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT,

    CONSTRAINT "defcon_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_items" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "content" TEXT,
    "file_path" TEXT,
    "tags" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "knowledge_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kid_profiles" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "age" INTEGER,
    "emoji" TEXT,
    "color" TEXT,
    "allowance_day" INTEGER,
    "allowance_amount" INTEGER,
    "allowance_last_paid" TIMESTAMPTZ,
    "pin_hash" TEXT,
    "savings_goal" INTEGER,
    "piggy_target_title" TEXT,
    "piggy_target_amount" INTEGER,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "money_mode" TEXT NOT NULL DEFAULT 'play',
    "invest_policy" TEXT,
    "invest_target_pct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "kid_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kid_lesson_progress" (
    "id" UUID NOT NULL,
    "kid_id" UUID NOT NULL,
    "lesson_item_id" UUID,
    "lesson_title" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "curriculum_item_id" UUID,
    "completed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kid_lesson_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kid_chores" (
    "id" UUID NOT NULL,
    "kid_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "reward" INTEGER NOT NULL,
    "emoji" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "repeat" TEXT NOT NULL DEFAULT 'none',
    "completed_at" TIMESTAMPTZ,
    "archived_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kid_chores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kid_bills" (
    "id" UUID NOT NULL,
    "kid_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "emoji" TEXT,
    "period" TEXT NOT NULL DEFAULT 'one-time',
    "status" TEXT NOT NULL DEFAULT 'unpaid',
    "paid_at" TIMESTAMPTZ,
    "archived_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kid_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kid_wallet_txs" (
    "id" UUID NOT NULL,
    "kid_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "note" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kid_wallet_txs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kid_piggy_txs" (
    "id" UUID NOT NULL,
    "kid_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "note" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kid_piggy_txs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kid_investments" (
    "id" UUID NOT NULL,
    "kid_id" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "units" DOUBLE PRECISION NOT NULL,
    "avg_cost" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "kid_investments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kid_audit_logs" (
    "id" UUID NOT NULL,
    "kid_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "actor" TEXT NOT NULL DEFAULT 'parent',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kid_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kid_coupons" (
    "id" UUID NOT NULL,
    "kid_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "cost" INTEGER NOT NULL,
    "emoji" TEXT,
    "status" TEXT NOT NULL DEFAULT 'available',
    "redeemed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kid_coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kid_certificates" (
    "id" UUID NOT NULL,
    "kid_id" UUID NOT NULL,
    "level" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'level',
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kid_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kid_portfolio_deposits" (
    "id" UUID NOT NULL,
    "kid_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "note" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kid_portfolio_deposits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kid_portfolio_snapshots" (
    "id" UUID NOT NULL,
    "kid_id" UUID NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kid_portfolio_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "curriculum_tracks" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "emoji" TEXT NOT NULL DEFAULT '🎓',
    "color" TEXT NOT NULL DEFAULT '#10b981',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "curriculum_tracks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "curriculum_items" (
    "id" UUID NOT NULL,
    "track_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "stage" INTEGER NOT NULL DEFAULT 1,
    "sequence" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "curriculum_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_roles" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "emoji" TEXT NOT NULL DEFAULT '🤖',
    "description" TEXT NOT NULL,
    "system_prompt" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "daily_report" BOOLEAN NOT NULL DEFAULT true,
    "report_hour" INTEGER NOT NULL DEFAULT 7,
    "last_report_date" TEXT,

    CONSTRAINT "agent_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_jobs" (
    "id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "role_name" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "result" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "machine_id" UUID,
    "executor" TEXT,
    "executor_model" TEXT,
    "executor_agent" TEXT,
    "workspace" TEXT,
    "exit_code" INTEGER,
    "log_tail" TEXT,
    "screenshot_url" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "dispatched_at" TIMESTAMPTZ,
    "risk" TEXT,
    "approved_by" TEXT,
    "approved_at" TIMESTAMPTZ,

    CONSTRAINT "agent_jobs_pkey" PRIMARY KEY ("id")
);

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
    "role" TEXT NOT NULL DEFAULT 'USER',
    "owner_user_id" UUID,
    "lan_confirmed_at" TIMESTAMPTZ,
    "pair_code_hash" TEXT,
    "pair_code_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "agent_machines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_machine_hubs" (
    "machine_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_machine_hubs_pkey" PRIMARY KEY ("machine_id","user_id")
);

-- CreateTable
CREATE TABLE "fleet_sites" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "fleet_sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_groups" (
    "id" UUID NOT NULL,
    "site_id" UUID,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "fleet_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "default_channel" TEXT NOT NULL DEFAULT 'stable',
    "require_lan_verification" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "fleet_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_channels" (
    "channel" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "rollout_percent" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "fleet_channels_pkey" PRIMARY KEY ("channel")
);

-- CreateTable
CREATE TABLE "fleet_rollouts" (
    "id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "rollout_percent" INTEGER NOT NULL,
    "changed_by" UUID,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fleet_rollouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_machine_overrides" (
    "machine_id" UUID NOT NULL,
    "channel" TEXT,
    "site_id" UUID,
    "group_id" UUID,
    "tags" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "fleet_machine_overrides_pkey" PRIMARY KEY ("machine_id")
);

-- CreateTable
CREATE TABLE "fleet_enrollment_tokens" (
    "id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "expires_at" TIMESTAMPTZ,
    "max_uses" INTEGER NOT NULL,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "last_used_at" TIMESTAMPTZ,
    "last_machine_id" TEXT,
    "last_machine_name" TEXT,
    "revoked_at" TIMESTAMPTZ,
    "revoke_reason" TEXT,

    CONSTRAINT "fleet_enrollment_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_enrollment_uses" (
    "id" UUID NOT NULL,
    "token_id" UUID NOT NULL,
    "machine_id" TEXT,
    "machine_name" TEXT,
    "used_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMPTZ,

    CONSTRAINT "fleet_enrollment_uses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "known_faces" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "photo_url" TEXT,
    "photo_data" TEXT,
    "dhash" TEXT,
    "embedding" JSONB,
    "embed_method" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "known_faces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vision_rules" (
    "id" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "interval_min" INTEGER NOT NULL DEFAULT 10,
    "notify_telegram" BOOLEAN NOT NULL DEFAULT true,
    "confidence_min" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "only_strangers" BOOLEAN NOT NULL DEFAULT true,
    "last_check_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "vision_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vision_alerts" (
    "id" UUID NOT NULL,
    "image_url" TEXT,
    "message" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'stranger',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cleared" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vision_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scenario_forecasts" (
    "id" UUID NOT NULL,
    "focus" TEXT NOT NULL,
    "horizonDays" INTEGER NOT NULL DEFAULT 90,
    "model" TEXT NOT NULL,
    "base" JSONB NOT NULL,
    "scenarios" JSONB NOT NULL,
    "summary" TEXT,
    "generatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scenario_forecasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL,
    "actor" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_zones" (
    "id" UUID NOT NULL,
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

-- CreateTable
CREATE TABLE "strategic_points" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'เซ็นเซอร์ตรวจจับ',
    "zone_id" UUID,
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

-- CreateTable
CREATE TABLE "firewall_rules" (
    "id" UUID NOT NULL,
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

-- CreateTable
CREATE TABLE "firewall_config" (
    "id" INTEGER NOT NULL,
    "default_policy" TEXT NOT NULL DEFAULT 'ALLOW',
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "firewall_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buddhist_teachings" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'ทุกข์ & โรค',
    "category_tags" JSONB,
    "content" TEXT NOT NULL,
    "application" TEXT,
    "source" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buddhist_teachings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meditation_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "type" TEXT NOT NULL DEFAULT 'หายใจ',
    "duration_min" INTEGER NOT NULL DEFAULT 5,
    "note" TEXT,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meditation_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "healing_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "logged_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "healing_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coding_jobs" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "plan_json" JSONB,
    "files_json" JSONB,
    "result" JSONB,
    "error" TEXT,
    "model" TEXT,
    "reasoning_effort" TEXT,
    "autonomy" TEXT,
    "image_base64" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "coding_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_queue_items" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "autonomy" TEXT NOT NULL DEFAULT 'manual',
    "model" TEXT,
    "reasoning_effort" TEXT,
    "job_id" UUID,
    "result" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "skill_queue_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notes" (
    "id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "threat_intel_items" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'unknown',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "first_seen" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "threat_intel_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "livestock_groups" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "species" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "birthDate" TIMESTAMPTZ NOT NULL,
    "houseCode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "quarantineEndAt" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "livestock_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "livestock_medical_records" (
    "id" UUID NOT NULL,
    "livestockGroupId" UUID NOT NULL,
    "drugName" TEXT NOT NULL,
    "dosageMgKg" DOUBLE PRECISION NOT NULL,
    "administeredAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawalDays" INTEGER NOT NULL,
    "safeHarvestDate" TIMESTAMP(3) NOT NULL,
    "inventoryItemId" UUID,

    CONSTRAINT "livestock_medical_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "livestock_vaccine_schedules" (
    "id" UUID NOT NULL,
    "livestockGroupId" UUID NOT NULL,
    "vaccineName" TEXT NOT NULL,
    "targetAgeDays" INTEGER NOT NULL,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMPTZ,
    "inventoryItemId" UUID,

    CONSTRAINT "livestock_vaccine_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "livestock_daily_logs" (
    "id" UUID NOT NULL,
    "livestockGroupId" UUID NOT NULL,
    "logDate" TIMESTAMPTZ NOT NULL,
    "mortalityCount" INTEGER NOT NULL DEFAULT 0,
    "culledCount" INTEGER NOT NULL DEFAULT 0,
    "feedConsumedKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "waterConsumedL" DOUBLE PRECISION,
    "eggCount" INTEGER,
    "avgWeightGram" DOUBLE PRECISION,

    CONSTRAINT "livestock_daily_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "livestock_feed_silos" (
    "id" UUID NOT NULL,
    "siloCode" TEXT NOT NULL,
    "capacityKg" DOUBLE PRECISION NOT NULL,
    "currentKg" DOUBLE PRECISION NOT NULL,
    "lastRefillAt" TIMESTAMPTZ NOT NULL,
    "inventoryItemId" UUID,

    CONSTRAINT "livestock_feed_silos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "livestock_biosecurity_logs" (
    "id" UUID NOT NULL,
    "visitorName" TEXT NOT NULL,
    "vehiclePlate" TEXT,
    "sanitizedSec" INTEGER NOT NULL,
    "passedGate" BOOLEAN NOT NULL DEFAULT false,
    "entryTime" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exitTime" TIMESTAMPTZ,

    CONSTRAINT "livestock_biosecurity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "livestock_breeding_records" (
    "id" UUID NOT NULL,
    "livestockGroupId" UUID NOT NULL,
    "inseminatedAt" TIMESTAMPTZ NOT NULL,
    "expectedBirthAt" TIMESTAMPTZ NOT NULL,
    "actualBirthAt" TIMESTAMPTZ,
    "litterSize" INTEGER,
    "eggSetCount" INTEGER,
    "hatchedCount" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PREGNANT',

    CONSTRAINT "livestock_breeding_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "livestock_batch_financials" (
    "id" UUID NOT NULL,
    "livestockGroupId" UUID,
    "batchCode" TEXT NOT NULL,
    "initialAnimalCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalFeedCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalMedCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalUtilityCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalRevenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "netProfit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "closedAt" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "livestock_batch_financials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "livestock_utility_alerts" (
    "id" UUID NOT NULL,
    "houseCode" TEXT NOT NULL,
    "gridPowerState" TEXT NOT NULL,
    "generatorState" TEXT NOT NULL,
    "atsTrippedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "livestock_utility_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "livestock_climate_logs" (
    "id" UUID NOT NULL,
    "houseCode" TEXT,
    "tempC" DOUBLE PRECISION NOT NULL,
    "rhPct" DOUBLE PRECISION NOT NULL,
    "thi" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "livestock_climate_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "restaurants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "cameraId" UUID,
    "ownerId" UUID,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "restaurants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurant_customers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "phone_hash" TEXT,
    "knownFaceId" UUID,
    "points" INTEGER NOT NULL DEFAULT 0,
    "tier" TEXT NOT NULL DEFAULT 'BRONZE',
    "consentFace" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "restaurant_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_items" (
    "id" UUID NOT NULL,
    "restaurantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "priceTHB" DOUBLE PRECISION NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'FOOD',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_lines" (
    "id" UUID NOT NULL,
    "menuId" UUID NOT NULL,
    "inventoryItemId" UUID,
    "farmCrop" TEXT,
    "qtyGram" DOUBLE PRECISION NOT NULL,
    "isSelfProduced" BOOLEAN NOT NULL DEFAULT true,
    "isOptional" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "recipe_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurant_orders" (
    "id" UUID NOT NULL,
    "orderNo" TEXT NOT NULL,
    "restaurantId" UUID NOT NULL,
    "customerId" UUID,
    "tableNo" TEXT,
    "type" TEXT NOT NULL DEFAULT 'DINE_IN',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "totalTHB" DOUBLE PRECISION NOT NULL,
    "payment" TEXT,
    "pointsEarned" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "restaurant_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurant_order_lines" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "menuId" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "priceAtOrder" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "restaurant_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "livestock_vision_reports" (
    "id" UUID NOT NULL,
    "livestockGroupId" UUID NOT NULL,
    "model" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "symptomsJson" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "livestock_vision_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "herb_beds" (
    "id" UUID NOT NULL,
    "plot_id" UUID NOT NULL,
    "herbId" TEXT NOT NULL,
    "area_sqm" DOUBLE PRECISION,
    "plantedAt" TIMESTAMPTZ,
    "status" TEXT NOT NULL DEFAULT 'growing',

    CONSTRAINT "herb_beds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_matrix" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "skill" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "note" TEXT,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "skill_matrix_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crisis_modes" (
    "id" UUID NOT NULL,
    "mode" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "actions" JSONB NOT NULL,
    "activatedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crisis_modes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "herb_catalogs" (
    "id" UUID NOT NULL,
    "herbId" TEXT NOT NULL,
    "thaiName" TEXT NOT NULL,
    "latinName" TEXT,
    "uses" JSONB NOT NULL,
    "warnings" JSONB NOT NULL,
    "contraindications" JSONB NOT NULL,
    "growthDays" INTEGER,
    "idealSoil" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "herb_catalogs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurant_waste_logs" (
    "id" UUID NOT NULL,
    "restaurantId" UUID,
    "inventoryItemId" UUID,
    "qtyKg" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'kg',
    "reason" TEXT NOT NULL DEFAULT 'spoiled',
    "note" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restaurant_waste_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compost_batches" (
    "id" UUID NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'hot',
    "status" TEXT NOT NULL DEFAULT 'active',
    "inputKg" DOUBLE PRECISION NOT NULL,
    "outputKg" DOUBLE PRECISION,
    "npkEstimate" JSONB,
    "startAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estReadyAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compost_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fertilizer_applications" (
    "id" UUID NOT NULL,
    "plotId" UUID NOT NULL,
    "compostBatchId" UUID,
    "inventoryItemId" UUID,
    "qtyKg" DOUBLE PRECISION NOT NULL,
    "appliedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "fertilizer_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_snapshots" (
    "id" UUID NOT NULL,
    "capturedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "domain" TEXT NOT NULL,
    "features" JSONB NOT NULL,
    "label" JSONB,
    "source" TEXT NOT NULL DEFAULT 'auto',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_predictions" (
    "id" UUID NOT NULL,
    "snapshotId" UUID,
    "domain" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION,
    "actual" JSONB,
    "correct" BOOLEAN,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evaluatedAt" TIMESTAMPTZ,

    CONSTRAINT "learning_predictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_model_states" (
    "id" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "trainedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "prompt" TEXT,
    "stats" JSONB,

    CONSTRAINT "learning_model_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "businesses" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "bizType" TEXT NOT NULL DEFAULT 'IOT_RETAIL',
    "vatRate" DOUBLE PRECISION NOT NULL DEFAULT 0.07,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "shopName" TEXT,
    "shopOpen" BOOLEAN NOT NULL DEFAULT false,
    "shopPromptPay" TEXT,
    "shopInCommunity" BOOLEAN NOT NULL DEFAULT false,
    "taxId" TEXT,
    "taxid_hash" TEXT,
    "address" TEXT,
    "ownerId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_members" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "position" TEXT NOT NULL DEFAULT 'VIEWER',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_products" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "specs" TEXT,
    "costPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "salePrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stockQty" INTEGER NOT NULL DEFAULT 0,
    "reorderPoint" INTEGER NOT NULL DEFAULT 0,
    "warrantyMonths" INTEGER NOT NULL DEFAULT 0,
    "inventoryItemId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "business_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_customers" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "phone_hash" TEXT,
    "lineId" TEXT,
    "address" TEXT,
    "taxId" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'ONLINE',
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "business_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_orders" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "orderNo" TEXT NOT NULL,
    "customerId" UUID,
    "channel" TEXT NOT NULL DEFAULT 'ONLINE',
    "status" TEXT NOT NULL DEFAULT 'QUOTE',
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "vat" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "assignedToId" UUID,
    "note" TEXT,
    "publicToken" TEXT,
    "partnerId" TEXT,
    "shippingStatus" TEXT,
    "shippingCarrier" TEXT,
    "shippingTracking" TEXT,
    "shippedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "business_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_order_lines" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "description" TEXT,

    CONSTRAINT "business_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_payments" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'CASH',
    "reference" TEXT,
    "confirmToken" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "whtAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_slips" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "orderId" UUID,
    "provider" TEXT NOT NULL DEFAULT 'MANUAL',
    "transRef" TEXT,
    "amountSatang" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "imageMime" TEXT NOT NULL,
    "imageSha256" TEXT NOT NULL,
    "imageSize" INTEGER NOT NULL,
    "imageData" BYTEA NOT NULL,
    "note" TEXT,
    "uploadedBy" UUID,
    "reviewedBy" UUID,
    "reviewedAt" TIMESTAMPTZ,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payment_slips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_suppliers" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "phone_hash" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_purchase_orders" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitCost" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedAt" TIMESTAMPTZ,

    CONSTRAINT "business_purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_installations" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "orderId" UUID,
    "title" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "technicianId" UUID,
    "checklist" JSONB,
    "status" TEXT NOT NULL DEFAULT 'TODO',
    "note" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ,

    CONSTRAINT "business_installations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_ledger_entries" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'SALES',
    "amount" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "vatAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "whtAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "refOrderId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_agents" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "emoji" TEXT NOT NULL DEFAULT '🤖',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_lots" (
    "id" UUID NOT NULL,
    "lotCode" TEXT NOT NULL,
    "inventoryItemId" UUID,
    "plotId" UUID,
    "crop" TEXT,
    "quantityKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "harvestedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "soldCustomerId" UUID,
    "soldAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "product_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trace_events" (
    "id" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trace_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'in_flight',
    "responseCode" INTEGER,
    "responseBody" JSONB,
    "userId" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_ecosystem_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'custom',
    "label" TEXT NOT NULL,
    "url" TEXT,
    "login_id" TEXT,
    "password_enc" TEXT,
    "notes" TEXT,
    "category" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_used_at" TIMESTAMPTZ,
    "password_updated_at" TIMESTAMPTZ,
    "primary_account_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_ecosystem_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_posts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'text',
    "title" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "link" TEXT,
    "video_name" TEXT,
    "video_size" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "social_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_post_targets" (
    "id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "platform" TEXT NOT NULL,
    "account_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "external_url" TEXT,
    "external_id" TEXT,
    "posted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "social_post_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_conflict_logs" (
    "id" UUID NOT NULL,
    "mutation_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "conflict_reason" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" TEXT,
    "note" TEXT,

    CONSTRAINT "sync_conflict_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invite_codes_code_hash_key" ON "invite_codes"("code_hash");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "alert_events_created_at_idx" ON "alert_events"("created_at" DESC);

-- CreateIndex
CREATE INDEX "alert_events_event_key_idx" ON "alert_events"("event_key");

-- CreateIndex
CREATE INDEX "feedback_notes_created_at_idx" ON "feedback_notes"("created_at" DESC);

-- CreateIndex
CREATE INDEX "feedback_notes_useful_idx" ON "feedback_notes"("useful");

-- CreateIndex
CREATE INDEX "partners_status_idx" ON "partners"("status");

-- CreateIndex
CREATE INDEX "partners_created_at_idx" ON "partners"("created_at" DESC);

-- CreateIndex
CREATE INDEX "partners_phone_hash_idx" ON "partners"("phone_hash");

-- CreateIndex
CREATE INDEX "partners_contact_phone_hash_idx" ON "partners"("contact_phone_hash");

-- CreateIndex
CREATE INDEX "visitor_events_created_at_idx" ON "visitor_events"("created_at" DESC);

-- CreateIndex
CREATE INDEX "visitor_events_kind_idx" ON "visitor_events"("kind");

-- CreateIndex
CREATE INDEX "energy_readings_node_id_device_id_metric_read_at_idx" ON "energy_readings"("node_id", "device_id", "metric", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "energy_thresholds_scope_scopeName_metric_key" ON "energy_thresholds"("scope", "scopeName", "metric");

-- CreateIndex
CREATE INDEX "asset_positions_user_id_idx" ON "asset_positions"("user_id");

-- CreateIndex
CREATE INDEX "asset_positions_strategy_family_idx" ON "asset_positions"("strategy_family");

-- CreateIndex
CREATE UNIQUE INDEX "personal_balance_sheets_user_id_key" ON "personal_balance_sheets"("user_id");

-- CreateIndex
CREATE INDEX "survival_runways_user_id_snapshot_at_idx" ON "survival_runways"("user_id", "snapshot_at");

-- CreateIndex
CREATE INDEX "treasury_events_user_id_created_at_idx" ON "treasury_events"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_orders_ref_code_key" ON "transfer_orders"("ref_code");

-- CreateIndex
CREATE INDEX "transfer_orders_user_id_created_at_idx" ON "transfer_orders"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "transfer_orders_status_idx" ON "transfer_orders"("status");

-- CreateIndex
CREATE UNIQUE INDEX "dime_statements_message_id_key" ON "dime_statements"("message_id");

-- CreateIndex
CREATE UNIQUE INDEX "dime_statements_raw_text_hash_key" ON "dime_statements"("raw_text_hash");

-- CreateIndex
CREATE INDEX "dime_statements_user_id_parsed_at_idx" ON "dime_statements"("user_id", "parsed_at");

-- CreateIndex
CREATE INDEX "wealth_history_user_id_timestamp_idx" ON "wealth_history"("user_id", "timestamp");

-- CreateIndex
CREATE INDEX "asset_prices_symbol_time_idx" ON "asset_prices"("symbol", "time");

-- CreateIndex
CREATE UNIQUE INDEX "asset_prices_symbol_time_source_key" ON "asset_prices"("symbol", "time", "source");

-- CreateIndex
CREATE INDEX "inventory_items_user_id_idx" ON "inventory_items"("user_id");

-- CreateIndex
CREATE INDEX "user_feature_grants_user_id_idx" ON "user_feature_grants"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_feature_grants_user_id_feature_key" ON "user_feature_grants"("user_id", "feature");

-- CreateIndex
CREATE INDEX "farm_plots_status_idx" ON "farm_plots"("status");

-- CreateIndex
CREATE INDEX "farm_plots_category_idx" ON "farm_plots"("category");

-- CreateIndex
CREATE INDEX "farm_plots_expected_harvest_at_idx" ON "farm_plots"("expected_harvest_at");

-- CreateIndex
CREATE INDEX "farm_soil_readings_plot_id_recorded_at_idx" ON "farm_soil_readings"("plot_id", "recorded_at");

-- CreateIndex
CREATE INDEX "health_observations_user_id_category_observed_at_idx" ON "health_observations"("user_id", "category", "observed_at");

-- CreateIndex
CREATE INDEX "health_observations_user_id_observed_at_idx" ON "health_observations"("user_id", "observed_at");

-- CreateIndex
CREATE INDEX "health_flags_user_id_status_idx" ON "health_flags"("user_id", "status");

-- CreateIndex
CREATE INDEX "health_flags_status_idx" ON "health_flags"("status");

-- CreateIndex
CREATE INDEX "user_consents_user_id_idx" ON "user_consents"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_consents_user_id_purpose_key" ON "user_consents"("user_id", "purpose");

-- CreateIndex
CREATE INDEX "consent_events_user_id_created_at_idx" ON "consent_events"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "health_consents_user_id_idx" ON "health_consents"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "health_consents_user_id_category_key" ON "health_consents"("user_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "health_profiles_user_id_key" ON "health_profiles"("user_id");

-- CreateIndex
CREATE INDEX "health_readings_user_id_type_measured_at_idx" ON "health_readings"("user_id", "type", "measured_at");

-- CreateIndex
CREATE INDEX "health_readings_type_measured_at_idx" ON "health_readings"("type", "measured_at");

-- CreateIndex
CREATE INDEX "detection_events_detected_at_idx" ON "detection_events"("detected_at");

-- CreateIndex
CREATE INDEX "water_quality_readings_tank_name_measured_at_idx" ON "water_quality_readings"("tank_name", "measured_at");

-- CreateIndex
CREATE INDEX "radio_messages_received_at_idx" ON "radio_messages"("received_at");

-- CreateIndex
CREATE UNIQUE INDEX "risk_headlines_link_key" ON "risk_headlines"("link");

-- CreateIndex
CREATE INDEX "risk_headlines_published_idx" ON "risk_headlines"("published");

-- CreateIndex
CREATE INDEX "threat_index_timestamp_idx" ON "threat_index"("timestamp");

-- CreateIndex
CREATE INDEX "defcon_events_timestamp_idx" ON "defcon_events"("timestamp");

-- CreateIndex
CREATE INDEX "knowledge_items_type_idx" ON "knowledge_items"("type");

-- CreateIndex
CREATE INDEX "kid_lesson_progress_kid_id_completed_at_idx" ON "kid_lesson_progress"("kid_id", "completed_at");

-- CreateIndex
CREATE INDEX "kid_lesson_progress_curriculum_item_id_idx" ON "kid_lesson_progress"("curriculum_item_id");

-- CreateIndex
CREATE INDEX "kid_chores_kid_id_idx" ON "kid_chores"("kid_id");

-- CreateIndex
CREATE INDEX "kid_bills_kid_id_idx" ON "kid_bills"("kid_id");

-- CreateIndex
CREATE INDEX "kid_wallet_txs_kid_id_created_at_idx" ON "kid_wallet_txs"("kid_id", "created_at");

-- CreateIndex
CREATE INDEX "kid_piggy_txs_kid_id_created_at_idx" ON "kid_piggy_txs"("kid_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "kid_investments_kid_id_symbol_key" ON "kid_investments"("kid_id", "symbol");

-- CreateIndex
CREATE INDEX "kid_audit_logs_kid_id_created_at_idx" ON "kid_audit_logs"("kid_id", "created_at");

-- CreateIndex
CREATE INDEX "kid_coupons_kid_id_idx" ON "kid_coupons"("kid_id");

-- CreateIndex
CREATE INDEX "kid_certificates_kid_id_created_at_idx" ON "kid_certificates"("kid_id", "created_at");

-- CreateIndex
CREATE INDEX "kid_portfolio_deposits_kid_id_created_at_idx" ON "kid_portfolio_deposits"("kid_id", "created_at");

-- CreateIndex
CREATE INDEX "kid_portfolio_snapshots_kid_id_created_at_idx" ON "kid_portfolio_snapshots"("kid_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "curriculum_tracks_code_key" ON "curriculum_tracks"("code");

-- CreateIndex
CREATE INDEX "curriculum_items_track_id_idx" ON "curriculum_items"("track_id");

-- CreateIndex
CREATE UNIQUE INDEX "curriculum_items_track_id_sequence_key" ON "curriculum_items"("track_id", "sequence");

-- CreateIndex
CREATE INDEX "agent_jobs_status_created_at_idx" ON "agent_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "agent_jobs_status_machine_id_idx" ON "agent_jobs"("status", "machine_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_machines_token_hash_key" ON "agent_machines"("token_hash");

-- CreateIndex
CREATE INDEX "agent_machines_role_idx" ON "agent_machines"("role");

-- CreateIndex
CREATE INDEX "agent_machines_owner_user_id_idx" ON "agent_machines"("owner_user_id");

-- CreateIndex
CREATE INDEX "agent_machine_hubs_user_id_idx" ON "agent_machine_hubs"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "fleet_sites_name_key" ON "fleet_sites"("name");

-- CreateIndex
CREATE UNIQUE INDEX "fleet_groups_name_key" ON "fleet_groups"("name");

-- CreateIndex
CREATE INDEX "fleet_groups_site_id_idx" ON "fleet_groups"("site_id");

-- CreateIndex
CREATE INDEX "fleet_rollouts_channel_created_at_idx" ON "fleet_rollouts"("channel", "created_at");

-- CreateIndex
CREATE INDEX "fleet_machine_overrides_channel_idx" ON "fleet_machine_overrides"("channel");

-- CreateIndex
CREATE INDEX "fleet_machine_overrides_site_id_idx" ON "fleet_machine_overrides"("site_id");

-- CreateIndex
CREATE INDEX "fleet_machine_overrides_group_id_idx" ON "fleet_machine_overrides"("group_id");

-- CreateIndex
CREATE UNIQUE INDEX "fleet_enrollment_tokens_token_hash_key" ON "fleet_enrollment_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "fleet_enrollment_tokens_expires_at_idx" ON "fleet_enrollment_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "fleet_enrollment_tokens_revoked_at_idx" ON "fleet_enrollment_tokens"("revoked_at");

-- CreateIndex
CREATE INDEX "fleet_enrollment_tokens_created_at_idx" ON "fleet_enrollment_tokens"("created_at");

-- CreateIndex
CREATE INDEX "fleet_enrollment_uses_token_id_used_at_idx" ON "fleet_enrollment_uses"("token_id", "used_at");

-- CreateIndex
CREATE INDEX "vision_alerts_created_at_idx" ON "vision_alerts"("created_at");

-- CreateIndex
CREATE INDEX "scenario_forecasts_generatedAt_idx" ON "scenario_forecasts"("generatedAt");

-- CreateIndex
CREATE INDEX "chat_messages_actor_created_at_idx" ON "chat_messages"("actor", "created_at");

-- CreateIndex
CREATE INDEX "strategic_points_enabled_idx" ON "strategic_points"("enabled");

-- CreateIndex
CREATE INDEX "meditation_sessions_user_id_started_at_idx" ON "meditation_sessions"("user_id", "started_at");

-- CreateIndex
CREATE INDEX "healing_logs_user_id_logged_at_idx" ON "healing_logs"("user_id", "logged_at");

-- CreateIndex
CREATE INDEX "threat_intel_items_active_idx" ON "threat_intel_items"("active");

-- CreateIndex
CREATE UNIQUE INDEX "threat_intel_items_type_value_key" ON "threat_intel_items"("type", "value");

-- CreateIndex
CREATE UNIQUE INDEX "livestock_groups_code_key" ON "livestock_groups"("code");

-- CreateIndex
CREATE INDEX "livestock_groups_species_idx" ON "livestock_groups"("species");

-- CreateIndex
CREATE INDEX "livestock_groups_status_idx" ON "livestock_groups"("status");

-- CreateIndex
CREATE INDEX "livestock_groups_quarantineEndAt_idx" ON "livestock_groups"("quarantineEndAt");

-- CreateIndex
CREATE INDEX "livestock_medical_records_livestockGroupId_safeHarvestDate_idx" ON "livestock_medical_records"("livestockGroupId", "safeHarvestDate");

-- CreateIndex
CREATE INDEX "livestock_medical_records_safeHarvestDate_idx" ON "livestock_medical_records"("safeHarvestDate");

-- CreateIndex
CREATE INDEX "livestock_vaccine_schedules_livestockGroupId_isCompleted_idx" ON "livestock_vaccine_schedules"("livestockGroupId", "isCompleted");

-- CreateIndex
CREATE INDEX "livestock_daily_logs_livestockGroupId_logDate_idx" ON "livestock_daily_logs"("livestockGroupId", "logDate");

-- CreateIndex
CREATE UNIQUE INDEX "livestock_daily_logs_livestockGroupId_logDate_key" ON "livestock_daily_logs"("livestockGroupId", "logDate");

-- CreateIndex
CREATE UNIQUE INDEX "livestock_feed_silos_siloCode_key" ON "livestock_feed_silos"("siloCode");

-- CreateIndex
CREATE INDEX "livestock_biosecurity_logs_passedGate_entryTime_idx" ON "livestock_biosecurity_logs"("passedGate", "entryTime");

-- CreateIndex
CREATE INDEX "livestock_breeding_records_livestockGroupId_status_idx" ON "livestock_breeding_records"("livestockGroupId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "livestock_batch_financials_batchCode_key" ON "livestock_batch_financials"("batchCode");

-- CreateIndex
CREATE INDEX "livestock_batch_financials_livestockGroupId_idx" ON "livestock_batch_financials"("livestockGroupId");

-- CreateIndex
CREATE INDEX "livestock_utility_alerts_houseCode_idx" ON "livestock_utility_alerts"("houseCode");

-- CreateIndex
CREATE INDEX "restaurant_customers_phone_idx" ON "restaurant_customers"("phone");

-- CreateIndex
CREATE INDEX "restaurant_customers_phone_hash_idx" ON "restaurant_customers"("phone_hash");

-- CreateIndex
CREATE INDEX "menu_items_restaurantId_idx" ON "menu_items"("restaurantId");

-- CreateIndex
CREATE INDEX "recipe_lines_menuId_idx" ON "recipe_lines"("menuId");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_orders_orderNo_key" ON "restaurant_orders"("orderNo");

-- CreateIndex
CREATE INDEX "restaurant_orders_restaurantId_createdAt_idx" ON "restaurant_orders"("restaurantId", "createdAt");

-- CreateIndex
CREATE INDEX "restaurant_orders_customerId_idx" ON "restaurant_orders"("customerId");

-- CreateIndex
CREATE INDEX "restaurant_order_lines_orderId_idx" ON "restaurant_order_lines"("orderId");

-- CreateIndex
CREATE INDEX "livestock_vision_reports_livestockGroupId_created_at_idx" ON "livestock_vision_reports"("livestockGroupId", "created_at");

-- CreateIndex
CREATE INDEX "herb_beds_plot_id_status_idx" ON "herb_beds"("plot_id", "status");

-- CreateIndex
CREATE INDEX "skill_matrix_skill_idx" ON "skill_matrix"("skill");

-- CreateIndex
CREATE UNIQUE INDEX "skill_matrix_user_id_skill_key" ON "skill_matrix"("user_id", "skill");

-- CreateIndex
CREATE UNIQUE INDEX "crisis_modes_mode_key" ON "crisis_modes"("mode");

-- CreateIndex
CREATE UNIQUE INDEX "herb_catalogs_herbId_key" ON "herb_catalogs"("herbId");

-- CreateIndex
CREATE INDEX "restaurant_waste_logs_restaurantId_createdAt_idx" ON "restaurant_waste_logs"("restaurantId", "createdAt");

-- CreateIndex
CREATE INDEX "restaurant_waste_logs_reason_idx" ON "restaurant_waste_logs"("reason");

-- CreateIndex
CREATE INDEX "compost_batches_status_estReadyAt_idx" ON "compost_batches"("status", "estReadyAt");

-- CreateIndex
CREATE INDEX "fertilizer_applications_plotId_appliedAt_idx" ON "fertilizer_applications"("plotId", "appliedAt");

-- CreateIndex
CREATE INDEX "learning_snapshots_domain_capturedAt_idx" ON "learning_snapshots"("domain", "capturedAt");

-- CreateIndex
CREATE INDEX "learning_snapshots_capturedAt_idx" ON "learning_snapshots"("capturedAt");

-- CreateIndex
CREATE INDEX "learning_predictions_domain_createdAt_idx" ON "learning_predictions"("domain", "createdAt");

-- CreateIndex
CREATE INDEX "learning_predictions_model_idx" ON "learning_predictions"("model");

-- CreateIndex
CREATE UNIQUE INDEX "learning_model_states_domain_key" ON "learning_model_states"("domain");

-- CreateIndex
CREATE INDEX "business_members_userId_idx" ON "business_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "business_members_businessId_userId_key" ON "business_members"("businessId", "userId");

-- CreateIndex
CREATE INDEX "business_products_businessId_isActive_idx" ON "business_products"("businessId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "business_products_businessId_sku_key" ON "business_products"("businessId", "sku");

-- CreateIndex
CREATE INDEX "business_customers_businessId_phone_idx" ON "business_customers"("businessId", "phone");

-- CreateIndex
CREATE INDEX "business_customers_businessId_phone_hash_idx" ON "business_customers"("businessId", "phone_hash");

-- CreateIndex
CREATE UNIQUE INDEX "business_orders_publicToken_key" ON "business_orders"("publicToken");

-- CreateIndex
CREATE INDEX "business_orders_businessId_status_idx" ON "business_orders"("businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "business_orders_businessId_orderNo_key" ON "business_orders"("businessId", "orderNo");

-- CreateIndex
CREATE INDEX "business_order_lines_orderId_idx" ON "business_order_lines"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "business_payments_confirmToken_key" ON "business_payments"("confirmToken");

-- CreateIndex
CREATE INDEX "business_payments_orderId_idx" ON "business_payments"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_slips_imageSha256_key" ON "payment_slips"("imageSha256");

-- CreateIndex
CREATE INDEX "payment_slips_businessId_status_createdAt_idx" ON "payment_slips"("businessId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "payment_slips_orderId_idx" ON "payment_slips"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_slips_provider_transRef_key" ON "payment_slips"("provider", "transRef");

-- CreateIndex
CREATE INDEX "business_installations_businessId_status_idx" ON "business_installations"("businessId", "status");

-- CreateIndex
CREATE INDEX "business_ledger_entries_businessId_createdAt_idx" ON "business_ledger_entries"("businessId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "business_agents_businessId_key_key" ON "business_agents"("businessId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "product_lots_lotCode_key" ON "product_lots"("lotCode");

-- CreateIndex
CREATE INDEX "product_lots_inventoryItemId_idx" ON "product_lots"("inventoryItemId");

-- CreateIndex
CREATE INDEX "product_lots_plotId_idx" ON "product_lots"("plotId");

-- CreateIndex
CREATE INDEX "trace_events_lotId_idx" ON "trace_events"("lotId");

-- CreateIndex
CREATE INDEX "idempotency_keys_expiresAt_idx" ON "idempotency_keys"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_scope_key_key" ON "idempotency_keys"("scope", "key");

-- CreateIndex
CREATE INDEX "user_ecosystem_accounts_user_id_platform_idx" ON "user_ecosystem_accounts"("user_id", "platform");

-- CreateIndex
CREATE INDEX "user_ecosystem_accounts_user_id_status_idx" ON "user_ecosystem_accounts"("user_id", "status");

-- CreateIndex
CREATE INDEX "user_ecosystem_accounts_primary_account_id_idx" ON "user_ecosystem_accounts"("primary_account_id");

-- CreateIndex
CREATE INDEX "social_posts_user_id_created_at_idx" ON "social_posts"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "social_post_targets_account_id_idx" ON "social_post_targets"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "social_post_targets_post_id_platform_key" ON "social_post_targets"("post_id", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "sync_conflict_logs_mutation_id_key" ON "sync_conflict_logs"("mutation_id");

-- CreateIndex
CREATE INDEX "sync_conflict_logs_status_created_at_idx" ON "sync_conflict_logs"("status", "created_at");

-- CreateIndex
CREATE INDEX "sync_conflict_logs_user_id_status_idx" ON "sync_conflict_logs"("user_id", "status");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_assigned_node_id_fkey" FOREIGN KEY ("assigned_node_id") REFERENCES "nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_assigned_site_id_fkey" FOREIGN KEY ("assigned_site_id") REFERENCES "fleet_sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relays" ADD CONSTRAINT "relays_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relay_schedules" ADD CONSTRAINT "relay_schedules_relay_id_fkey" FOREIGN KEY ("relay_id") REFERENCES "relays"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sensor_telemetry" ADD CONSTRAINT "sensor_telemetry_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_positions" ADD CONSTRAINT "asset_positions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_balance_sheets" ADD CONSTRAINT "personal_balance_sheets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survival_runways" ADD CONSTRAINT "survival_runways_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_events" ADD CONSTRAINT "treasury_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_events" ADD CONSTRAINT "treasury_events_asset_position_id_fkey" FOREIGN KEY ("asset_position_id") REFERENCES "asset_positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_orders" ADD CONSTRAINT "transfer_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dime_statements" ADD CONSTRAINT "dime_statements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wealth_history" ADD CONSTRAINT "wealth_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_feature_grants" ADD CONSTRAINT "user_feature_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farm_soil_readings" ADD CONSTRAINT "farm_soil_readings_plot_id_fkey" FOREIGN KEY ("plot_id") REFERENCES "farm_plots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_observations" ADD CONSTRAINT "health_observations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_flags" ADD CONSTRAINT "health_flags_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_consents" ADD CONSTRAINT "user_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_consents" ADD CONSTRAINT "health_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_profiles" ADD CONSTRAINT "health_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_readings" ADD CONSTRAINT "health_readings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detection_events" ADD CONSTRAINT "detection_events_camera_id_fkey" FOREIGN KEY ("camera_id") REFERENCES "cameras"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_hours_logs" ADD CONSTRAINT "run_hours_logs_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kid_lesson_progress" ADD CONSTRAINT "kid_lesson_progress_kid_id_fkey" FOREIGN KEY ("kid_id") REFERENCES "kid_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kid_lesson_progress" ADD CONSTRAINT "kid_lesson_progress_curriculum_item_id_fkey" FOREIGN KEY ("curriculum_item_id") REFERENCES "curriculum_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kid_chores" ADD CONSTRAINT "kid_chores_kid_id_fkey" FOREIGN KEY ("kid_id") REFERENCES "kid_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kid_bills" ADD CONSTRAINT "kid_bills_kid_id_fkey" FOREIGN KEY ("kid_id") REFERENCES "kid_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kid_wallet_txs" ADD CONSTRAINT "kid_wallet_txs_kid_id_fkey" FOREIGN KEY ("kid_id") REFERENCES "kid_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kid_piggy_txs" ADD CONSTRAINT "kid_piggy_txs_kid_id_fkey" FOREIGN KEY ("kid_id") REFERENCES "kid_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kid_investments" ADD CONSTRAINT "kid_investments_kid_id_fkey" FOREIGN KEY ("kid_id") REFERENCES "kid_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kid_audit_logs" ADD CONSTRAINT "kid_audit_logs_kid_id_fkey" FOREIGN KEY ("kid_id") REFERENCES "kid_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kid_coupons" ADD CONSTRAINT "kid_coupons_kid_id_fkey" FOREIGN KEY ("kid_id") REFERENCES "kid_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kid_certificates" ADD CONSTRAINT "kid_certificates_kid_id_fkey" FOREIGN KEY ("kid_id") REFERENCES "kid_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kid_portfolio_deposits" ADD CONSTRAINT "kid_portfolio_deposits_kid_id_fkey" FOREIGN KEY ("kid_id") REFERENCES "kid_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kid_portfolio_snapshots" ADD CONSTRAINT "kid_portfolio_snapshots_kid_id_fkey" FOREIGN KEY ("kid_id") REFERENCES "kid_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curriculum_items" ADD CONSTRAINT "curriculum_items_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "curriculum_tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "agent_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "agent_machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_machines" ADD CONSTRAINT "agent_machines_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_machine_hubs" ADD CONSTRAINT "agent_machine_hubs_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "agent_machines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_machine_hubs" ADD CONSTRAINT "agent_machine_hubs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_groups" ADD CONSTRAINT "fleet_groups_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "fleet_sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_machine_overrides" ADD CONSTRAINT "fleet_machine_overrides_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "agent_machines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_machine_overrides" ADD CONSTRAINT "fleet_machine_overrides_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "fleet_sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_machine_overrides" ADD CONSTRAINT "fleet_machine_overrides_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "fleet_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_enrollment_uses" ADD CONSTRAINT "fleet_enrollment_uses_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "fleet_enrollment_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meditation_sessions" ADD CONSTRAINT "meditation_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "healing_logs" ADD CONSTRAINT "healing_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "livestock_medical_records" ADD CONSTRAINT "livestock_medical_records_livestockGroupId_fkey" FOREIGN KEY ("livestockGroupId") REFERENCES "livestock_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "livestock_vaccine_schedules" ADD CONSTRAINT "livestock_vaccine_schedules_livestockGroupId_fkey" FOREIGN KEY ("livestockGroupId") REFERENCES "livestock_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "livestock_daily_logs" ADD CONSTRAINT "livestock_daily_logs_livestockGroupId_fkey" FOREIGN KEY ("livestockGroupId") REFERENCES "livestock_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "livestock_breeding_records" ADD CONSTRAINT "livestock_breeding_records_livestockGroupId_fkey" FOREIGN KEY ("livestockGroupId") REFERENCES "livestock_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "livestock_batch_financials" ADD CONSTRAINT "livestock_batch_financials_livestockGroupId_fkey" FOREIGN KEY ("livestockGroupId") REFERENCES "livestock_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_orders" ADD CONSTRAINT "restaurant_orders_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_orders" ADD CONSTRAINT "restaurant_orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "restaurant_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_order_lines" ADD CONSTRAINT "restaurant_order_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "restaurant_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "livestock_vision_reports" ADD CONSTRAINT "livestock_vision_reports_livestockGroupId_fkey" FOREIGN KEY ("livestockGroupId") REFERENCES "livestock_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "herb_beds" ADD CONSTRAINT "herb_beds_plot_id_fkey" FOREIGN KEY ("plot_id") REFERENCES "farm_plots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_matrix" ADD CONSTRAINT "skill_matrix_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fertilizer_applications" ADD CONSTRAINT "fertilizer_applications_plotId_fkey" FOREIGN KEY ("plotId") REFERENCES "farm_plots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fertilizer_applications" ADD CONSTRAINT "fertilizer_applications_compostBatchId_fkey" FOREIGN KEY ("compostBatchId") REFERENCES "compost_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_predictions" ADD CONSTRAINT "learning_predictions_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "learning_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_members" ADD CONSTRAINT "business_members_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_members" ADD CONSTRAINT "business_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_products" ADD CONSTRAINT "business_products_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_customers" ADD CONSTRAINT "business_customers_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_orders" ADD CONSTRAINT "business_orders_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_orders" ADD CONSTRAINT "business_orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "business_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_order_lines" ADD CONSTRAINT "business_order_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "business_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_order_lines" ADD CONSTRAINT "business_order_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "business_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_payments" ADD CONSTRAINT "business_payments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "business_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_slips" ADD CONSTRAINT "payment_slips_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_slips" ADD CONSTRAINT "payment_slips_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "business_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_slips" ADD CONSTRAINT "payment_slips_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_slips" ADD CONSTRAINT "payment_slips_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_suppliers" ADD CONSTRAINT "business_suppliers_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_purchase_orders" ADD CONSTRAINT "business_purchase_orders_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_purchase_orders" ADD CONSTRAINT "business_purchase_orders_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "business_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_purchase_orders" ADD CONSTRAINT "business_purchase_orders_productId_fkey" FOREIGN KEY ("productId") REFERENCES "business_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_installations" ADD CONSTRAINT "business_installations_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_installations" ADD CONSTRAINT "business_installations_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "business_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_ledger_entries" ADD CONSTRAINT "business_ledger_entries_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_agents" ADD CONSTRAINT "business_agents_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_lots" ADD CONSTRAINT "product_lots_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_lots" ADD CONSTRAINT "product_lots_plotId_fkey" FOREIGN KEY ("plotId") REFERENCES "farm_plots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_lots" ADD CONSTRAINT "product_lots_soldCustomerId_fkey" FOREIGN KEY ("soldCustomerId") REFERENCES "business_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trace_events" ADD CONSTRAINT "trace_events_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "product_lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_ecosystem_accounts" ADD CONSTRAINT "user_ecosystem_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_ecosystem_accounts" ADD CONSTRAINT "user_ecosystem_accounts_primary_account_id_fkey" FOREIGN KEY ("primary_account_id") REFERENCES "user_ecosystem_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_post_targets" ADD CONSTRAINT "social_post_targets_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "social_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_post_targets" ADD CONSTRAINT "social_post_targets_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "user_ecosystem_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

