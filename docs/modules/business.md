# โมดูล business — ร้านค้า/ออเดอร์/บัญชี/ชุมชน

## เจตนา
ศูนย์กลางธุรกิจ: สินค้า ออเดอร์ ลูกค้า ซัพพลายเออร์ PO บัญชี (ledger) ภาษี รวมถึงหน้าร้านออนไลน์และตลาดชุมชน (opt-in)

## ตารางที่เป็นเจ้าของ
- `businesses` — ร้าน/ธุรกิจ (opt-in เข้าชุมชน = `shopInCommunity`)
- `business_products` · `business_customers` · `business_orders`
- `business_members` · `business_suppliers` · `business_purchase_orders`
- `business_installations` · `business_ledger_entries` · `business_agents`

## Endpoints หลัก (mounted ที่ `/api/business`)
- หน้าร้าน/ชุมชน: `GET /community` (สินค้ารวมของร้านที่ opt-in) · `GET /:businessId/shop` · `PUT /:businessId/shop`
- ออเดอร์: `POST /:businessId/orders` · `GET /:businessId/orders` · `/:id/transition` · `/:id/payments` · `/:id/shipping` · `/:id/lots`
- สินค้า/ลูกค้า: `GET|POST /:businessId/products` · `PUT /products/:id` · `GET|POST /:businessId/customers`
- บัญชี: `GET|POST /:businessId/ledger` · `patch|delete /ledger/:id` · `GET /summary` · `GET /tax`
- PO: `GET|POST /purchase-orders` · `POST /:id/receive`

## กลไกสำคัญ
- Route ใหญ่สุดของระบบ (455 บรรทัด) + service ใหญ่สุด (`business.service.ts` ~830 บรรทัด) — แก้ทีละจุด
- `business-shop.service.ts` ดูแลเฉพาะหน้าร้าน/ชุมชน (`openShopOrThrow` ฯลฯ)
- หน้า `/community` ของ frontend ยิง `GET /api/shop/community` → อ่าน catalog ผ่าน business-shop.service

## ห้ามแตะ / ระวัง
- เปลี่ยน response ของ `GET /community` ต้องเช็คหน้า `/community` + E2E `trace-community.spec.ts` ด้วยเสมอ
- ออเดอร์ผูกกับ trace (`business_orders` ↔ lots) — ลบออเดอร์กระทบประวัติตามรอย

<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
`business_agents` · `business_customers` · `business_installations` · `business_ledger_entries` · `business_members` · `business_order_lines` · `business_orders` · `business_payments` · `business_products` · `business_purchase_orders` · `business_suppliers` · `businesses`

### Routes
- `business/business-shop.routes.ts` (81 บรรทัด)
- `business/business.routes.ts` (456 บรรทัด)

### Endpoints (จาก router)
```
GET /community
GET /:businessId
POST /:businessId/orders
GET /orders/:token
POST /orders/:token/pay
GET /:businessId/promptpay
GET /
POST /
POST /:businessId/agents/seed
GET /:businessId/members
POST /:businessId/members
DELETE /:businessId/members/:memberId
GET /:businessId/products
POST /:businessId/products
PUT /:businessId/products/:id
GET /:businessId/customers
POST /:businessId/customers
GET /:businessId/orders
GET /:businessId/orders/:id
GET /:businessId/orders/:id/lots
POST /:businessId/orders/:id/shipping
POST /:businessId/orders/:id/transition
POST /:businessId/orders/:id/payments
GET /:businessId/installations
POST /:businessId/installations
POST /:businessId/installations/:id/transition
GET /:businessId/ledger
POST /:businessId/ledger
PATCH /:businessId/ledger/:id
DELETE /:businessId/ledger/:id
GET /:businessId/summary
GET /:businessId/tax
GET /:businessId/suppliers
POST /:businessId/suppliers
GET /:businessId/purchase-orders
POST /:businessId/purchase-orders
POST /:businessId/purchase-orders/:id/receive
GET /:businessId/agents
POST /:businessId/agents/:agentId/run
POST /:businessId/agents/:agentId/enabled
… อีก 4 เส้น
```

### Services ที่ทำงานให้โมดูลนี้
`business-shop.service` · `business.service`

### เส้นข้ามที่ยอมรับแล้ว (boundary-baseline)
- business → agent(agent_jobs)
- business → agent(agent_roles)
- business → auth(users)

<!-- auto:end -->

<!-- auto:begin — ส่วนนี้ gen จากโค้ดจริง (node tools/gen-module-docs.mjs) ห้ามแก้มือ -->

## ของจริงในโค้ด (auto-generated)

### ตารางที่เป็นเจ้าของ
`business_agents` · `business_customers` · `business_installations` · `business_ledger_entries` · `business_members` · `business_order_lines` · `business_orders` · `business_payments` · `business_products` · `business_purchase_orders` · `business_suppliers` · `businesses`

### Routes
- `business/business-shop.routes.ts` (108 บรรทัด)
- `business/business.routes.ts` (468 บรรทัด)

### Endpoints (จาก router)
```
GET /transparency
GET /community
GET /:businessId
POST /:businessId/orders
GET /orders/:token
POST /orders/:token/pay
GET /:businessId/promptpay
GET /
POST /
POST /:businessId/agents/seed
GET /:businessId/members
POST /:businessId/members
DELETE /:businessId/members/:memberId
GET /:businessId/products
POST /:businessId/products
PUT /:businessId/products/:id
GET /:businessId/customers
POST /:businessId/customers
GET /:businessId/orders
GET /:businessId/orders/:id
GET /:businessId/orders/:id/lots
POST /:businessId/orders/:id/shipping
POST /:businessId/orders/:id/transition
POST /:businessId/orders/:id/payments
GET /:businessId/installations
POST /:businessId/installations
POST /:businessId/installations/:id/transition
GET /:businessId/ledger
POST /:businessId/ledger
PATCH /:businessId/ledger/:id
DELETE /:businessId/ledger/:id
GET /:businessId/summary
GET /:businessId/tax
GET /:businessId/suppliers
POST /:businessId/suppliers
GET /:businessId/purchase-orders
POST /:businessId/purchase-orders
POST /:businessId/purchase-orders/:id/receive
GET /:businessId/agents
POST /:businessId/agents/:agentId/run
… อีก 5 เส้น
```

### Services ที่ทำงานให้โมดูลนี้
`business-shop.service` · `business.service`

### เส้นข้ามที่ยอมรับแล้ว (boundary-baseline)
- business → agent(agent_jobs)
- business → agent(agent_roles)
- business → auth(users)

<!-- auto:end -->
