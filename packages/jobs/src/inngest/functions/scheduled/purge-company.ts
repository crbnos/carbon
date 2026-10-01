// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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

  const legacyError = await drainLegacyFolder(serviceRole, companyId);
  if (legacyError) {
    failures.push({ part: "legacy private files", error: legacyError });
  }

  return failures;
}

/** Deletion passes per run; each listing returns at most 1000 entries per folder. */
const MAX_LEGACY_PASSES = 20;

/**
 * Empty `private/<companyId>/`. Returns the error that stopped it, including a
 * folder still not empty after `MAX_LEGACY_PASSES`: the purge then rolls back,
 * and the next run carries on from what this one already removed.
 */
async function drainLegacyFolder(
  serviceRole: ReturnType<typeof getCarbonServiceRole>,
  companyId: string
): Promise<unknown> {
  for (let pass = 0; ; pass++) {
    let files: { path: string }[];
    try {
      files = await listBucketFilesRecursive(
        serviceRole,
        STORAGE_BUCKET,
        companyId,
        { strict: true }
      );
    } catch (error) {
      return error;
    }
    if (files.length === 0) return null;
    if (pass === MAX_LEGACY_PASSES) {
      return new Error(
        `${files.length}+ legacy files remain after ${MAX_LEGACY_PASSES} passes`
      );
    }

    for (const paths of chunkArray(
      files.map((f) => f.path),
      1000
    )) {
      const { error } = await serviceRole.storage
        .from(STORAGE_BUCKET)
        .remove(paths);
      if (error) return error;
    }
  }
}
