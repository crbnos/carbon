import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import * as dotenv from "dotenv";

// SUPABASE_DB_URL lives in the repo-root .env.local (not .env) — load both.
export function loadEnv() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, "..", "..", "..", "..");
  // Caller-supplied vars win: `crbn up` passes localhost URLs, while .env.local
  // holds portless hosts that don't resolve until aliases are registered.
  const preset = { ...process.env };
  dotenv.config();
  for (const file of [".env", ".env.local"]) {
    const envPath = path.join(repoRoot, file);
    if (existsSync(envPath)) dotenv.config({ path: envPath, override: true });
  }
  for (const [key, value] of Object.entries(preset)) {
    if (value !== undefined) process.env[key] = value;
  }
}

export type SeedArgs = {
  email: string;
  tiers: number[] | null;
  skipWipe: boolean;
};

function printUsage() {
  console.log(`
Usage: pnpm run db:seed:dev -- --email <email> [--tiers 1,2,3] [--skip-wipe]

Arguments:
  --email, -e    Required. Seeds the company this user belongs to.
                 Unknown emails bootstrap a brand new user + company.
  --tiers        Dev only. Comma-separated tier numbers to run (default: all).
  --skip-wipe    Dev only. Leave existing business data in place.

Example:
  pnpm run db:seed:dev -- --email developer@example.com
`);
}

export function parseSeedArgs(): SeedArgs {
  // The root script forwards a bare `--`, which strict parseArgs rejects.
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((a) => a !== "--"),
    options: {
      email: { type: "string", short: "e" },
      tiers: { type: "string" },
      "skip-wipe": { type: "boolean", default: false }
    },
    strict: true
  });

  const email = values.email?.trim();
  if (!email) {
    console.error("Error: --email is required\n");
    printUsage();
    process.exit(1);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error("Error: Invalid email format\n");
    process.exit(1);
  }

  let tiers: number[] | null = null;
  if (values.tiers) {
    tiers = values.tiers
      .split(",")
      .map((t) => Number(t.trim()))
      .filter((n) => Number.isInteger(n));
    if (tiers.length === 0) {
      console.error(`Error: could not parse --tiers "${values.tiers}"\n`);
      process.exit(1);
    }
  }

  return { email, tiers, skipWipe: values["skip-wipe"] ?? false };
}
