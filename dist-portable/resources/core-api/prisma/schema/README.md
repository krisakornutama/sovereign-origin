generator client {
  provider = \"prisma-client-js\"
}
datasource db {
  provider = \"postgresql\"
  url      = env(\"DATABASE_URL\")
}
// Split: auth.prisma, wealth.prisma, farm.prisma, health.prisma, security.prisma
// Run: npx prisma format --schema=prisma/schema.prisma (keeps single file for now)
