import path from "node:path";
import { PrismaClient } from "@prisma/client";

/**
 * Prisma singleton. The web app stores session durability here; the execution
 * services deliberately do NOT use this database (their own fsync'd journals are
 * their audit trail — separate processes, separate stores, per the brief §8).
 *
 * If DATABASE_URL is unset the DB-backed routes report themselves unavailable
 * instead of pretending persistence happened.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Dev default: the checked-in SQLite database under prisma/. Production sets
// DATABASE_URL explicitly (e.g. postgres) — there is no silent in-memory mode.
// Dev default is made absolute eagerly: Prisma resolves relative `file:` URLs
// against the schema dir, not the process cwd, and Next dev's cwd differs.
const DB_URL = process.env.DATABASE_URL ?? `file:${path.join(process.cwd(), "prisma", "dev.db")}`;

export const prisma = (globalForPrisma.prisma ??= new PrismaClient({
  datasources: { db: { url: DB_URL } },
}));

export const dbConfigured = () => prisma !== null;
export const dbUrl = () => process.env.DATABASE_URL ?? "file:<project>/prisma/dev.db (dev default)";
export const dbLabel = () => (DB_URL.startsWith("postgres") ? "prisma-postgres" : "prisma-sqlite");
