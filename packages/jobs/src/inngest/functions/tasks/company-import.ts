import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { chunkArray } from "@carbon/utils";
import { sql } from "kysely";
import { inngest } from "../../client";
import {
  assertBackupImportable,
  BACKUP_INTEGRATION,
  backupAssetsDir,
  backupNameFromSource,
  bindValue,
  canSetReplicationRole,
  filterUnpopulated,
  getCompanyTableCatalog,
  getJobDatabaseClient,
  isUserScopedIdentityTable,
  newIdForTable,
  RESEED_SKIPPED_TABLES,
  readBackup,
  restoreAssetsFromBackup,
  SECRET_TABLES
} from "./company-backup";
import {
  buildRowTransforms,
  loadSubstrateIds
} from "./company-backup.transforms";

const INSERT_CHUNK_SIZE = 200;

type LedgerRow = {
  entityType: string;
  entityId: string;
  externalId: string;
};

export const companyImportFunction = inngest.createFunction(
  {
    id: "company-import",
    retries: 1,
    concurrency: { key: "event.data.companyId", limit: 1 }
  },
  { event: "carbon/company-import" },
  async ({ event, step }) => {
    const {
      companyId,
      userId,
      filePath,
      mode,
      importRunId,
      autoFinalize,
      templateIndustryId
    } = event.data;

    // Onboarding demo templates reference shared assets at
    // `_templates/<industryId>/` (uploaded once per workspace at deploy) rather
    // than copying every file into this company's `{companyId}/` prefix. Real
    // backups have no industryId and stay self-contained (files embedded + copied).
    const referencedTemplate =
      typeof templateIndustryId === "string" && templateIndustryId.length > 0;

    return await step.run("import-company", async () => {
      const client = getCarbonServiceRole();
      const db = getJobDatabaseClient(1);

      // Idempotency guard — a retry after a partial failure must not
      // duplicate rows that already committed under this run id.
      const existing = await client
        .from("externalIntegrationMapping")
        .select("id", { count: "exact", head: true })
        .eq("integration", BACKUP_INTEGRATION)
        .eq("companyId", companyId)
        .filter("metadata->>importRunId", "eq", importRunId);
      if ((existing.count ?? 0) > 0) {
        console.log("Import run already applied, skipping", { importRunId });
        return { importRunId, skipped: true };
      }

      const name = backupNameFromSource(filePath);
      const backup = await readBackup(client, companyId, name);

      if (
        mode === "preserve" &&
        backup.manifest.sourceCompanyId !== companyId
      ) {
        throw new Error(
          "Preserve mode requires importing into the same company the artifact " +
            `was exported from (${backup.manifest.sourceCompanyId}). ` +
            "Use reseed mode to import into a different company."
        );
      }

      // Reseed populates a fresh company; refuse a target that's already been
      // set up (the edge function gates this too — this is defense in depth
      // for retries or direct triggers). accountDefault is the seed marker.
      if (mode === "reseed") {
        const seeded = await client
          .from("accountDefault")
          .select("companyId", { count: "exact", head: true })
          .eq("companyId", companyId);
        if ((seeded.count ?? 0) > 0) {
          throw new Error(
            `Reseed target ${companyId} is already set up — reseed requires a ` +
              "freshly created company"
          );
        }
      }

      // The target company's group receives the companyGroup-scoped data
      // (chart of accounts, currencies, …).
      const targetCompany = await client
        .from("company")
        .select("companyGroupId")
        .eq("id", companyId)
        .single();
      if (targetCompany.error) throw new Error(targetCompany.error.message);
      const targetGroupId = targetCompany.data?.companyGroupId ?? null;

      const catalog = await getCompanyTableCatalog(db);
      const compatibility = assertBackupImportable(catalog, backup);
      if (!compatibility.ok) {
        throw new Error(
          `This backup can't be restored: ${compatibility.reason}.`
        );
      }
      const catalogTableNames = new Set(catalog.tables.map((t) => t.name));

      const skipped = new Set([
        ...SECRET_TABLES,
        ...(mode === "reseed" ? RESEED_SKIPPED_TABLES : [])
      ]);
      const backupColumns = new Map(
        backup.manifest.tables.map((t) => [t.name, new Set(t.columns)])
      );
      const candidateTables = catalog.tables.filter(
        (t) =>
          !skipped.has(t.name) &&
          !isUserScopedIdentityTable(t) &&
          (backup.data[t.name]?.length ?? 0) > 0
      );

      // Reseed is additive into a fresh company: never touch a table the
      // target already populated itself — its identity seed, its triggers
      // (event subscriptions, search registry) or onboarding's own inserts
      // (location, employee job, groups). Asking the database which tables
      // are non-empty replaces every hand-maintained "skip" list and is
      // correct in both cases: a bare clone imports everything, an
      // identity-seeded onboard skips exactly what's already there.
      const byName = new Map(catalog.tables.map((t) => [t.name, t]));
      const importTables =
        mode === "reseed"
          ? await filterUnpopulated(
              db,
              candidateTables,
              byName,
              companyId,
              targetGroupId
            )
          : candidateTables;

      // Reseed: assign a fresh id to every row of every id-keyed table up
      // front so FK references can be rewritten in a single pass.
      const idMaps = new Map<string, Map<string, string>>();
      if (mode === "reseed") {
        for (const table of importTables) {
          if (!table.hasId) continue;
          // Only text/uuid ids get remapped — an int/serial id can't take a
          // nanoid (same gate as the restore path, so the two don't drift).
          const idType = table.columns.find((c) => c.name === "id")?.udtName;
          if (idType !== "uuid" && idType !== "text") continue;
          const map = new Map<string, string>();
          for (const row of backup.data[table.name]!) {
            if (typeof row.id === "string")
              map.set(row.id, newIdForTable(table));
          }
          idMaps.set(table.name, map);
        }
      }

      // Flat old-id → new-id lookup across every remapped table, used to rewrite
      // ids embedded in storage paths (e.g. `{co}/models/{modelId}.stl`) so the
      // restored files and their DB path columns line up. Empty in preserve mode.
      const idRewrite = new Map<string, string>();
      for (const map of idMaps.values()) {
        for (const [oldId, newId] of map) idRewrite.set(oldId, newId);
      }

      // Group-scoped data needs a destination group on the target company.
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
      let scrubCounter = 0;
      // FK columns pointing at a tenant table we did NOT import (it was already
      // populated by the target's own seed, or skipped). Their non-null source
      // ids don't exist here; collected so a dangling, non-nullable ref is
      // surfaced rather than silently corrupting referential integrity.
      const unresolvedRefs = new Set<string>();

      // One transform builder for both restore and reseed import
      // (buildRowTransforms in company-backup.ts) — the reseed-only policies are
      // passed as knobs; preserve mode (remap=false) copies verbatim.
      const remap = mode === "reseed";
      // Global substrate (companyId IS NULL) ids the backup omits but the target
      // holds by seed — a template's FK into a seeded global row resolves against
      // these instead of dangling.
      const substrateIds = remap
        ? await loadSubstrateIds(db, catalog, backup.data)
        : undefined;
      const scrubEmail = () => `import-${++scrubCounter}@example.test`;
      const recordUnresolvedRef = (desc: string) => unresolvedRefs.add(desc);

      const replicaMode = await canSetReplicationRole(db);
      if (!replicaMode) {
        console.warn(
          "session_replication_role unavailable — importing with triggers " +
            "and FK enforcement active; relying on topological order"
        );
      }

      const counts: Record<string, number> = {};

      await db.transaction().execute(async (trx) => {
        if (replicaMode) {
          await sql`SET LOCAL session_replication_role = 'replica'`.execute(
            trx
          );
        }

        const ledger: LedgerRow[] = [];

        for (const table of importTables) {
          const backupCols =
            backupColumns.get(table.name) ??
            new Set(Object.keys(backup.data[table.name]![0] ?? {}));
          const columns = table.columns.filter(
            (c) => !c.isGenerated && backupCols.has(c.name)
          );
          if (columns.length === 0) continue;

          const transforms = buildRowTransforms(table, columns, {
            remap,
            companyId,
            userId,
            targetGroupId,
            sourceCompanyId,
            idMaps,
            idRewrite,
            substrateIds,
            templateIndustryId: referencedTemplate
              ? templateIndustryId
              : undefined,
            skippedRefTables: skipped,
            catalogTableNames,
            onUnresolvedRef: recordUnresolvedRef,
            scrubEmail
          });
          const originalRows = backup.data[table.name]!;
          // Hot path: indexed loops (no per-row `forEach` closure), packed
          // output array, `out` keys in fixed column order (one hidden class
          // per table).
          const colCount = columns.length;
          let rows: Record<string, unknown>[] = [];
          for (let r = 0; r < originalRows.length; r++) {
            const row = originalRows[r]!;
            const out: Record<string, unknown> = {};
            for (let c = 0; c < colCount; c++) {
              out[columns[c]!.name] = transforms[c]!(row[columns[c]!.name]);
            }
            rows.push(out);
          }

          // Collapsing user references onto one user can produce duplicate
          // primary keys in user-keyed tables — keep the first of each.
          if (mode === "reseed" && !table.hasId && table.pkColumns.length > 0) {
            const seen = new Set<string>();
            rows = rows.filter((row) => {
              const key = JSON.stringify(table.pkColumns.map((c) => row[c]));
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
          }

          for (const batch of chunkArray(rows, INSERT_CHUNK_SIZE)) {
            await sql`
              INSERT INTO ${sql.id(table.name)}
                (${sql.join(columns.map((c) => sql.id(c.name)))})
              VALUES ${sql.join(
                batch.map(
                  (row) =>
                    sql`(${sql.join(
                      columns.map((c) => sql`${bindValue(row[c.name], c)}`)
                    )})`
                )
              )}
            `.execute(trx);
          }

          counts[table.name] = rows.length;

          // Revert ledger — one row per inserted row. For id-keyed tables
          // entityId is the (new) id; for composite-keyed tables it's the
          // JSON-encoded primary key tuple.
          if (table.pkColumns.length === 0) {
            console.warn("Table has no primary key — revert will skip it", {
              table: table.name
            });
            continue;
          }
          if (table.hasId) {
            // dedupe above only applies to composite-keyed tables, so the
            // transformed rows still align index-wise with the originals
            rows.forEach((row, i) => {
              ledger.push({
                entityType: table.name,
                entityId: row.id as string,
                externalId:
                  (originalRows[i]?.id as string) ?? (row.id as string)
              });
            });
          } else {
            for (const row of rows) {
              const key = JSON.stringify(
                table.pkColumns.map((c) => row[c] ?? null)
              );
              ledger.push({
                entityType: table.name,
                entityId: key,
                externalId: key
              });
            }
          }
        }

        for (const batch of chunkArray(ledger, INSERT_CHUNK_SIZE)) {
          await sql`
            INSERT INTO ${sql.id("externalIntegrationMapping")}
              ("entityType", "entityId", "integration", "externalId",
               "metadata", "companyId", "createdBy")
            VALUES ${sql.join(
              batch.map(
                (l) =>
                  sql`(${l.entityType}, ${l.entityId}, ${BACKUP_INTEGRATION},
                      ${l.externalId}, ${JSON.stringify({ importRunId })},
                      ${companyId}, ${userId})`
              )
            )}
          `.execute(trx);
        }
      });

      if (unresolvedRefs.size > 0) {
        console.warn(
          "Reseed kept non-nullable references to tables it did not import " +
            "(the target already had them, so source ids could not be " +
            "remapped). These may dangle — the template likely needs those " +
            "columns made nullable or those tables left out of the seed:",
          [...unresolvedRefs]
        );
      }

      // Storage files travel outside the transaction — failures here leave the
      // imported rows intact and are surfaced as warnings. Copy them server-side
      // from the artifact's `.assets/` folder into the shared `private` bucket,
      // with the path rewritten for the target company (and remapped ids on
      // reseed) to match the path columns rewritten above.
      //
      // A referenced template skips this entirely: its assets already live once
      // per workspace at `_templates/<industryId>/` (the path columns above now
      // point there), so copying them into `{companyId}/` would defeat the
      // purpose.
      let storageUploaded = 0;
      if (!referencedTemplate) {
        const assets = await restoreAssetsFromBackup(client, {
          files: backup.manifest.storage,
          srcBucket: companyId,
          srcPrefix: backupAssetsDir(name),
          sourceCompanyId,
          companyId,
          idRewrite
        });
        storageUploaded = assets.copied;
      }

      // Onboarding-from-a-backup commits immediately — no human review — so
      // drop the revert ledger and skip the pending state.
      if (autoFinalize) {
        await sql`
          DELETE FROM ${sql.id("externalIntegrationMapping")}
          WHERE ${sql.id("integration")} = ${BACKUP_INTEGRATION}
            AND ${sql.id("companyId")} = ${companyId}
            AND metadata->>'importRunId' = ${importRunId}
        `.execute(db);
      }

      const totalRows = Object.values(counts).reduce((sum, n) => sum + n, 0);
      console.log(
        autoFinalize
          ? "Company import complete — auto-finalized"
          : "Company import complete — pending finalize/revert",
        {
          companyId,
          importRunId,
          mode,
          tables: Object.keys(counts).length,
          rows: totalRows,
          storageUploaded,
          ...(referencedTemplate
            ? { referencedTemplate: templateIndustryId }
            : {})
        }
      );

      return {
        importRunId,
        tables: Object.keys(counts).length,
        rows: totalRows,
        storageUploaded
      };
    });
  }
);
