/**
 * Fresh-clone bootstrap (cross-platform, no deps).
 *
 * Runs from the `postinstall` hook so a bare checkout works everywhere —
 * Windows, Linux, CI, Vercel — without the operator hand-editing anything:
 *
 *   1. If neither .env nor .env.local exists, copy .env.example → .env
 *      (fills DATABASE_URL etc. with the safe dev defaults; real secrets are
 *      still filled in later by hand — never auto-generated).
 *   2. That's all. `prisma generate` runs separately right after this.
 *
 * NEVER writes into .env / .env.local if they already exist.
 */
import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const env = resolve(root, ".env");
const envLocal = resolve(root, ".env.local");

if (existsSync(env) || existsSync(envLocal)) {
  console.log("[setup-env] .env/.env.local already exists — left untouched.");
} else {
  copyFileSync(resolve(root, ".env.example"), env);
  console.log("[setup-env] created .env from .env.example (dev defaults; add real secrets yourself).");
}
