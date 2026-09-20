#!/bin/sh
# กันปัญหา "Reset failed" ซ้ำ: Prisma client (node_modules/.prisma) ถูก generate จาก
# schema เก่ากว่าโค้ด → query ที่อ้าง field ใหม่ (เช่น token_version increment) พังตอน runtime
# วิธี: checksum schema.prisma เทียบกับที่ฝังใน client — ต่างกันเท่านั้นค่อย generate (เร็ว, ไม่รบกวน start)
set -e
cd "$(dirname "$0")/.."

SCHEMA_HASH=$(sha256sum prisma/schema.prisma | cut -d' ' -f1)
CLIENT_HASH=$(sha256sum node_modules/.prisma/client/schema.prisma 2>/dev/null | cut -d' ' -f1 || echo "no-client")

if [ "$SCHEMA_HASH" != "$CLIENT_HASH" ]; then
  echo "[ensure-prisma-client] schema เปลี่ยน → generate client ใหม่..."
  npx prisma generate
else
  echo "[ensure-prisma-client] client ตรงกับ schema แล้ว — ข้าม"
fi
