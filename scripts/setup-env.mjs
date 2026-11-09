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

// Hosted service platforms supply their own variables. Copying .env.example
// there would inject dev defaults (e.g. INDEXER_PORT=4016 instead of the
// platform's PORT, so the service never answers).
const hosted = process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID || process.env.RENDER || process.env.FLY_APP_NAME;

if (hosted) {
  console.log("[setup-env] hosted platform detected — no .env created (use the platform's variables).");
} else if (existsSync(env) || existsSync(envLocal)) {
  console.log("[setup-env] .env/.env.local already exists — left untouched.");
} else {
  copyFileSync(resolve(root, ".env.example"), env);
  console.log("[setup-env] created .env from .env.example (dev defaults; add real secrets yourself).");
}
