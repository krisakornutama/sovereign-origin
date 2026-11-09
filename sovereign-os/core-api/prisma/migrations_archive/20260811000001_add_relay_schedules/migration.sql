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

-- AddForeignKey
ALTER TABLE "relay_schedules" ADD CONSTRAINT "relay_schedules_relay_id_fkey" FOREIGN KEY ("relay_id") REFERENCES "relays"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
