import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { chunkArray } from "@carbon/utils";
import { sql } from "kysely";
import { inngest } from "../../client";
import type {
  Catalog,
  ColumnInfo,
  CompanyBackup,
  TableInfo
} from "./company-backup";
import {
  assertBackupImportable,
  assertWipeSafe,
  backupAssetsDir,
  backupDir,
  backupNameFromSource,
  bindValue,
  canSetReplicationRole,
  getCompanyTableCatalog,
  getJobDatabaseClient,
  newIdForTable,
  RESTORE_INTEGRATION,
  readBackup,
  removeStoragePrefix,
  restoreAssetsFromBackup,
  rewriteStoragePath,
  STORAGE_PATH_COLUMNS,
  selectWipeableTables,
  wipeScopedData,
  writeBackupManifest
} from "./company-backup";
import { buildCompanyBackup } from "./company-export";

const INSERT_CHUNK_SIZE = 200;

/** FKs to these collapse to the importing user when re-stamping a foreign backup. */
const USER_REF_TABLES = new Set(["user", "employee"]);

type ServiceRole = ReturnType<typeof getCarbonServiceRole>;
type JobDatabase = ReturnType<typeof getJobDatabaseClient>;

type Transform = (value: unknown) => unknown;

/**
 * Per-column transforms used when re-stamping a FOREIGN backup onto this company:
 * every id is remapped to a fresh one, companyId/companyGroupId point at the
 * target, FKs follow the id remap, user refs collapse to the importing user, and
 * storage paths are rewritten. For an OWN backup (remap=false) every column is
 * identity — ids and scope already belong here.
 */
function buildRowTransforms(
  table: TableInfo,
  columns: ColumnInfo[],
  ctx: {
    remap: boolean;
    companyId: string;
    userId: string;
    targetGroupId: string | null;
    sourceCompanyId: string;
    idMaps: Map<string, Map<string, string>>;
    idRewrite: Map<string, string>;
  }
): Transform[] {
  const identity: Transform = (v) => v;
  if (!ctx.remap) return columns.map(() => identity);

  const fkByColumn = new Map(table.foreignKeys.map((fk) => [fk.column, fk]));
  return columns.map((col) => {
    const fk = fkByColumn.get(col.name);
    if (col.name === "id" && table.hasId) {
      const map = ctx.idMaps.get(table.name)!;
      return (v) => map.get(v as string) ?? v;
    }
    if (col.name === "companyId") return () => ctx.companyId;
    if (col.name === "companyGroupId") return () => ctx.targetGroupId;
    if (STORAGE_PATH_COLUMNS.has(col.name)) {
      return (v) =>
        typeof v === "string"
          ? rewriteStoragePath(
              v,
              ctx.sourceCompanyId,
              ctx.companyId,
              ctx.idRewrite
            )
          : v;
    }
    if (fk) {
      if (USER_REF_TABLES.has(fk.refTable)) {
        return (v) => (v == null ? v : ctx.userId);
      }
      if (fk.refTable === "company") {
        return (v) => (v === ctx.sourceCompanyId ? ctx.companyId : v);
      }
      if (fk.refTable === "companyGroup") {
        return (v) => (v == null ? v : ctx.targetGroupId);
      }
      if (fk.refColumn === "id" && ctx.idMaps.has(fk.refTable)) {
        const map = ctx.idMaps.get(fk.refTable)!;
        return (v) => {
          if (v == null) return v;
          const mapped = map.get(v as string);
          if (mapped) return mapped;
          // The referenced row isn't in the backup. Keeping the stale id would
          // dangle (FK checks are relaxed during load, so it would commit and
          // only fail later in MRP/etc). Drop it when nullable; otherwise abort
          // the whole restore — never commit a corrupt reference.
          if (col.isNullable) return null;
          throw new Error(
            `Backup is inconsistent: ${table.name}.${col.name} references a ` +
              `${fk.refTable} (${String(v)}) that isn't in the backup.`
          );
        };
      }
    }
    return identity;
  });
}

/**
 * Wipe the company's restorable tables and reload them from `backup`. Two modes:
 * - `remap=false` (own backup / snapshot): ids and scope already belong to this
 *   company, so rows load verbatim.
 * - `remap=true` (foreign backup): the data belongs to another company, so every
 *   id is remapped and companyId/group/FKs are re-stamped onto this company —
 *   including the chart of accounts (group-scoped), which is why `includeGroup`
 *   is set for foreign restores.
 * Runs in one transaction with FK enforcement relaxed when possible.
 */
async function wipeAndLoad(
  db: JobDatabase,
  catalog: Catalog,
  backup: CompanyBackup,
  opts: {
    companyId: string;
    userId: string;
    remap: boolean;
    includeGroup: boolean;
    targetGroupId: string | null;
  }
): Promise<{ rows: number; idRewrite: Map<string, string> }> {
  const { companyId, userId, remap, includeGroup, targetGroupId } = opts;

  // Refuse if the schema would let a kept row dangle once we wipe (drift guard).
  const safe = assertWipeSafe(catalog);
  if (!safe.ok) {
    throw new Error(`Restore is unsafe for this schema: ${safe.reason}.`);
  }

  // Wipe every restorable table (so tables empty in the backup end up empty);
  // reload only those the backup actually has rows for.
  const byName = new Map(catalog.tables.map((t) => [t.name, t]));
  const wipeTables = selectWipeableTables(catalog, { includeGroup });
  const loadTables = wipeTables.filter(
    (t) => (backup.data[t.name]?.length ?? 0) > 0
  );
  const backupColumns = new Map(
    backup.manifest.tables.map((t) => [t.name, new Set(t.columns)])
  );

  // Foreign: assign a fresh id to every id-keyed row up front so FKs (and the
  // ids embedded in storage paths) can be rewritten in a single pass. Only remap
  // string ids (text/uuid) — integer/serial ids (e.g. `journal`) can't take a
  // nanoid, and since the table is wiped first their original ids are free to
  // reuse verbatim (FKs to them stay valid by keeping the original value).
  const idMaps = new Map<string, Map<string, string>>();
  const idRewrite = new Map<string, string>();
  if (remap) {
    for (const t of loadTables) {
      if (!t.hasId) continue;
      const idType = t.columns.find((c) => c.name === "id")?.udtName;
      if (idType !== "uuid" && idType !== "text") continue;
      const map = new Map<string, string>();
      for (const row of backup.data[t.name]!) {
        if (typeof row.id === "string") map.set(row.id, newIdForTable(t));
      }
      idMaps.set(t.name, map);
    }
    for (const map of idMaps.values()) {
      for (const [oldId, newId] of map) idRewrite.set(oldId, newId);
    }
  }

  const replicaMode = await canSetReplicationRole(db);
  let inserted = 0;

  await db.transaction().execute(async (trx) => {
    if (replicaMode) {
      await sql`SET LOCAL session_replication_role = 'replica'`.execute(trx);
    }

    await wipeScopedData(trx, wipeTables, byName, {
      companyId,
      companyGroupId: targetGroupId
    });

    for (const table of loadTables) {
      const backupCols =
        backupColumns.get(table.name) ??
        new Set(Object.keys(backup.data[table.name]![0] ?? {}));
      const columns = table.columns.filter(
        (c) => !c.isGenerated && backupCols.has(c.name)
      );
      if (columns.length === 0) continue;

      // Hot path. Plain indexed loops (no per-row `forEach` closure), packed
      // output array, and `out` keys assigned in a fixed column order so every
      // row of a table shares one hidden class. Own restore skips transforms
      // entirely (verbatim copy) — that call site would otherwise be megamorphic
      // across the per-column closures.
      const sourceRows = backup.data[table.name]!;
      const colCount = columns.length;
      const rows: Record<string, unknown>[] = [];
      if (remap) {
        const transforms = buildRowTransforms(table, columns, {
          remap,
          companyId,
          userId,
          targetGroupId,
          sourceCompanyId: backup.manifest.sourceCompanyId,
          idMaps,
          idRewrite
        });
        for (let r = 0; r < sourceRows.length; r++) {
          const row = sourceRows[r]!;
          const out: Record<string, unknown> = {};
          for (let c = 0; c < colCount; c++) {
            out[columns[c]!.name] = transforms[c]!(row[columns[c]!.name]);
          }
          rows.push(out);
        }
      } else {
        for (let r = 0; r < sourceRows.length; r++) {
          const row = sourceRows[r]!;
          const out: Record<string, unknown> = {};
          for (let c = 0; c < colCount; c++) {
            const name = columns[c]!.name;
            out[name] = row[name];
          }
          rows.push(out);
        }
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
      inserted += rows.length;
    }
  });

  return { rows: inserted, idRewrite };
}

type RestoreStatus = "running" | "ready" | "failed" | "reverting";
type RestoreMeta = {
  restoreRunId: string;
  status: RestoreStatus;
  snapshotPath?: string | null;
  rows?: number;
  label?: string | null;
  error?: string | null;
  /** True when the restored backup came from another company (its rows were
   *  re-stamped onto this one). */
  foreign?: boolean;
  /** True when the run touched group-scoped data (chart of accounts, currencies,
   *  dimensions) — only when this company is its group's sole member. A revert
   *  must wipe + reload the same scope. */
  includeGroup?: boolean;
};

async function getCompanyGroupId(
  client: ServiceRole,
  companyId: string
): Promise<string | null> {
  const company = await client
    .from("company")
    .select("companyGroupId")
    .eq("id", companyId)
    .single();
  if (company.error) throw new Error(company.error.message);
  return company.data?.companyGroupId ?? null;
}

async function readRestoreMarker(
  client: ServiceRole,
  companyId: string,
  restoreRunId: string
): Promise<{ id: string; metadata: RestoreMeta } | null> {
  const marker = await client
    .from("externalIntegrationMapping")
    .select("id, metadata")
    .eq("integration", RESTORE_INTEGRATION)
    .eq("companyId", companyId)
    .filter("metadata->>restoreRunId", "eq", restoreRunId)
    .maybeSingle();
  if (!marker.data) return null;
  return {
    id: marker.data.id,
    metadata: (marker.data.metadata ?? {}) as RestoreMeta
  };
}

/**
 * Upsert the restore marker, merging `patch` into its metadata. The marker is
 * the single source of truth for the restore's lifecycle — the status route and
 * the UI read `metadata.status` (running → ready, or failed with an error).
 */
async function writeRestoreMarker(
  client: ServiceRole,
  args: {
    companyId: string;
    restoreRunId: string;
    patch: Partial<RestoreMeta>;
    /** Required only when the marker doesn't exist yet (first write). */
    userId?: string;
  }
): Promise<void> {
  const { companyId, userId, restoreRunId, patch } = args;
  const existing = await readRestoreMarker(client, companyId, restoreRunId);
  const metadata: RestoreMeta = {
    restoreRunId,
    status: "running",
    ...existing?.metadata,
    ...patch
  };

  if (existing) {
    await client
      .from("externalIntegrationMapping")
      .update({
        metadata,
        externalId: metadata.snapshotPath ?? ""
      })
      .eq("id", existing.id)
      .eq("companyId", companyId);
  } else {
    await client.from("externalIntegrationMapping").insert({
      entityType: "restore",
      entityId: restoreRunId,
      integration: RESTORE_INTEGRATION,
      externalId: metadata.snapshotPath ?? "",
      metadata,
      companyId,
      createdBy: userId ?? ""
    });
  }
}

async function deleteRestoreMarker(
  client: ServiceRole,
  companyId: string,
  restoreRunId: string
): Promise<void> {
  await client
    .from("externalIntegrationMapping")
    .delete()
    .eq("integration", RESTORE_INTEGRATION)
    .eq("companyId", companyId)
    .filter("metadata->>restoreRunId", "eq", restoreRunId);
}

/**
 * In-place restore. Snapshots the company's current state to a hidden
 * `_pre-restore` file, wipes the company's data, then loads the backup. A
 * marker row records the snapshot path so the restore can be kept or reverted.
 */
export const companyRestoreFunction = inngest.createFunction(
  {
    id: "company-restore",
    retries: 1,
    concurrency: {
      // Shared across restore/finalize/revert (env scope + common key) so the
      // three never run concurrently for the same company.
      key: "'company-restore-' + event.data.companyId",
      scope: "env",
      limit: 1
    }
  },
  { event: "carbon/company-restore" },
  async ({ event, step }) => {
    const { companyId, userId, filePath, restoreRunId, label, includeStorage } =
      event.data;

    return await step.run("restore-company", async () => {
      const client = getCarbonServiceRole();
      const db = getJobDatabaseClient(1);

      // Idempotency — a retry after the run already reached a terminal state
      // must not wipe again.
      const existing = await readRestoreMarker(client, companyId, restoreRunId);
      if (existing && existing.metadata.status === "ready") {
        console.log("Restore already applied, skipping", { restoreRunId });
        return { restoreRunId, skipped: true };
      }

      // Marker exists from the first heartbeat onward, so the UI can tell
      // "running" from "failed" rather than inferring from absence.
      await writeRestoreMarker(client, {
        companyId,
        userId,
        restoreRunId,
        patch: { status: "running", label: label ?? null }
      });

      try {
        const name = backupNameFromSource(filePath);
        const backup = await readBackup(client, companyId, name);
        const targetGroupId = await getCompanyGroupId(client, companyId);

        // Group-scoped data (chart of accounts, currencies, dimensions) is shared
        // by every company in the group. We only wipe/reload it when this company
        // is the group's SOLE member — then the group is effectively this
        // company's, so a restore (own or foreign) covers it fully. In a
        // multi-company group it's left untouched and managed at the group level.
        const groupCompanyCount = targetGroupId
          ? ((
              await client
                .from("company")
                .select("id", { count: "exact", head: true })
                .eq("companyGroupId", targetGroupId)
            ).count ?? 1)
          : 0;
        const includeGroup = groupCompanyCount === 1;

        // A backup from ANOTHER company must re-stamp the chart of accounts onto
        // this group, so it's only allowed when the group is this company's alone.
        const foreign = backup.manifest.sourceCompanyId !== companyId;
        if (foreign && !includeGroup) {
          throw new Error(
            !targetGroupId
              ? "This backup is from a different company and carries a chart of " +
                  "accounts, but this company has no group to receive it."
              : "This backup belongs to a different company. Restoring it " +
                  "replaces shared data (chart of accounts) used by the other " +
                  "companies in this group, so it's only allowed in a " +
                  "single-company environment."
          );
        }

        const catalog = await getCompanyTableCatalog(db);
        const compatibility = assertBackupImportable(catalog, backup);
        if (!compatibility.ok) {
          throw new Error(
            `This backup can't be restored: ${compatibility.reason}.`
          );
        }

        // 1. Snapshot current state (incl. storage) so a revert can undo this.
        //    IDEMPOTENT: if a prior attempt already recorded a snapshot, reuse
        //    it — never re-snapshot, or a retry after the wipe committed would
        //    capture the WIPED state and overwrite the real pre-restore copy.
        let snapshotPath = existing?.metadata.snapshotPath ?? undefined;
        if (!snapshotPath) {
          // buildCompanyBackup writes the snapshot's table files; the manifest is
          // written last (its presence marks the snapshot complete). The marker
          // stores the folder name.
          snapshotPath = `_pre-restore-${restoreRunId}`;
          const snapshot = await buildCompanyBackup(client, db, {
            companyId,
            userId,
            label: `Pre-restore ${restoreRunId}`,
            includeStorage: "all",
            name: snapshotPath
          });
          await writeBackupManifest(
            client,
            companyId,
            snapshotPath,
            snapshot.manifest
          );
          await writeRestoreMarker(client, {
            companyId,
            userId,
            restoreRunId,
            patch: { snapshotPath, foreign, includeGroup }
          });
        }

        // 2. Wipe + load (atomic). If this throws, the transaction rolls back —
        //    the company's data is untouched and the marker goes to "failed".
        //    Re-running on retry is safe: the wipe clears before the load, so a
        //    second pass produces the same result. Foreign backups remap ids +
        //    scope (and the group-scoped accounts).
        const { rows, idRewrite } = await wipeAndLoad(db, catalog, backup, {
          companyId,
          userId,
          remap: foreign,
          includeGroup,
          targetGroupId
        });

        // 3. Files (best-effort, non-transactional) — copied BEFORE marking ready
        //    so the progress dialog only reports "complete" once the data AND the
        //    files are actually in place, never sooner. The data txn already
        //    committed above and the copy never throws (per-file warnings only),
        //    so a storage hiccup still can't flip a committed restore to "failed".
        //    A revert restores files from the snapshot.
        if (includeStorage === "all") {
          try {
            await restoreAssetsFromBackup(client, {
              files: backup.manifest.storage,
              srcBucket: companyId,
              srcPrefix: backupAssetsDir(name),
              sourceCompanyId: backup.manifest.sourceCompanyId,
              companyId,
              idRewrite
            });
          } catch (storageErr) {
            console.warn("Restore: file restore failed (data is intact)", {
              restoreRunId,
              error:
                storageErr instanceof Error
                  ? storageErr.message
                  : String(storageErr)
            });
          }
        }

        // 4. Terminal: data committed and files copied — the run is fully done.
        await writeRestoreMarker(client, {
          companyId,
          userId,
          restoreRunId,
          patch: { status: "ready", rows }
        });

        console.log("Company restore complete — pending keep/revert", {
          companyId,
          restoreRunId,
          rows,
          foreign,
          snapshotPath
        });
        return { restoreRunId, rows, snapshotPath };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await writeRestoreMarker(client, {
          companyId,
          userId,
          restoreRunId,
          patch: { status: "failed", error: message }
        });
        console.error("Company restore failed", {
          companyId,
          restoreRunId,
          error: message
        });
        throw err;
      }
    });
  }
);

/** Keep an in-place restore — delete the pre-restore snapshot + marker. */
export const companyRestoreFinalizeFunction = inngest.createFunction(
  {
    id: "company-restore-finalize",
    retries: 1,
    concurrency: {
      // Shared across restore/finalize/revert (env scope + common key) so the
      // three never run concurrently for the same company.
      key: "'company-restore-' + event.data.companyId",
      scope: "env",
      limit: 1
    }
  },
  { event: "carbon/company-restore-finalize" },
  async ({ event, step }) => {
    const { companyId, restoreRunId } = event.data;

    return await step.run("finalize-restore", async () => {
      const client = getCarbonServiceRole();
      const marker = await readRestoreMarker(client, companyId, restoreRunId);
      const snapshotPath = marker?.metadata.snapshotPath;

      if (snapshotPath) {
        await removeStoragePrefix(client, companyId, backupDir(snapshotPath));
      }
      await deleteRestoreMarker(client, companyId, restoreRunId);

      console.log("Company restore kept", { companyId, restoreRunId });
      return { restoreRunId, kept: true };
    });
  }
);

/** Undo an in-place restore — wipe again and reload the pre-restore snapshot. */
export const companyRestoreRevertFunction = inngest.createFunction(
  {
    id: "company-restore-revert",
    retries: 1,
    concurrency: {
      // Shared across restore/finalize/revert (env scope + common key) so the
      // three never run concurrently for the same company.
      key: "'company-restore-' + event.data.companyId",
      scope: "env",
      limit: 1
    }
  },
  { event: "carbon/company-restore-revert" },
  async ({ event, step }) => {
    const { companyId, restoreRunId } = event.data;

    return await step.run("revert-restore", async () => {
      const client = getCarbonServiceRole();
      const db = getJobDatabaseClient(1);

      const marker = await readRestoreMarker(client, companyId, restoreRunId);
      const snapshotPath = marker?.metadata.snapshotPath;
      if (!snapshotPath) {
        console.log("Nothing to revert — no snapshot on marker", {
          restoreRunId
        });
        return { restoreRunId, reverted: false };
      }

      // Flag the run as reverting so the progress modal can show it live.
      await writeRestoreMarker(client, {
        companyId,
        restoreRunId,
        patch: { status: "reverting" }
      });

      try {
        // The snapshot is THIS company's own pre-restore data — ids and scope
        // already belong here, so it loads verbatim (no remap, no ownership
        // check). Wipe + reload the SAME scope the forward restore touched so the
        // undo is exact — including group data (chart of accounts) when the
        // forward run covered it.
        const snapshot = await readBackup(client, companyId, snapshotPath);
        const targetGroupId = await getCompanyGroupId(client, companyId);
        const catalog = await getCompanyTableCatalog(db);
        const { rows, idRewrite } = await wipeAndLoad(db, catalog, snapshot, {
          companyId,
          userId: "",
          remap: false,
          includeGroup: marker?.metadata.includeGroup ?? false,
          targetGroupId
        });
        await restoreAssetsFromBackup(client, {
          files: snapshot.manifest.storage,
          srcBucket: companyId,
          srcPrefix: backupAssetsDir(snapshotPath),
          sourceCompanyId: companyId,
          companyId,
          idRewrite
        });

        await removeStoragePrefix(client, companyId, backupDir(snapshotPath));
        await deleteRestoreMarker(client, companyId, restoreRunId);

        console.log("Company restore reverted", {
          companyId,
          restoreRunId,
          rows
        });
        return { restoreRunId, reverted: true, rows };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Leave the marker (with the snapshot still set) so the user can retry
        // the revert; surface the failure.
        await writeRestoreMarker(client, {
          companyId,
          restoreRunId,
          patch: { status: "failed", error: `Revert failed: ${message}` }
        });
        console.error("Company restore revert failed", {
          companyId,
          restoreRunId,
          error: message
        });
        throw err;
      }
    });
  }
);
