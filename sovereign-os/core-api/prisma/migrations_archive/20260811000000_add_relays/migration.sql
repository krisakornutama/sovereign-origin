-- CreateTable
CREATE TABLE "relays" (
    "id" TEXT NOT NULL,
    "node_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "state" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "relays_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "relays" ADD CONSTRAINT "relays_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
