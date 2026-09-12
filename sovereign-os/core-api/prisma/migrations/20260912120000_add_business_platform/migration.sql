-- BUSINESS PLATFORM — ธุรกิจขายสินค้า IoT (11 ตาราง)
-- ตาม house convention: IF NOT EXISTS กันชนกับ fresh deploy / ของเดิม

CREATE TABLE IF NOT EXISTS "businesses" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "bizType" TEXT NOT NULL DEFAULT 'IOT_RETAIL',
    "vatRate" DOUBLE PRECISION NOT NULL DEFAULT 0.07,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "ownerId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "business_members" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "position" TEXT NOT NULL DEFAULT 'VIEWER',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "business_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "business_products" (
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
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "business_products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "business_customers" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "lineId" TEXT,
    "address" TEXT,
    "taxId" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'ONLINE',
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "business_customers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "business_orders" (
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
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "business_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "business_order_lines" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "description" TEXT,
    CONSTRAINT "business_order_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "business_payments" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'CASH',
    "reference" TEXT,
    "paidAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "business_payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "business_suppliers" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "business_suppliers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "business_purchase_orders" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitCost" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedAt" TIMESTAMPTZ(6),
    CONSTRAINT "business_purchase_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "business_installations" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "orderId" UUID,
    "title" TEXT NOT NULL,
    "scheduledAt" TIMESTAMPTZ(6),
    "technicianId" UUID,
    "checklist" JSONB,
    "status" TEXT NOT NULL DEFAULT 'TODO',
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(6),
    CONSTRAINT "business_installations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "business_ledger_entries" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'SALES',
    "amount" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "refOrderId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "business_ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "business_agents" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "emoji" TEXT NOT NULL DEFAULT '🤖',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "business_agents_pkey" PRIMARY KEY ("id")
);

-- ── Foreign Keys ──
DO $$ BEGIN
  ALTER TABLE "businesses" ADD CONSTRAINT "businesses_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "business_members" ADD CONSTRAINT "business_members_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "business_members" ADD CONSTRAINT "business_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "business_products" ADD CONSTRAINT "business_products_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "business_customers" ADD CONSTRAINT "business_customers_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "business_orders" ADD CONSTRAINT "business_orders_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "business_orders" ADD CONSTRAINT "business_orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "business_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "business_order_lines" ADD CONSTRAINT "business_order_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "business_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "business_order_lines" ADD CONSTRAINT "business_order_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "business_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "business_payments" ADD CONSTRAINT "business_payments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "business_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "business_suppliers" ADD CONSTRAINT "business_suppliers_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "business_purchase_orders" ADD CONSTRAINT "business_purchase_orders_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "business_purchase_orders" ADD CONSTRAINT "business_purchase_orders_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "business_suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "business_purchase_orders" ADD CONSTRAINT "business_purchase_orders_productId_fkey" FOREIGN KEY ("productId") REFERENCES "business_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "business_installations" ADD CONSTRAINT "business_installations_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "business_installations" ADD CONSTRAINT "business_installations_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "business_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "business_ledger_entries" ADD CONSTRAINT "business_ledger_entries_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "business_agents" ADD CONSTRAINT "business_agents_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── Indexes & Unique ──
CREATE UNIQUE INDEX IF NOT EXISTS "business_members_businessId_userId_key" ON "business_members"("businessId", "userId");
CREATE INDEX IF NOT EXISTS "business_members_userId_idx" ON "business_members"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "business_products_businessId_sku_key" ON "business_products"("businessId", "sku");
CREATE INDEX IF NOT EXISTS "business_products_businessId_isActive_idx" ON "business_products"("businessId", "isActive");
CREATE INDEX IF NOT EXISTS "business_customers_businessId_phone_idx" ON "business_customers"("businessId", "phone");
CREATE UNIQUE INDEX IF NOT EXISTS "business_orders_businessId_orderNo_key" ON "business_orders"("businessId", "orderNo");
CREATE INDEX IF NOT EXISTS "business_orders_businessId_status_idx" ON "business_orders"("businessId", "status");
CREATE INDEX IF NOT EXISTS "business_order_lines_orderId_idx" ON "business_order_lines"("orderId");
CREATE INDEX IF NOT EXISTS "business_payments_orderId_idx" ON "business_payments"("orderId");
CREATE INDEX IF NOT EXISTS "business_installations_businessId_status_idx" ON "business_installations"("businessId", "status");
CREATE INDEX IF NOT EXISTS "business_ledger_entries_businessId_createdAt_idx" ON "business_ledger_entries"("businessId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "business_agents_businessId_key_key" ON "business_agents"("businessId", "key");
