import { gunzipSync } from "node:zlib";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { chunkArray } from "@carbon/utils";
import { sql } from "kysely";
import { nanoid } from "nanoid";
import { inngest } from "../../client";
import type { ColumnInfo, CompanyBackup, TableInfo } from "./company-backup";
import {
  assertBackupImportable,
  BACKUP_INTEGRATION,
  BACKUP_KIND,
  bindValue,
  canSetReplicationRole,
  filterUnpopulated,
  getCompanyTableCatalog,
  getJobDatabaseClient,
  RESEED_SKIPPED_TABLES,
  SECRET_TABLES
} from "./company-backup";

const INSERT_CHUNK_SIZE = 200;

/** FKs to these tables collapse to the importing user in reseed mode. */
const USER_REF_TABLES = new Set(["user", "employee"]);

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
    const { companyId, userId, filePath, mode, importRunId, autoFinalize } =
      event.data;

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

      const download = await client.storage.from(companyId).download(filePath);
      if (download.error || !download.data) {
        throw new Error(
          `Failed to download artifact ${filePath}: ${download.error?.message}`
        );
      }

      const backup = JSON.parse(
        gunzipSync(Buffer.from(await download.data.arrayBuffer())).toString()
      ) as CompanyBackup;

      if (backup.manifest?.kind !== BACKUP_KIND) {
        throw new Error("File is not a Carbon company backup");
      }
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

      const skipped = new Set([
        ...SECRET_TABLES,
        ...(mode === "reseed" ? RESEED_SKIPPED_TABLES : [])
      ]);
      const backupColumns = new Map(
        backup.manifest.tables.map((t) => [t.name, new Set(t.columns)])
      );
      const candidateTables = catalog.tables.filter(
        (t) => !skipped.has(t.name) && (backup.data[t.name]?.length ?? 0) > 0
      );

      // Reseed is additive into a fresh company: never touch a table the
      // target already populated itself — its identity seed, its triggers
      // (event subscriptions, search registry) or onboarding's own inserts
      // (location, employee job, groups). Asking the database which tables
      // are non-empty replaces every hand-maintained "skip" list and is
      // correct in both cases: a bare clone imports everything, an
      // identity-seeded onboard skips exactly what's already there.
      const importTables =
        mode === "reseed"
          ? await filterUnpopulated(
              db,
              candidateTables,
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
          const map = new Map<string, string>();
          for (const row of backup.data[table.name]!) {
            if (typeof row.id === "string") map.set(row.id, nanoid());
          }
          idMaps.set(table.name, map);
        }
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

      // What happens to a column depends only on its metadata and the mode,
      // never on the row — so compile one transform per column per table and
      // keep the per-row path a flat loop.
      type Transform = (value: unknown) => unknown;
      const identity: Transform = (v) => v;

      const buildColumnTransforms = (
        table: TableInfo,
        columns: ColumnInfo[]
      ): Transform[] => {
        if (mode !== "reseed") return columns.map(() => identity);

        const fkByColumn = new Map(
          table.foreignKeys.map((fk) => [fk.column, fk])
        );

        return columns.map((col) => {
          let base = identity;
          const fk = fkByColumn.get(col.name);

          if (col.name === "id" && table.hasId) {
            const map = idMaps.get(table.name)!;
            base = (v) => map.get(v as string) ?? v;
          } else if (col.name === "companyId") {
            base = () => companyId;
          } else if (col.name === "companyGroupId") {
            base = () => targetGroupId;
          } else if (fk) {
            if (USER_REF_TABLES.has(fk.refTable)) {
              base = (v) => (v == null ? v : userId);
            } else if (fk.refTable === "company") {
              base = (v) => (v === sourceCompanyId ? companyId : v);
            } else if (fk.refTable === "companyGroup") {
              base = (v) => (v == null ? v : targetGroupId);
            } else if (skipped.has(fk.refTable) && col.isNullable) {
              base = () => null;
            } else if (fk.refColumn === "id" && idMaps.has(fk.refTable)) {
              const map = idMaps.get(fk.refTable)!;
              base = (v) => (v == null ? v : (map.get(v as string) ?? v));
            }
          }

          // PII scrub — emails in a copied template never belong to the
          // target company's people.
          if (/email/i.test(col.name)) {
            const inner = base;
            return (v) => {
              const value = inner(v);
              return typeof value === "string" && value.includes("@")
                ? `import-${++scrubCounter}@example.test`
                : value;
            };
          }
          return base;
        });
      };

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

          const transforms = buildColumnTransforms(table, columns);
          const originalRows = backup.data[table.name]!;
          let rows = originalRows.map((row) => {
            const out: Record<string, unknown> = {};
            columns.forEach((col, i) => {
              out[col.name] = transforms[i]!(row[col.name]);
            });
            return out;
          });

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

      // Storage files travel outside the transaction — failures here leave
      // the imported rows intact and are surfaced as warnings.
      let storageUploaded = 0;
      if (backup.storage) {
        for (const [path, base64] of Object.entries(backup.storage)) {
          const upload = await client.storage
            .from(companyId)
            .upload(path, Buffer.from(base64, "base64"), { upsert: false });
          if (upload.error) {
            console.warn("Failed to upload storage file", {
              path,
              error: upload.error.message
            });
          } else {
            storageUploaded++;
          }
        }
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
          storageUploaded
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
