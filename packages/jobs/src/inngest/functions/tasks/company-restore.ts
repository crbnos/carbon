// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { requireBackupsEntitlement } from "@carbon/ee/backups.server";
import { getLogger } from "@carbon/logger";
import { NonRetriableError } from "inngest";
import { getCompanyTableCatalog } from "../../../backups/catalog";
import { assertBackupImportable } from "../../../backups/compatibility";
import { writeCompanyBackup } from "../../../backups/dump";
import { backupDir, backupNameFromSource } from "../../../backups/format";
import {
  getCompanyGroupId,
  readBackupForLoad,
  resolveRestoreScope,
  wipeAndLoad
} from "../../../backups/load";
import {
  assertReferentiallyClosed,
  loadSubstrateIds
} from "../../../backups/remap";
import {
  type JobProgress,
  RESTORE_INTEGRATION,
  throttleProgress
} from "../../../backups/runs";
import {
  ExportScopeViolationError,
  type ScopeViolation
} from "../../../backups/scope";
import {
  removeBucketPrefix,
  restoreAssetsFromBackup
} from "../../../backups/storage";
import { getJobDatabaseClient } from "../../../db";
import { inngest } from "../../client";

const log = getLogger("jobs", "company-restore");

type ServiceRole = ReturnType<typeof getCarbonServiceRole>;

type RestoreStatus = "running" | "ready" | "failed" | "reverting";
type RestoreMeta = {
  restoreRunId: string;
  status: RestoreStatus;
  snapshotPath?: string | null;
  rows?: number;
  label?: string | null;
  error?: string | null;
  /** ISO timestamp of the first heartbeat — the UI shows elapsed time from it. */
  startedAt?: string;
  /** Current phase + done/total; updated as the run progresses (throttled). */
  progress?: JobProgress;
  /** True when the restored backup came from another company (its rows were
   *  re-stamped onto this one). */
  foreign?: boolean;
  /** True when the run touched group-scoped data (chart of accounts, currencies,
   *  dimensions) — only when this company is its group's sole member. A revert
   *  must wipe + reload the same scope. */
  includeGroup?: boolean;
  /** The backup being restored + file choice — kept so a recovery action can
   *  restart the same restore. */
  filePath?: string;
  includeStorage?: "none" | "all";
  /** Set when the pre-restore snapshot refused because the LIVE data has rows
   *  whose NOT-NULL FK escapes company scope. */
  reason?: "scope-violations";
  /** Per FK EDGE — the breakdown, never summable into a row count. */
  violations?: ScopeViolation[];
  /** DISTINCT rows involved, per table — what the user is told. */
  violationRowsByTable?: Array<{ table: string; rows: number }>;
};

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
  // An unread marker is not an absent one: read as absent, a retry would
  // snapshot the restored data over the pre-restore copy.
  if (marker.error) {
    throw new Error(
      `Failed to read the restore marker: ${marker.error.message}`
    );
  }
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

  const written = existing
    ? await client
        .from("externalIntegrationMapping")
        .update({
          metadata,
          externalId: metadata.snapshotPath ?? ""
        })
        .eq("id", existing.id)
        .eq("companyId", companyId)
    : await client.from("externalIntegrationMapping").insert({
        entityType: "restore",
        entityId: restoreRunId,
        integration: RESTORE_INTEGRATION,
        externalId: metadata.snapshotPath ?? "",
        metadata,
        companyId,
        createdBy: userId ?? ""
      });
  // The marker holds the snapshot path a revert needs: a lost write must stop
  // the restore before the wipe, not be found out at revert time.
  if (written.error) {
    throw new Error(
      `Failed to record the restore's state: ${written.error.message}`
    );
  }
}

/** A terminal "failed" write from an error path: never hides the error itself. */
async function markRestoreFailed(
  client: ServiceRole,
  args: Parameters<typeof writeRestoreMarker>[1]
): Promise<void> {
  try {
    await writeRestoreMarker(client, args);
  } catch (markerErr) {
    log.error("Failed to mark the restore failed", {
      restoreRunId: args.restoreRunId,
      error: markerErr instanceof Error ? markerErr.message : String(markerErr)
    });
  }
}

// The marker write is a separate connection, so this is safe to call inside the
// wipe+load transaction.
function makeProgressReporter(
  client: ServiceRole,
  companyId: string,
  restoreRunId: string
): (p: JobProgress) => Promise<void> {
  // Progress is a nicety: a failed write is logged, never fails the restore.
  return throttleProgress((progress) =>
    writeRestoreMarker(client, {
      companyId,
      restoreRunId,
      patch: { progress }
    }).catch((err) =>
      log.warn("Failed to record restore progress", {
        restoreRunId,
        error: err instanceof Error ? err.message : String(err)
      })
    )
  );
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
  async ({ event, step, logger }) => {
    const { companyId, userId, filePath, restoreRunId, label, includeStorage } =
      event.data;

    await requireBackupsEntitlement(companyId);

    return await step.run("restore-company", async () => {
      const client = getCarbonServiceRole();
      const db = getJobDatabaseClient();

      // Idempotency — a retry after the run already reached a terminal state
      // must not wipe again.
      const existing = await readRestoreMarker(client, companyId, restoreRunId);
      if (existing && existing.metadata.status === "ready") {
        logger.info("Restore already applied, skipping", { restoreRunId });
        return { restoreRunId, skipped: true };
      }

      // Marker exists from the first heartbeat onward, so the UI can tell
      // "running" from "failed" rather than inferring from absence.
      await writeRestoreMarker(client, {
        companyId,
        userId,
        restoreRunId,
        patch: {
          status: "running",
          label: label ?? null,
          filePath,
          includeStorage,
          startedAt: existing?.metadata.startedAt ?? new Date().toISOString()
        }
      });
      const report = makeProgressReporter(client, companyId, restoreRunId);

      try {
        const name = backupNameFromSource(filePath);
        const catalog = await getCompanyTableCatalog(db);
        const backup = await readBackupForLoad(
          client,
          companyId,
          name,
          catalog
        );
        assertBackupImportable(catalog, backup);
        const { targetGroupId, includeGroup } = await resolveRestoreScope(
          client,
          companyId
        );

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

        // Referential-closure preflight — BEFORE the snapshot/wipe so a backup
        // that would dangle a NOT-NULL FK fails with the complete list of gaps
        // and leaves the company's data untouched, rather than throwing on the
        // first bad row partway through the load. A company row's FK into shared
        // substrate (global `material*`/currency rows the backup omits) is not a
        // gap when the row exists in THIS target's seed — loadSubstrateIds probes
        // the live target for exactly those ids so the guard doesn't false-flag
        // them, while still catching a ref present in neither backup nor target.
        const substrateIds = await loadSubstrateIds(db, catalog, backup.data);
        const closure = assertReferentiallyClosed(
          catalog,
          backup,
          substrateIds
        );
        if (!closure.ok) {
          throw new Error(`This backup can't be restored: ${closure.reason}`);
        }

        // 1. Snapshot current state (incl. storage) so a revert can undo this.
        //    IDEMPOTENT: if a prior attempt already recorded a snapshot, reuse
        //    it — never re-snapshot, or a retry after the wipe committed would
        //    capture the WIPED state and overwrite the real pre-restore copy.
        let snapshotPath = existing?.metadata.snapshotPath ?? undefined;
        if (!snapshotPath) {
          await report({ phase: "snapshot", done: 0, total: 1 });
          snapshotPath = `_pre-restore-${restoreRunId}`;
          await writeCompanyBackup(client, db, {
            companyId,
            userId,
            label: `Pre-restore ${restoreRunId}`,
            includeStorage: "all",
            name: snapshotPath
          });
          await writeRestoreMarker(client, {
            companyId,
            userId,
            restoreRunId,
            patch: { snapshotPath, foreign, includeGroup }
          });
          await report({ phase: "snapshot", done: 1, total: 1 });
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
          targetGroupId,
          substrateIds,
          onProgress: report
        });

        // 3. Files (best-effort, non-transactional) — copied BEFORE marking ready
        //    so the progress dialog only reports "complete" once the data AND the
        //    files are actually in place, never sooner. The data txn already
        //    committed above and the copy never throws (per-file warnings only),
        //    so a storage hiccup still can't flip a committed restore to "failed".
        //    A revert restores files from the snapshot.
        if (includeStorage === "all") {
          const fileCount =
            backup.manifest.storage?.filter((f) => f.included).length ?? 0;
          try {
            await report({ phase: "files", done: 0, total: fileCount });
            await restoreAssetsFromBackup(
              client,
              {
                files: backup.manifest.storage,
                name,
                sourceCompanyId: backup.manifest.sourceCompanyId,
                companyId,
                idRewrite
              },
              (done, total) => report({ phase: "files", done, total })
            );
          } catch (storageErr) {
            logger.warn("Restore: file restore failed (data is intact)", {
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

        logger.info("Company restore complete — pending keep/revert", {
          companyId,
          restoreRunId,
          rows,
          foreign,
          snapshotPath
        });
        return { restoreRunId, rows, snapshotPath };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await markRestoreFailed(client, {
          companyId,
          userId,
          restoreRunId,
          patch: {
            status: "failed",
            error: message,
            ...(err instanceof ExportScopeViolationError
              ? {
                  reason: "scope-violations",
                  violations: err.violations,
                  violationRowsByTable: err.rowsByTable
                }
              : {})
          }
        });
        logger.error("Company restore failed", {
          companyId,
          restoreRunId,
          error: message
        });
        // The snapshot guard's verdict is deterministic; a retry re-fails and
        // flickers the marker running → failed under the user's recovery button.
        if (err instanceof ExportScopeViolationError) {
          throw new NonRetriableError(message, { cause: err });
        }
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
  async ({ event, step, logger }) => {
    const { companyId, restoreRunId } = event.data;

    // No entitlement gate here: finalize only RESOLVES an already-started (and
    // already-gated) restore. If BACKUPS lapsed while the restore sat "ready",
    // gating this would strand it — marker stuck "ready", snapshot orphaned,
    // with no recovery path (retries: 1). The lock is on companyRestoreFunction.
    return await step.run("finalize-restore", async () => {
      const client = getCarbonServiceRole();
      const marker = await readRestoreMarker(client, companyId, restoreRunId);
      const snapshotPath = marker?.metadata.snapshotPath;

      if (snapshotPath) {
        await removeBucketPrefix(client, companyId, backupDir(snapshotPath));
      }
      await deleteRestoreMarker(client, companyId, restoreRunId);

      logger.info("Company restore kept", { companyId, restoreRunId });
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
  async ({ event, step, logger }) => {
    const { companyId, restoreRunId } = event.data;

    // No entitlement gate here (see finalize): revert must always be able to
    // undo a pending restore and return the pre-restore snapshot, even if
    // BACKUPS lapsed while it sat "ready" — blocking it would strand the company
    // mid-restore. The lock is on companyRestoreFunction (the start).
    return await step.run("revert-restore", async () => {
      const client = getCarbonServiceRole();
      const db = getJobDatabaseClient();

      const marker = await readRestoreMarker(client, companyId, restoreRunId);
      const snapshotPath = marker?.metadata.snapshotPath;
      if (!snapshotPath) {
        logger.info("Nothing to revert — no snapshot on marker", {
          restoreRunId
        });
        return { restoreRunId, reverted: false };
      }

      // Flag the run as reverting so the progress modal can show it live.
      await writeRestoreMarker(client, {
        companyId,
        restoreRunId,
        patch: { status: "reverting", startedAt: new Date().toISOString() }
      });
      const report = makeProgressReporter(client, companyId, restoreRunId);

      try {
        // The snapshot is THIS company's own pre-restore data — ids and scope
        // already belong here, so it loads verbatim (no remap, no ownership
        // check). Wipe + reload the SAME scope the forward restore touched so the
        // undo is exact — including group data (chart of accounts) when the
        // forward run covered it.
        const catalog = await getCompanyTableCatalog(db);
        const snapshot = await readBackupForLoad(
          client,
          companyId,
          snapshotPath,
          catalog
        );
        const targetGroupId = await getCompanyGroupId(client, companyId);
        const { rows, idRewrite } = await wipeAndLoad(db, catalog, snapshot, {
          companyId,
          userId: "",
          remap: false,
          includeGroup: marker?.metadata.includeGroup ?? false,
          targetGroupId,
          onProgress: report
        });
        const fileCount =
          snapshot.manifest.storage?.filter((f) => f.included).length ?? 0;
        await report({ phase: "files", done: 0, total: fileCount });
        await restoreAssetsFromBackup(
          client,
          {
            files: snapshot.manifest.storage,
            name: snapshotPath,
            sourceCompanyId: companyId,
            companyId,
            idRewrite
          },
          (done, total) => report({ phase: "files", done, total })
        );

        await removeBucketPrefix(client, companyId, backupDir(snapshotPath));
        await deleteRestoreMarker(client, companyId, restoreRunId);

        logger.info("Company restore reverted", {
          companyId,
          restoreRunId,
          rows
        });
        return { restoreRunId, reverted: true, rows };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Leave the marker (with the snapshot still set) so the user can retry
        // the revert; surface the failure.
        await markRestoreFailed(client, {
          companyId,
          restoreRunId,
          patch: { status: "failed", error: `Revert failed: ${message}` }
        });
        logger.error("Company restore revert failed", {
          companyId,
          restoreRunId,
          error: message
        });
        throw err;
      }
    });
  }
);
