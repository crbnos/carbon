// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { requireBackupsEntitlement } from "@carbon/ee/backups.server";
import { getCompanyTableCatalog } from "../../../backups/catalog";
import { assertBackupImportable } from "../../../backups/compatibility";
import {
  readBackupForLoad,
  resolveRestoreScope,
  wipeAndLoad
} from "../../../backups/load";
import {
  assertReferentiallyClosed,
  loadSubstrateIds
} from "../../../backups/remap";
import {
  failRun,
  keepRun,
  PER_COMPANY_CONCURRENCY,
  progressWriter,
  RESTORE_INTEGRATION,
  type RestoreRunMeta,
  revertRun,
  runMarker,
  startRun,
  takeSnapshot
} from "../../../backups/runs";
import { restoreAssetsFromBackup } from "../../../backups/storage";
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
    concurrency: PER_COMPANY_CONCURRENCY
  },
  { event: "carbon/company-restore" },
  async ({ event, step, logger }) => {
    const {
      companyId,
      userId,
      filePath: name,
      restoreRunId,
      label,
      includeStorage
    } = event.data;

    return await step.run("restore-company", async () => {
      const client = getCarbonServiceRole();
      const db = getJobDatabaseClient();
      const marker = restoreMarker(client, { companyId, restoreRunId, userId });

      // A retry after the run already finished must not wipe again.
      const existing = await marker.read();
      if (existing?.status === "ready") {
        logger.info("Restore already applied, skipping", { restoreRunId });
        return { restoreRunId, skipped: true };
      }

      await startRun(marker, {
        label: label ?? null,
        filePath: name,
        includeStorage,
        ...(existing?.startedAt ? { startedAt: existing.startedAt } : {})
      });
      const report = progressWriter(marker);

      try {
        await requireBackupsEntitlement(companyId);

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

        const snapshotPath = await takeSnapshot(client, db, marker, {
          run: "restore",
          runId: restoreRunId,
          companyId,
          userId,
          record: { foreign, includeGroup },
          onProgress: report
        });

        // Atomic: if this throws, the company's data is untouched. A retry
        // re-runs the wipe before the load, so it lands the same result.
        const { rows, idRewrite } = await wipeAndLoad(db, catalog, backup, {
          companyId,
          remap: foreign ? { userId, substrateIds } : null,
          includeGroup,
          targetGroupId,
          onProgress: report
        });

        // Files before `ready`, so the page reports complete only once the data
        // and the files are in place. The copy never throws (per-file warnings),
        // so a storage hiccup can't flip a committed restore to failed.
        if (includeStorage === "all") {
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
        }

        await marker.write({ status: "ready", progress: null, rows });
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
    concurrency: PER_COMPANY_CONCURRENCY
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
