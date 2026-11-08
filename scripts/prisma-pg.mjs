#!/usr/bin/env node
/**
 * PostgreSQL variant of the Prisma schema (cross-platform, no shell syntax).
 *
 * Prisma cannot switch `provider` from an env var, so the shared deployment uses
 * prisma/postgres/schema.prisma, DERIVED from prisma/schema.prisma (edit that one
 * only). Its migrations live in prisma/postgres/migrations.
 *
 *   node scripts/prisma-pg.mjs sync               # rewrite the derived schema only
 *   node scripts/prisma-pg.mjs generate           # sync + prisma generate (Postgres client)
 *   node scripts/prisma-pg.mjs migrate deploy     # sync + apply migrations to DATABASE_URL
 *   node scripts/prisma-pg.mjs check              # fail if the derived schema is stale
 *
 * Any other arguments are forwarded to the Prisma CLI with prisma.postgres.config.ts.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const SRC = join("prisma", "schema.prisma");
const OUT = join("prisma", "postgres", "schema.prisma");

function derive() {
  const src = readFileSync(SRC, "utf8");
  if (!/provider\s*=\s*"sqlite"/.test(src)) throw new Error(`${SRC}: expected provider = "sqlite"`);
  return (
    "// GENERATED from prisma/schema.prisma by scripts/prisma-pg.mjs — DO NOT EDIT.\n" +
    src.replace(/provider\s*=\s*"sqlite"/, 'provider = "postgresql"')
  );
}

const args = process.argv.slice(2);
const next = derive();
if (args[0] === "check") {
  const cur = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (cur !== next) {
    console.error(`${OUT} is stale — run: node scripts/prisma-pg.mjs sync`);
    process.exit(1);
  }
  console.log(`${OUT} is in sync`);
  process.exit(0);
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, next);
if (args.length === 0 || args[0] === "sync") {
  console.log(`wrote ${OUT}`);
  process.exit(0);
}
const require = createRequire(import.meta.url);
const pkg = require.resolve("prisma/package.json");
const cli = join(dirname(pkg), require(pkg).bin.prisma ?? require(pkg).bin);
// --config (not --schema): the default prisma.config.ts points at the SQLite migrations
const r = spawnSync(process.execPath, [cli, ...args, "--config", "prisma.postgres.config.ts"], { stdio: "inherit" });
process.exit(r.status ?? 1);
