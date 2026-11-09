#!/usr/bin/env node
/**
 * postinstall: bootstrap .env, then generate the Prisma client that matches
 * DATABASE_URL (cross-platform, no shell syntax).
 *
 *   file:…        / empty → SQLite client  (local dev; prisma.config.ts)
 *   postgres(ql):…        → Postgres client (Vercel, servers; scripts/prisma-pg.mjs)
 *
 * Platform variables win over .env (dotenv never overrides), so on Vercel with
 * a Neon DATABASE_URL the install itself produces the Postgres client instead
 * of failing on the SQLite config.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const run = (args) => {
  const r = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run(["scripts/setup-env.mjs"]);

// DATABASE_URL from the environment, else from .env / .env.local (first match)
let url = process.env.DATABASE_URL?.trim();
if (!url) {
  for (const f of [".env.local", ".env"]) {
    if (!existsSync(f)) continue;
    const m = readFileSync(f, "utf8").match(/^\s*DATABASE_URL\s*=\s*["']?([^"'\r\n]*)/m);
    if (m && m[1].trim()) {
      url = m[1].trim();
      break;
    }
  }
}

if (url && /^postgres(ql)?:/i.test(url)) {
  console.log("[postinstall] DATABASE_URL is PostgreSQL → generating the Postgres Prisma client");
  run(["scripts/prisma-pg.mjs", "generate"]);
} else {
  const require = createRequire(import.meta.url);
  const pkg = require.resolve("prisma/package.json");
  const bin = require(pkg).bin;
  run([join(dirname(pkg), typeof bin === "string" ? bin : bin.prisma), "generate"]);
}
