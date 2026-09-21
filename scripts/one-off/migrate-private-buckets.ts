import { createRequire } from "node:module";
import { readLocalScriptConfig } from "../lib/local-script-config";

// One-off, idempotent migration: copy the legacy shared `private` bucket's
// objects into each company's own bucket (bucket id = companyId). Object keys
// are identical in both buckets (they start with `${companyId}/`).
// Nothing is ever deleted. Re-running skips objects that already exist.
//
// COVERAGE: only objects under a LIVE company's `${companyId}/` prefix are
// copied. Legacy objects under any other prefix — pre-migration audit
// archives at `audit-logs/{companyId}/...`, prefixes of deleted companies —
// are NOT copied and remain readable only via the legacy-bucket fallback.
// Do not decommission the legacy bucket until those are handled explicitly.
//
// Usage:
//   pnpm exec tsx scripts/one-off/migrate-private-buckets.ts            # migrate
//   pnpm exec tsx scripts/one-off/migrate-private-buckets.ts --dry-run  # read-only

const LEGACY_BUCKET = "private";
const BUCKET_FILE_SIZE_LIMIT = 52428800; // 50 MB
const LIST_PAGE_SIZE = 1000;

const isDryRun = process.argv.includes("--dry-run");

const { SUPABASE_URL: supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey } =
  readLocalScriptConfig(
    ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
    process.env
  );

function createServiceRoleClient(url: string, serviceRole: string) {
  // The database workspace declares and pins this dependency; root scripts do not.
  const fromDatabase = createRequire(
    new URL("../../packages/database/package.json", import.meta.url)
  );
  const { createClient } = fromDatabase("@supabase/supabase-js");
  return createClient(url, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

const client = createServiceRoleClient(supabaseUrl, serviceRoleKey);

type CompanySummary = { copied: number; skipped: number; failed: number };

function isAlreadyExistsError(error: { message?: string; statusCode?: string | number }) {
  const message = error.message ?? "";
  return (
    /already exists/i.test(message) ||
    /duplicate/i.test(message) ||
    String(error.statusCode) === "409"
  );
}

async function getCompanyIds(): Promise<string[]> {
  const ids: string[] = [];
  for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
    const { data, error } = await client
      .from("company")
      .select("id")
      .order("id")
      .range(offset, offset + LIST_PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to read company table: ${error.message}`);
    ids.push(...data.map((row: { id: string }) => row.id));
    if (data.length < LIST_PAGE_SIZE) break;
  }
  return ids;
}

// Recursively list every object key under `prefix` in the legacy bucket.
// Storage list returns folders as entries with id === null; recurse into them.
async function listObjectKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
    const { data, error } = await client.storage
      .from(LEGACY_BUCKET)
      .list(prefix, { limit: LIST_PAGE_SIZE, offset });
    if (error) {
      throw new Error(`Failed to list ${LEGACY_BUCKET}/${prefix}: ${error.message}`);
    }
    for (const entry of data as Array<{ name: string; id: string | null }>) {
      if (entry.id === null) {
        keys.push(...(await listObjectKeys(`${prefix}/${entry.name}`)));
      } else {
        keys.push(`${prefix}/${entry.name}`);
      }
    }
    if (data.length < LIST_PAGE_SIZE) break;
  }
  return keys;
}

async function ensureBucket(companyId: string) {
  const { error } = await client.storage.createBucket(companyId, {
    public: false,
    fileSizeLimit: BUCKET_FILE_SIZE_LIMIT
  });
  if (error && !isAlreadyExistsError(error)) {
    throw new Error(`Failed to create bucket ${companyId}: ${error.message}`);
  }
}

async function migrateCompany(companyId: string): Promise<CompanySummary> {
  const summary: CompanySummary = { copied: 0, skipped: 0, failed: 0 };

  if (!isDryRun) {
    await ensureBucket(companyId);
  }

  const keys = await listObjectKeys(companyId);

  for (const key of keys) {
    if (isDryRun) {
      process.stdout.write(`  would copy ${LEGACY_BUCKET}/${key} -> ${companyId}/${key}\n`);
      summary.copied += 1;
      continue;
    }

    const { error } = await client.storage
      .from(LEGACY_BUCKET)
      .copy(key, key, { destinationBucket: companyId });

    if (!error) {
      summary.copied += 1;
    } else if (isAlreadyExistsError(error)) {
      summary.skipped += 1;
    } else {
      summary.failed += 1;
      process.stderr.write(`  FAILED ${companyId}: ${key} — ${error.message}\n`);
    }
  }

  return summary;
}

(async () => {
  if (isDryRun) {
    process.stdout.write("Dry run — no buckets created, no objects copied.\n");
  }

  const companyIds = await getCompanyIds();
  process.stdout.write(`Found ${companyIds.length} companies.\n`);

  const total: CompanySummary = { copied: 0, skipped: 0, failed: 0 };

  for (const companyId of companyIds) {
    process.stdout.write(`\nCompany ${companyId}\n`);
    const summary = await migrateCompany(companyId);
    total.copied += summary.copied;
    total.skipped += summary.skipped;
    total.failed += summary.failed;
    process.stdout.write(`  ${JSON.stringify(summary)}\n`);
  }

  process.stdout.write(
    `\nTotal${isDryRun ? " (dry run)" : ""}: ${JSON.stringify(total)}\n`
  );

  if (total.failed > 0) {
    process.exitCode = 1;
  }
})().catch((err) => {
  process.stderr.write(`Migration failed: ${(err as Error).message}\n`);
  process.exitCode = 1;
});
