// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { requireBackupsEntitlement } from "@carbon/ee/backups.server";
import { sql } from "kysely";
import {
  getCompanyTableCatalog,
  type TableInfo
} from "../../../backups/catalog";
import { assertBackupImportable } from "../../../backups/compatibility";
import {
  bulkLoad,
  getCompanyGroupId,
  insertTables,
  readBackupForLoad
} from "../../../backups/load";
import {
  isLeftAlone,
  isUserScopedIdentityTable
} from "../../../backups/policy";
import {
  buildIdMaps,
  flattenIdMaps,
  loadSubstrateIds
} from "../../../backups/remap";
import {
  filterUnpopulated,
  getUniqueColumnGroups,
  mapCollidingRows,
  matchableUniqueGroups,
  referencedDroppedTables
} from "../../../backups/reseed";
import { PER_COMPANY_CONCURRENCY } from "../../../backups/runs";
import { restoreAssetsFromBackup } from "../../../backups/storage";
import { getJobDatabaseClient } from "../../../db";
import { inngest } from "../../client";

/**
 * Populate a freshly created company from a backup (onboarding from a backup):
 * an additive reseed, every id remapped onto the new company.
 */
export const companyImportFunction = inngest.createFunction(
  {
    id: "company-import",
    retries: 1,
    concurrency: PER_COMPANY_CONCURRENCY
  },
  { event: "carbon/company-import" },
  async ({ event, step, logger }) => {
    const { companyId, userId, filePath: name } = event.data;

    return await step.run("import-company", async () => {
      await requireBackupsEntitlement(companyId);
      const client = getCarbonServiceRole();
      const db = getJobDatabaseClient();

      const catalog = await getCompanyTableCatalog(db);
      const backup = await readBackupForLoad(client, companyId, name, catalog);
      assertBackupImportable(catalog, backup);

      // Refuse a target that's already been set up (a retry after the load
      // committed, or a direct trigger). accountDefault is the seed marker.
      const seeded = await client
        .from("accountDefault")
        .select("companyId", { count: "exact", head: true })
        .eq("companyId", companyId);
      if (seeded.error) throw new Error(seeded.error.message);
      if ((seeded.count ?? 0) > 0) {
        throw new Error(
          `Reseed target ${companyId} is already set up — reseed requires a ` +
            "freshly created company"
        );
      }

      const targetGroupId = await getCompanyGroupId(client, companyId);
      const catalogTableNames = new Set(catalog.tables.map((t) => t.name));

      const skipped = new Set(
        catalog.tables.map((t) => t.name).filter(isLeftAlone)
      );
      const candidateTables = catalog.tables.filter(
        (t) =>
          !skipped.has(t.name) &&
          !isUserScopedIdentityTable(t) &&
          (backup.data[t.name]?.length ?? 0) > 0
      );

      // Never touch a table the target already populated itself — its identity
      // seed, its triggers (event subscriptions, search registry) or
      // onboarding's own inserts (location, employee job, groups). Asking the
      // database which tables are non-empty replaces every hand-maintained
      // "skip" list: a bare clone imports everything, an identity-seeded
      // onboard skips exactly what's already there.
      const byName = new Map(catalog.tables.map((t) => [t.name, t]));
      const unpopulatedTables = await filterUnpopulated(
        db,
        candidateTables,
        byName,
        companyId,
        targetGroupId
      );

      // A dropped-as-already-populated table whose ids the kept rows still
      // reference must be imported anyway, or every FK into it is nulled /
      // left dangling (this is how a reseed detached every workCenter and job
      // from its location — onboarding's one "Headquarters" row made the
      // backup's `location` table look "already populated"). Colliding rows
      // are mapped onto the target's own rows below instead of inserted.
      const keptNames = new Set(unpopulatedTables.map((t) => t.name));
      const readdedTables: TableInfo[] = referencedDroppedTables(
        unpopulatedTables,
        candidateTables.filter((t) => !keptNames.has(t.name))
      );
      const keep = new Set([...keptNames, ...readdedTables.map((t) => t.name)]);
      const importTables = candidateTables.filter((t) => keep.has(t.name));

      const idMaps = buildIdMaps(importTables, backup.data);

      // Re-added tables are populated in the target BY DEFINITION, and unique
      // constraints stay enforced under replica mode — a backup row sharing a
      // unique key with an existing target row (both sides have a
      // "Headquarters" location) must map onto it, not be inserted against it.
      const data = { ...backup.data };
      for (const table of readdedTables) {
        const idMap = idMaps.get(table.name);
        if (!idMap || table.scope.kind !== "direct") continue;
        const scopeValue =
          table.scope.column === "companyId" ? companyId : targetGroupId;
        if (scopeValue == null) continue;
        const groups = matchableUniqueGroups(
          await getUniqueColumnGroups(db, table.name),
          table
        );
        if (groups.length === 0) continue;
        const cols = [...new Set(groups.flat())];
        const existing = await sql<{ [col: string]: unknown }>`
          SELECT ${sql.join([sql.id("id"), ...cols.map((c) => sql.id(c))])}
          FROM ${sql.id(table.name)}
          WHERE ${sql.id(table.scope.column)} = ${scopeValue}
        `.execute(db);
        const { skippedSourceIds, overrides } = mapCollidingRows(
          groups,
          backup.data[table.name] ?? [],
          existing.rows
        );
        for (const [sourceId, targetId] of overrides) {
          idMap.set(sourceId, targetId);
        }
        if (skippedSourceIds.size > 0) {
          data[table.name] = (data[table.name] ?? []).filter(
            (row) =>
              !(typeof row.id === "string" && skippedSourceIds.has(row.id))
          );
        }
      }

      // Old id → new id across every remapped table, for the ids embedded in
      // storage paths (e.g. `{co}/models/{modelId}.stl`). Built after the
      // collision overrides, so a mapped-onto-target row's path segments
      // rewrite to the surviving id.
      const idRewrite = flattenIdMaps(idMaps);

      if (
        targetGroupId === null &&
        importTables.some((t) => t.scopeColumn === "companyGroupId")
      ) {
        throw new Error(
          `Target company ${companyId} has no companyGroup, but the artifact ` +
            "carries group-scoped data (chart of accounts, currencies). " +
            "Create the company's group before importing."
        );
      }

      const sourceCompanyId = backup.manifest.sourceCompanyId;
      // FK columns pointing at a tenant table we did NOT import (it was already
      // populated by the target's own seed, or skipped). Their non-null source
      // ids don't exist here; collected so a dangling, non-nullable ref is
      // surfaced rather than silently corrupting referential integrity.
      const unresolvedRefs = new Set<string>();
      let scrubCounter = 0;
      // Global substrate (companyId IS NULL) ids the backup omits but the target
      // holds by seed — a template's FK into a seeded global row resolves against
      // these instead of dangling.
      const substrateIds = await loadSubstrateIds(db, catalog, backup.data);

      const counts = await bulkLoad(db, companyId, (trx) =>
        insertTables(
          trx,
          importTables,
          { ...backup, data },
          {
            companyId,
            userId,
            targetGroupId,
            sourceCompanyId,
            idMaps,
            idRewrite,
            substrateIds,
            skippedRefTables: skipped,
            catalogTableNames,
            onUnresolvedRef: (desc) => unresolvedRefs.add(desc),
            scrubEmail: () => `import-${++scrubCounter}@example.test`
          }
        )
      );

      if (unresolvedRefs.size > 0) {
        logger.warn(
          "Reseed kept non-nullable references to tables it did not import " +
            "(the target already had them, so source ids could not be " +
            "remapped). These may dangle — the template likely needs those " +
            "columns made nullable or those tables left out of the seed",
          { unresolvedRefs: [...unresolvedRefs] }
        );
      }

      // Storage files travel outside the transaction — failures here leave the
      // imported rows intact and are surfaced as warnings. Copied server-side
      // from the backup's assets folder into the company's own bucket, with the
      // path rewritten (and ids remapped) to match the path columns above.
      const assets = await restoreAssetsFromBackup(client, {
        files: backup.manifest.storage,
        name: name,
        sourceCompanyId,
        companyId,
        idRewrite
      });

      const totalRows = Object.values(counts).reduce((sum, n) => sum + n, 0);
      logger.info("Company import complete", {
        companyId,
        tables: Object.keys(counts).length,
        rows: totalRows,
        storageUploaded: assets.copied
      });

      return {
        tables: Object.keys(counts).length,
        rows: totalRows,
        storageUploaded: assets.copied
      };
    });
  }
);
