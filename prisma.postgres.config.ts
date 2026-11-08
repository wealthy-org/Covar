// Prisma config for the PostgreSQL deployment (used by scripts/prisma-pg.mjs).
// The schema is DERIVED from prisma/schema.prisma; migrations are Postgres-only.
import { defineConfig } from "prisma/config";
import "dotenv/config";

export default defineConfig({
  schema: "prisma/postgres/schema.prisma",
  migrations: {
    path: "prisma/postgres/migrations",
  },
});
