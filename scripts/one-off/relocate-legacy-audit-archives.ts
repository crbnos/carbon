// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createRequire } from "node:module";
import { readLocalScriptConfig } from "../lib/local-script-config";

// One-off, idempotent: move the audit-log archives written before each company
// had its own bucket. They live in the retired shared `private` bucket at
// `audit-logs/{companyId}/…`, and `auditLogArchive.archivePath` still points
// there. Each is copied to `{companyId}/audit-logs/…` in the company's own
// bucket (the layout new archives use), then its row is repointed. Nothing is
// deleted. Re-running skips rows that already point at the company bucket.
//
// The apps stopped reading `private` in the same change that added this
// script, so an archive this script has not moved cannot be downloaded.
// Safe to remove once every deployment has run it. CI runs it once per
// database after the migrations (scripts/one-off/README.md); `--dry-run`
// lists what it would move.
//
// An archive whose file is gone is reported and left as it is: nothing can
// bring it back, and failing on it would fail every later deploy. Any other
// failure exits ONE_OFF_SCRIPT_DEFERRED, so the next deploy retries.

/** ONE_OFF_SCRIPT_DEFERRED in ci/src/one-off-scripts.ts. */
const DEFERRED = 75;
const LEGACY_BUCKET = "private";
const LEGACY_PREFIX = "audit-logs/";
const PAGE_SIZE = 1000;

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

type Archive = { id: string; companyId: string; archivePath: string };

/** `audit-logs/{companyId}/rest` → `{companyId}/audit-logs/rest`, or null. */
function relocatedArchivePath(archive: Archive): string | null {
  const [root, companyId, ...rest] = archive.archivePath.split("/");
  if (`${root}/` !== LEGACY_PREFIX) return null;
  if (companyId !== archive.companyId || rest.length === 0) return null;
  return `${archive.companyId}/audit-logs/${rest.join("/")}`;
}

function isAlreadyExistsError(error: {
  message?: string;
  statusCode?: string | number;
}) {
  return (
    /already exists|duplicate/i.test(error.message ?? "") ||
    String(error.statusCode) === "409"
  );
}

function isNotFoundError(error: {
  message?: string;
  statusCode?: string | number;
}) {
  return (
    /not found/i.test(error.message ?? "") ||
    String(error.statusCode) === "404"
  );
}

async function legacyArchives(): Promise<Archive[]> {
  const rows: Archive[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client
      .from("auditLogArchive")
      .select("id, companyId, archivePath")
      .like("archivePath", `${LEGACY_PREFIX}%`)
      .order("id")
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      throw new Error(`Failed to read auditLogArchive: ${error.message}`);
    }
    rows.push(...(data as Archive[]));
    if (data.length < PAGE_SIZE) break;
  }
  return rows;
}

async function relocate(
  archive: Archive
): Promise<"moved" | "missing" | "failed"> {
  const target = relocatedArchivePath(archive);
  if (!target) {
    process.stderr.write(
      `  FAILED ${archive.id}: ${archive.archivePath} is not under audit-logs/${archive.companyId}/\n`
    );
    return "failed";
  }
  if (isDryRun) {
    process.stdout.write(
      `  would move ${LEGACY_BUCKET}/${archive.archivePath} -> ${archive.companyId}/${target}\n`
    );
    return "moved";
  }

  const copied = await client.storage
    .from(LEGACY_BUCKET)
    .copy(archive.archivePath, target, { destinationBucket: archive.companyId });
  if (copied.error && isNotFoundError(copied.error)) {
    process.stderr.write(
      `  MISSING ${archive.id}: ${LEGACY_BUCKET}/${archive.archivePath} is gone; left as it is\n`
    );
    return "missing";
  }
  if (copied.error && !isAlreadyExistsError(copied.error)) {
    process.stderr.write(
      `  FAILED ${archive.id}: copy — ${copied.error.message}\n`
    );
    return "failed";
  }

  // Compare-and-set on the old path, scoped to the company.
  const updated = await client
    .from("auditLogArchive")
    .update({ archivePath: target })
    .eq("id", archive.id)
    .eq("companyId", archive.companyId)
    .eq("archivePath", archive.archivePath);
  if (updated.error) {
    process.stderr.write(
      `  FAILED ${archive.id}: repoint — ${updated.error.message}\n`
    );
    return "failed";
  }
  return "moved";
}

(async () => {
  if (isDryRun) {
    process.stdout.write("Dry run — nothing copied, no row changed.\n");
  }
  const archives = await legacyArchives();
  process.stdout.write(`Found ${archives.length} legacy audit archives.\n`);

  const total = { moved: 0, missing: 0, failed: 0 };
  for (const archive of archives) {
    total[await relocate(archive)] += 1;
  }

  process.stdout.write(
    `Total${isDryRun ? " (dry run)" : ""}: ${JSON.stringify(total)}\n`
  );
  if (total.failed > 0) process.exitCode = DEFERRED;
})().catch((err) => {
  process.stderr.write(`Relocation failed: ${(err as Error).message}\n`);
  process.exitCode = 1;
});
