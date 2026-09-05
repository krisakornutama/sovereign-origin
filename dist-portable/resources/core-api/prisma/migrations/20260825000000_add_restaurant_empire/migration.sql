-- Restaurant Empire — 6 ตาราง (ร้านอาหารจักรวรรดิ)
-- หมายเหตุ: ตารางเหล่านี้เคยสร้างบน production ด้วย SQL ตรง (2026-08-22)
-- migration นี้ทำให้ fresh deploy ได้ตารางชุดเดียวกัน + ใช้ IF NOT EXISTS กันชนกับของเดิม

CREATE TABLE IF NOT EXISTS "restaurants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "cameraId" UUID,
    "ownerId" UUID,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "restaurants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "restaurant_customers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "knownFaceId" UUID,
    "points" INTEGER NOT NULL DEFAULT 0,
    "tier" TEXT NOT NULL DEFAULT 'BRONZE',
    "consentFace" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "restaurant_customers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "menu_items" (
    "id" UUID NOT NULL,
    "restaurantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "priceTHB" DOUBLE PRECISION NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'FOOD',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "recipe_lines" (
    "id" UUID NOT NULL,
    "menuId" UUID NOT NULL,
    "inventoryItemId" UUID,
    "farmCrop" TEXT,
    "qtyGram" DOUBLE PRECISION NOT NULL,
    "isSelfProduced" BOOLEAN NOT NULL DEFAULT true,
    "isOptional" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "recipe_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "restaurant_orders" (
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
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "restaurant_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "restaurant_order_lines" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "menuId" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "priceAtOrder" DOUBLE PRECISION NOT NULL,
    CONSTRAINT "restaurant_order_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "restaurant_orders_orderNo_key" ON "restaurant_orders"("orderNo");
CREATE INDEX IF NOT EXISTS "menu_items_restaurantId_idx" ON "menu_items"("restaurantId");
CREATE INDEX IF NOT EXISTS "recipe_lines_menuId_idx" ON "recipe_lines"("menuId");
CREATE INDEX IF NOT EXISTS "restaurant_orders_restaurantId_createdAt_idx" ON "restaurant_orders"("restaurantId", "createdAt");
CREATE INDEX IF NOT EXISTS "restaurant_orders_customerId_idx" ON "restaurant_orders"("customerId");
CREATE INDEX IF NOT EXISTS "restaurant_order_lines_orderId_idx" ON "restaurant_order_lines"("orderId");
CREATE INDEX IF NOT EXISTS "restaurant_customers_phone_idx" ON "restaurant_customers"("phone");

-- Foreign keys (กันชน: ใส่เฉพาะเมื่อยังไม่มี — fresh deploy เท่านั้น)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'menu_items_restaurantId_fkey') THEN
        ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recipe_lines_menuId_fkey') THEN
        ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'restaurant_orders_restaurantId_fkey') THEN
        ALTER TABLE "restaurant_orders" ADD CONSTRAINT "restaurant_orders_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'restaurant_orders_customerId_fkey') THEN
        ALTER TABLE "restaurant_orders" ADD CONSTRAINT "restaurant_orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "restaurant_customers"("id") ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'restaurant_order_lines_orderId_fkey') THEN
        ALTER TABLE "restaurant_order_lines" ADD CONSTRAINT "restaurant_order_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "restaurant_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
