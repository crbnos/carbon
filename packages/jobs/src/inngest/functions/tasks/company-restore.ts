// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { requireBackupsEntitlement } from "@carbon/ee/backups.server";
import { getCompanyTableCatalog } from "../../../backups/catalog";
import { assertBackupImportable } from "../../../backups/compatibility";
import type { CompanyBackup } from "../../../backups/format";
import {
  readBackupForLoad,
  resolveRestoreScope,
  wipeAndLoad
} from "../../../backups/load";
import {
  assertReferentiallyClosed,
  loadSubstrateIds,
  scanBackup
} from "../../../backups/remap";
import {
  assertNoPendingChange,
  DUMP_CONCURRENCY,
  failRun,
  failStuckRun,
  keepRun,
  PER_COMPANY_CONCURRENCY,
  progressWriter,
  RESTORE_INTEGRATION,
  type RestoreRunMeta,
  resumeRun,
  revertRun,
  runMarker,
  startRun,
  takeSnapshot
} from "../../../backups/runs";
import {
  assetTargets,
  listCompanyFiles,
  restoreAssetsFromBackup
} from "../../../backups/storage";
import { getJobDatabaseClient } from "../../../db";
import { inngest } from "../../client";

const restoreMarker = (
  client: ReturnType<typeof getCarbonServiceRole>,
  args: { companyId: string; restoreRunId: string; userId?: string }
) =>
  runMarker<RestoreRunMeta>(client, {
    integration: RESTORE_INTEGRATION,
    entityType: "restore",
    entityId: args.restoreRunId,
    companyId: args.companyId,
    userId: args.userId ?? "",
    identity: { restoreRunId: args.restoreRunId }
  });

/**
 * In-place restore. Snapshots the company's current data, wipes it, then loads
 * the backup. The marker holds the snapshot until the restore is kept or reverted.
 */
export const companyRestoreFunction = inngest.createFunction(
  {
    id: "company-restore",
    retries: 1,
    concurrency: [PER_COMPANY_CONCURRENCY, DUMP_CONCURRENCY],
    onFailure: ({ event, error }) => {
      const { companyId, restoreRunId } = event.data.event.data;
      return failStuckRun(
        restoreMarker(getCarbonServiceRole(), { companyId, restoreRunId }),
        error,
        "running"
      );
    }
  },
  { event: "carbon/company-restore" },
  async ({ event, step, logger }) => {
    const {
      companyId,
      userId,
      filePath: name,
      restoreRunId,
      includeStorage
    } = event.data;

    // Its own step, so the work step below can tell a marker the user removed
    // (kept, dismissed, reverted during a retry backoff) from one never written.
    await step.run("claim-restore", async () => {
      const marker = restoreMarker(getCarbonServiceRole(), {
        companyId,
        restoreRunId,
        userId
      });
      if (!(await marker.read())) {
        await startRun(marker, { filePath: name, includeStorage });
      }
    });

    return await step.run("restore-company", async () => {
      const client = getCarbonServiceRole();
      const db = getJobDatabaseClient();
      const marker = restoreMarker(client, { companyId, restoreRunId, userId });

      const existing = await marker.read();
      const resume = resumeRun(existing);
      if (resume === "skip") {
        logger.info("Restore already settled or resolved, skipping", {
          restoreRunId,
          status: existing?.status ?? null
        });
        return { restoreRunId, skipped: true };
      }

      await startRun(marker, {
        filePath: name,
        includeStorage,
        ...(existing?.startedAt ? { startedAt: existing.startedAt } : {})
      });
      const report = progressWriter(marker);

      const listPresent = async () =>
        includeStorage === "all"
          ? new Set(
              (await listCompanyFiles(client, companyId, companyId)).map(
                (f) => f.path
              )
            )
          : null;

      // Files before `ready`, so the page reports complete only once the data
      // and the files are in place. The data is committed by now: a storage
      // error never fails the run over a loaded backup; it returns the note
      // the ready run shows.
      const MISSING_FILES =
        "The data was restored, but some files could not be copied.";
      const copyFiles = async (
        backup: CompanyBackup,
        present: Set<string> | null,
        idRewrite: Map<string, string>
      ): Promise<string | null> => {
        if (!present) return null;
        try {
          const assets = {
            files: backup.manifest.storage,
            name,
            sourceCompanyId: backup.manifest.sourceCompanyId,
            companyId,
            idRewrite
          };
          // Recorded before copying, so a revert can take back exactly the
          // files this restore creates. A retry keeps an earlier attempt's.
          const addedFiles = [
            ...new Set([
              ...(existing?.addedFiles ?? []),
              ...assetTargets(assets)
                .map((t) => t.target)
                .filter((p) => !present.has(p))
            ])
          ];
          await marker.write({ addedFiles });
          const { failed } = await restoreAssetsFromBackup(
            client,
            assets,
            (done, total) => report({ phase: "files", done, total })
          );
          return failed > 0 ? MISSING_FILES : null;
        } catch (err) {
          logger.error("Restore loaded the data but not its files", {
            companyId,
            restoreRunId,
            error: err instanceof Error ? err.message : String(err)
          });
          return MISSING_FILES;
        }
      };

      try {
        if (resume === "finish") {
          const catalog = await getCompanyTableCatalog(db);
          const backup = await readBackupForLoad(
            client,
            companyId,
            name,
            catalog
          );
          // An own restore loads ids verbatim (no rewrite), so its file phase
          // repeats exactly. A foreign restore's ids were minted at random by
          // the attempt that committed, and the paths they rewrite are lost.
          const foreign = backup.manifest.sourceCompanyId !== companyId;
          let note: string | null = null;
          if (foreign && includeStorage === "all") {
            note =
              "The data was restored, but the job stopped before copying " +
              "every file, and a restore from another company can't resume " +
              "that. Some files may be missing.";
            logger.warn("Resumed foreign restore without its files", {
              companyId,
              restoreRunId
            });
          } else {
            note = await copyFiles(backup, await listPresent(), new Map());
          }
          await marker.write({ status: "ready", progress: null, error: note });
          logger.info("Company restore resumed after its load committed", {
            companyId,
            restoreRunId
          });
          return { restoreRunId, resumed: true };
        }

        await requireBackupsEntitlement(companyId);
        await assertNoPendingChange(client, companyId, { restoreRunId });

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
        const scan = await scanBackup(catalog, backup, { allIds: foreign });
        const substrateIds = await loadSubstrateIds(
          db,
          catalog,
          scan,
          includeGroup
            ? {}
            : { liveGroup: { companyId, companyGroupId: targetGroupId } }
        );
        const closure = assertReferentiallyClosed(catalog, scan, substrateIds, {
          groupLoaded: includeGroup
        });
        if (!closure.ok) {
          throw new Error(`This backup can't be restored: ${closure.reason}`);
        }

        const snapshotPath = await takeSnapshot(client, db, marker, {
          run: "restore",
          runId: restoreRunId,
          companyId,
          userId,
          record: { foreign, includeGroup },
          onProgress: report
        });

        // Listed before the load, so a storage error here fails a run that
        // has changed nothing yet.
        const present = await listPresent();

        // Atomic: if this throws, the company's data is untouched. A retry
        // re-runs the wipe before the load, so it lands the same result. The
        // marker's `applied` commits with the data.
        const { rows, idRewrite } = await wipeAndLoad(db, catalog, backup, {
          companyId,
          remap: foreign ? { userId, substrateIds, scan } : null,
          includeGroup,
          targetGroupId,
          onProgress: report,
          markApplied: marker.markApplied
        });

        const note = await copyFiles(backup, present, idRewrite);

        await marker.write({
          status: "ready",
          progress: null,
          rows,
          error: note
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
        logger.error("Company restore failed", {
          companyId,
          restoreRunId,
          error: err instanceof Error ? err.message : String(err)
        });
        throw await failRun(marker, err);
      }
    });
  }
);

/**
 * Keep an in-place restore, or dismiss a failed one: delete the snapshot and the
 * marker. No entitlement gate: it only resolves an already-gated restore, and a
 * lapsed entitlement must not strand the snapshot.
 */
export const companyRestoreFinalizeFunction = inngest.createFunction(
  {
    id: "company-restore-finalize",
    retries: 1,
    concurrency: PER_COMPANY_CONCURRENCY
  },
  { event: "carbon/company-restore-finalize" },
  async ({ event, step, logger }) => {
    const { companyId, restoreRunId } = event.data;
    return await step.run("finalize-restore", async () => {
      const client = getCarbonServiceRole();
      const kept = await keepRun(
        client,
        restoreMarker(client, { companyId, restoreRunId }),
        companyId
      );
      logger.info("Company restore kept", { companyId, restoreRunId, kept });
      return { restoreRunId, kept };
    });
  }
);

/**
 * Undo an in-place restore: wipe again and reload the snapshot. No entitlement
 * gate (see finalize): a lapsed entitlement must not strand the company
 * mid-restore.
 */
export const companyRestoreRevertFunction = inngest.createFunction(
  {
    id: "company-restore-revert",
    retries: 1,
    concurrency: PER_COMPANY_CONCURRENCY,
    onFailure: ({ event, error }) => {
      const { companyId, restoreRunId } = event.data.event.data;
      return failStuckRun(
        restoreMarker(getCarbonServiceRole(), { companyId, restoreRunId }),
        error,
        "reverting"
      );
    }
  },
  { event: "carbon/company-restore-revert" },
  async ({ event, step, logger }) => {
    const { companyId, restoreRunId } = event.data;
    return await step.run("revert-restore", async () => {
      const client = getCarbonServiceRole();
      const result = await revertRun(
        client,
        getJobDatabaseClient(),
        restoreMarker(client, { companyId, restoreRunId }),
        companyId
      );
      logger.info("Company restore revert", {
        companyId,
        restoreRunId,
        ...result
      });
      return { restoreRunId, ...result };
    });
  }
);
