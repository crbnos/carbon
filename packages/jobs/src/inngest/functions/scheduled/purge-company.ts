// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { KyselyDatabase } from "@carbon/database/client";
import { getCompanyPrivateBucket, isStorageNotFound } from "@carbon/files";
import { chunkArray } from "@carbon/utils";
import { type Kysely, sql } from "kysely";
import { listBucketFilesRecursive } from "../../../backups/storage";
import {
  type Catalog,
  STORAGE_BUCKET,
  wipeScopedData
} from "../tasks/company-backup";

/**
 * Delete one company and everything it owns, inside the caller's transaction.
 *
 * A plain `DELETE FROM company` cascades, but posted journals and invoices are
 * trigger-immutable, and settlements hold RESTRICT FKs, so it fails for any company
 * that ever posted (every demo-template company). With `replica` (triggers and FK
 * enforcement off, as the backup restore uses) every tenant table is wiped first,
 * children before parents; the final delete then cascades whatever the catalog
 * does not cover. Group-shared data (chart of accounts, currencies) goes only when
 * no other company is left in the group.
 *
 * Unlike a restore, the wipe includes the secret and identity tables
 * (`companyIntegration`, `apiKey`, `userToCompany`, …): nothing is reloaded.
 */
export async function purgeCompany(
  trx: Kysely<KyselyDatabase>,
  catalog: Catalog,
  companyId: string,
  { replica }: { replica: boolean }
): Promise<void> {
  const company = await trx
    .selectFrom("company")
    .select("companyGroupId")
    .where("id", "=", companyId)
    .executeTakeFirst();
  if (!company) return;

  const groupId = company.companyGroupId;
  // Two purges in one group serialize on the group row, so they cannot both see
  // the other company and both leave the group's shared data behind.
  if (groupId !== null) {
    await trx
      .selectFrom("companyGroup")
      .select("id")
      .where("id", "=", groupId)
      .forUpdate()
      .execute();
  }
  const lastInGroup =
    groupId !== null &&
    (await trx
      .selectFrom("company")
      .select("id")
      .where("companyGroupId", "=", groupId)
      .where("id", "<>", companyId)
      .limit(1)
      .executeTakeFirst()) === undefined;

  // Without replica the group's system accounts refuse deletion
  // (protect_system_accounts), so deleting only the company would strand the
  // group and its shared data. Refuse instead; the company stays for a later run.
  if (!replica && lastInGroup) {
    throw new Error(
      "The last company in a group can only be purged in replica mode"
    );
  }

  if (replica) {
    await sql`SET LOCAL session_replication_role = 'replica'`.execute(trx);
    await wipeScopedData(
      trx,
      catalog.tables,
      new Map(catalog.tables.map((t) => [t.name, t])),
      { companyId, companyGroupId: lastInGroup ? groupId : null }
    );
    await sql`SET LOCAL session_replication_role = 'origin'`.execute(trx);
  }

  await trx.deleteFrom("company").where("id", "=", companyId).execute();
  if (lastInGroup && groupId) {
    await trx.deleteFrom("companyGroup").where("id", "=", groupId).execute();
  }
}

/**
 * A company's integration secrets in Vault. Run inside the purge transaction,
 * after `purgeCompany`: it is plain SQL, so it commits or rolls back with the rows.
 */
export async function removeCompanySecrets(
  trx: Kysely<KyselyDatabase>,
  companyId: string
): Promise<void> {
  // starts_with, not LIKE: ids may contain `_`, a LIKE wildcard.
  await sql`DELETE FROM vault.secrets WHERE starts_with(name, ${`integration:${companyId}:`})`.execute(
    trx
  );
}

// Tables named after a company (`searchIndex_<id>`, `auditLog_<id>`), which the
// table catalog cannot list.
const COMPANY_TABLE_PREFIXES = ["searchIndex_", "auditLog_"] as const;

/**
 * A company's own tables. Run inside the purge transaction, so they go with
 * the rows or not at all. Dropped over the direct connection because it owns
 * them: the service role does not, and its `drop_company_search_index` call
 * was refused for every purged company, leaving the table behind.
 */
export async function dropCompanyTables(
  trx: Kysely<KyselyDatabase>,
  companyId: string
): Promise<void> {
  for (const prefix of COMPANY_TABLE_PREFIXES) {
    await sql`DROP TABLE IF EXISTS ${sql.id("public", prefix + companyId)} CASCADE`.execute(
      trx
    );
  }
}

/**
 * Drop company tables whose company no longer exists, and return their names.
 * One statement per table, so each drop takes and releases its own locks.
 */
export async function dropOrphanCompanyTables(
  db: Kysely<KyselyDatabase>,
  limit: number
): Promise<string[]> {
  // starts_with, not LIKE: `_` is a LIKE wildcard. The rest of the name must
  // look like a company id (xid or base58), so a table that only shares the
  // prefix is never dropped.
  const { rows } = await sql<{ name: string }>`
    SELECT c.relname AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN unnest(${[...COMPANY_TABLE_PREFIXES]}::text[]) AS p(prefix)
      ON starts_with(c.relname, p.prefix)
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND substr(c.relname, length(p.prefix) + 1) ~ '^[A-Za-z0-9]{20,}$'
      AND NOT EXISTS (
        SELECT 1 FROM "company" co WHERE p.prefix || co.id = c.relname
      )
    ORDER BY c.relname
    LIMIT ${limit}`.execute(db);

  for (const { name } of rows) {
    await sql`DROP TABLE IF EXISTS ${sql.id("public", name)} CASCADE`.execute(
      db
    );
  }
  return rows.map((row) => row.name);
}

/**
 * A company's files: its own storage bucket, and pre-bucket-migration files
 * under `<companyId>/` in the shared private bucket. Returns the failures; each
 * part is attempted regardless.
 *
 * Run BEFORE the purge transaction, never inside it. Storage deletes its object
 * rows on its own connection, and `delete_orphaned_documents` then deletes the
 * matching `document` rows; with those rows already deleted by an open purge
 * transaction, storage waits on that transaction, which is waiting on storage,
 * until storage times out (HTTP 544) and the purge rolls back.
 *
 * The company row is the retry target: when anything here fails the company is
 * kept, and the next run carries on from what this one already removed. The
 * price is that a kept company may already have lost some files.
 */
export async function removeCompanyFiles(
  serviceRole: ReturnType<typeof getCarbonServiceRole>,
  companyId: string
): Promise<{ part: string; error: unknown }[]> {
  const failures: { part: string; error: unknown }[] = [];

  // Drained by listing, not `emptyBucket`: that only queues the deletes, so the
  // `deleteBucket` after it is refused as "not empty" for any bucket with files.
  // A bucket already gone (an earlier attempt removed it, then failed) is done.
  const bucket = getCompanyPrivateBucket(companyId);
  let bucketError = await drainFolder(serviceRole, bucket, "");
  if (!bucketError) {
    bucketError = (await serviceRole.storage.deleteBucket(bucket)).error;
  }
  if (bucketError && !(await isBucketGone(bucketError))) {
    failures.push({ part: "company bucket", error: bucketError });
  }

  const legacyError = await drainFolder(serviceRole, STORAGE_BUCKET, companyId);
  if (legacyError) {
    failures.push({ part: "legacy private files", error: legacyError });
  }

  return failures;
}

const isBucketGone = async (error: unknown) =>
  (await isStorageNotFound(error)) ||
  /not found/i.test((error as { message?: string }).message ?? "");

/** Deletion passes per run; each listing returns at most 1000 entries per folder. */
const MAX_DRAIN_PASSES = 20;

/**
 * Delete every file under `prefix` of `bucket`. Returns the error that stopped
 * it, including a folder still not empty after `MAX_DRAIN_PASSES`: the company
 * is then kept, and the next run carries on from what this one already removed.
 */
async function drainFolder(
  serviceRole: ReturnType<typeof getCarbonServiceRole>,
  bucket: string,
  prefix: string
): Promise<unknown> {
  for (let pass = 0; ; pass++) {
    let files: { path: string }[];
    try {
      files = await listBucketFilesRecursive(serviceRole, bucket, prefix, {
        strict: true
      });
    } catch (error) {
      return error;
    }
    if (files.length === 0) return null;
    if (pass === MAX_DRAIN_PASSES) {
      return new Error(
        `${files.length}+ files remain after ${MAX_DRAIN_PASSES} passes`
      );
    }

    // Small requests: storage deletes the rows and the objects in one statement
    // timeout, and each row fires `delete_orphaned_documents`.
    for (const paths of chunkArray(
      files.map((f) => f.path),
      200
    )) {
      const { error } = await serviceRole.storage.from(bucket).remove(paths);
      if (error) return error;
    }
  }
}
