// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { requireBackupsEntitlement } from "@carbon/ee/backups.server";
import { writeCompanyBackup } from "../../../backups/dump";
import {
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
  companyId: string,
  userId: string
) =>
  runMarker<ExportRunMeta>(client, {
    integration: EXPORT_INTEGRATION,
    entityType: "export",
    entityId: companyId,
    companyId,
    userId,
    identity: {}
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
    concurrency: PER_COMPANY_CONCURRENCY,
    onFailure: ({ event, error }) => {
      const { companyId, userId } = event.data.event.data;
      return failStuckRun(
        exportMarker(getCarbonServiceRole(), companyId, userId),
        error
      );
    }
  },
  { event: "carbon/company-export" },
  async ({ event, step, logger }) => {
    const { companyId, userId, label, includeStorage, skipCorrupted } =
      event.data;

    return await step.run("export-company", async () => {
      const client = getCarbonServiceRole();
      const db = getJobDatabaseClient();
      const marker = exportMarker(client, companyId, userId);

      // A retry overwrites a failed marker back to running.
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
