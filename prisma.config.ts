import { defineConfig } from "prisma/config";
import "dotenv/config";

// Local dev = SQLite. An empty DATABASE_URL (older .env files had `DATABASE_URL=`)
// falls back to the dev database instead of failing schema validation.
// A Postgres URL here is a mistake: this config is the SQLite one; the shared
// Postgres deployment uses `pnpm db:pg:*` (prisma.postgres.config.ts).
const raw = process.env["DATABASE_URL"]?.trim();
if (!raw) process.env["DATABASE_URL"] = "file:./dev.db"; // relative to prisma/schema.prisma → prisma/dev.db
else if (/^postgres(ql)?:/i.test(raw)) {
  throw new Error(
    "DATABASE_URL in .env is a PostgreSQL URL, but local commands use SQLite.\n" +
      "  Local:    set DATABASE_URL=file:./dev.db in .env\n" +
      "  Postgres: pnpm db:pg:generate && pnpm db:pg:deploy"
  );
} else if (!raw.startsWith("file:")) {
  throw new Error(`DATABASE_URL must start with "file:" for local SQLite (got "${raw.split(":")[0]}:…"). Use DATABASE_URL=file:./dev.db`);
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations"
  },
  datasource: {
    url: process.env["DATABASE_URL"]!
  }
});
