-- รหัสเชิญสมัครสมาชิก (Community Edition / self-hosted)
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

CREATE UNIQUE INDEX "invite_codes_code_hash_key" ON "invite_codes"("code_hash");
