-- Fleet Phase 2 — persisted control-plane state.
--
-- NOTE: this migration is intentionally limited to fleet_* objects. Do not
-- regenerate it with `migrate diff --from-schema-datasource` against the live
-- database: the live DB contains manual/drifted objects unrelated to Fleet.

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

-- Read-only view over audit_logs for Fleet operators / SQL consumers.
CREATE OR REPLACE VIEW "fleet_audit_view" AS
SELECT "id", "timestamp", "user_id", "action_type", "payload"
FROM "audit_logs"
WHERE "action_type" LIKE 'FLEET\_%' ESCAPE '\';
