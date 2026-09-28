import type { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { KyselyDatabase } from "@carbon/database/client";
import { getCompanyPrivateBucket } from "@carbon/files";
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
  const lastInGroup =
    groupId !== null &&
    (await trx
      .selectFrom("company")
      .select("id")
      .where("companyGroupId", "=", groupId)
      .where("id", "<>", companyId)
      .limit(1)
      .executeTakeFirst()) === undefined;

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
  // Without replica the group's system accounts are still there and refuse the
  // cascade (protect_system_accounts), so an emptied group is only dropped after a wipe.
  if (replica && lastInGroup && groupId) {
    await trx.deleteFrom("companyGroup").where("id", "=", groupId).execute();
  }
}

/**
 * What a company owns outside its tables: integration secrets in Vault, its own
 * storage bucket, and pre-bucket-migration files under `<companyId>/` in the
 * shared private bucket. Returns the failures; each part is attempted
 * regardless.
 *
 * Run inside the purge transaction, after `purgeCompany`, and roll the purge back
 * when anything failed: the company row is then the retry target, so nothing is
 * left behind once the delete commits. The price is that a company whose cleanup
 * failed part-way may already have lost some files. It was warned and is still
 * due, so the next run finishes it.
 */
export async function removeCompanyLeftovers(
  db: Kysely<KyselyDatabase>,
  serviceRole: ReturnType<typeof getCarbonServiceRole>,
  companyId: string
): Promise<{ part: string; error: unknown }[]> {
  const failures: { part: string; error: unknown }[] = [];

  try {
    // starts_with, not LIKE: ids may contain `_`, a LIKE wildcard.
    await sql`DELETE FROM vault.secrets WHERE starts_with(name, ${`integration:${companyId}:`})`.execute(
      db
    );
  } catch (error) {
    failures.push({ part: "vault secrets", error });
  }

  // A bucket already gone (removed by an earlier attempt that then rolled back)
  // is done, not a failure, or that company would roll back every week.
  const bucket = getCompanyPrivateBucket(companyId);
  const emptied = await serviceRole.storage.emptyBucket(bucket);
  const removed = emptied.error
    ? emptied
    : await serviceRole.storage.deleteBucket(bucket);
  if (removed.error && !/not found/i.test(removed.error.message))
    failures.push({ part: "company bucket", error: removed.error });

  // Each listing returns at most 1000 entries per folder, so drain in passes.
  // Stops at 20 passes (~20k files) without an error, so the delete commits and
  // a larger legacy folder keeps its remainder.
  for (let pass = 0; pass < 20; pass++) {
    let files: { path: string }[];
    try {
      files = await listBucketFilesRecursive(
        serviceRole,
        STORAGE_BUCKET,
        companyId,
        { strict: true }
      );
    } catch (error) {
      failures.push({ part: "legacy private files", error });
      break;
    }
    if (files.length === 0) break;
    let failed = false;
    for (const paths of chunkArray(
      files.map((f) => f.path),
      1000
    )) {
      const { error } = await serviceRole.storage
        .from(STORAGE_BUCKET)
        .remove(paths);
      if (error) {
        failures.push({ part: "legacy private files", error });
        failed = true;
        break;
      }
    }
    if (failed) break;
  }

  return failures;
}
