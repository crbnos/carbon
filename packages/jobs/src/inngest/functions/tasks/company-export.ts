// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { requireBackupsEntitlement } from "@carbon/ee/backups.server";
import { writeCompanyBackup } from "../../../backups/dump";
import {
  DUMP_CONCURRENCY,
  EXPORT_INTEGRATION,
  type ExportRunMeta,
  failRun,
  failStuckRun,
  PER_COMPANY_CONCURRENCY,
  progressWriter,
  runMarker,
  startRun
} from "../../../backups/runs";
import { getJobDatabaseClient } from "../../../db";
import { inngest } from "../../client";

const exportMarker = (
  client: ReturnType<typeof getCarbonServiceRole>,
  args: { companyId: string; userId: string; exportRunId: string }
) =>
  runMarker<ExportRunMeta>(client, {
    integration: EXPORT_INTEGRATION,
    entityType: "export",
    entityId: args.companyId,
    companyId: args.companyId,
    userId: args.userId,
    identity: { exportRunId: args.exportRunId }
  });

/**
 * Write a backup of the company. One marker per company: cleared when the run
 * succeeds (the backup appearing in the list is what signals completion) and
 * kept as failed when it doesn't, until the user dismisses it.
 */
export const companyExportFunction = inngest.createFunction(
  {
    id: "company-export",
    retries: 1,
    concurrency: [PER_COMPANY_CONCURRENCY, DUMP_CONCURRENCY],
    onFailure: ({ event, error }) => {
      const { companyId, userId } = event.data.event.data;
      const exportRunId = event.data.run_id;
      return failStuckRun(
        exportMarker(getCarbonServiceRole(), {
          companyId,
          userId,
          exportRunId
        }),
        error,
        "running",
        (meta) => meta.exportRunId === exportRunId
      );
    }
  },
  { event: "carbon/company-export" },
  async ({ event, step, logger, runId }) => {
    const { companyId, userId, label, includeStorage, skipCorrupted } =
      event.data;

    // Its own step, so the work step below can tell a marker the user removed
    // from one never written.
    await step.run("claim-export", async () => {
      const marker = exportMarker(getCarbonServiceRole(), {
        companyId,
        userId,
        exportRunId: runId
      });
      if ((await marker.read())?.exportRunId !== runId) {
        await startRun(marker, { label: label ?? null, includeStorage });
      }
    });

    return await step.run("export-company", async () => {
      const client = getCarbonServiceRole();
      const db = getJobDatabaseClient();
      const marker = exportMarker(client, {
        companyId,
        userId,
        exportRunId: runId
      });

      // A retry overwrites its own failed marker back to running. One whose
      // marker is gone, or now names a later export, was dismissed or
      // superseded during the retry backoff.
      const existing = await marker.read();
      if (existing?.exportRunId !== runId) {
        logger.info("Export dismissed or superseded, skipping", { companyId });
        return { skipped: true };
      }

      await startRun(marker, { label: label ?? null, includeStorage });

      try {
        await requireBackupsEntitlement(companyId);
        const { name, manifest, rows, assets } = await writeCompanyBackup(
          client,
          db,
          {
            companyId,
            userId,
            label,
            includeStorage,
            skipCorrupted: skipCorrupted === true,
            onProgress: progressWriter(marker)
          }
        );

        logger.info("Company export complete", {
          companyId,
          name,
          tables: manifest.tables.length,
          rows,
          assetsCopied: assets.copied,
          assetsFailed: assets.failed
        });

        await marker.clear();
        return { name, tables: manifest.tables.length, rows };
      } catch (err) {
        throw await failRun(marker, err);
      }
    });
  }
);
