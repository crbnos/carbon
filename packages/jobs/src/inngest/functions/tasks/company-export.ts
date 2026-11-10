// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { requireBackupsEntitlement } from "@carbon/ee/backups.server";
import { NonRetriableError } from "inngest";
import { writeCompanyBackup } from "../../../backups/dump";
import {
  ExportScopeViolationError,
  type ScopeViolation
} from "../../../backups/scope";
import { getJobDatabaseClient } from "../../../db";
import { inngest } from "../../client";

type ServiceRole = ReturnType<typeof getCarbonServiceRole>;

// One company-scoped progress marker (exports run one-at-a-time, so no run id).
// The UI polls it for live phase/done/total; it's cleared when the run succeeds
// (the backup appearing in the list is what signals completion) and kept with
// status "failed" when it doesn't — a cleared marker on failure made a broken
// export indistinguishable from one that never ran.
const EXPORT_INTEGRATION = "company-export";
type ExportProgress = { phase: string; done: number; total: number };

async function upsertExportMarker(
  client: ServiceRole,
  companyId: string,
  userId: string,
  metadata: {
    status: "running" | "failed";
    startedAt: string;
    progress?: ExportProgress;
    error?: string;
    /** On failure: what was asked for, so a recovery retry can reuse it. */
    label?: string | null;
    includeStorage?: "none" | "all";
    /** Set only when the closure guard refused — the UI offers "skip" for exactly this. */
    reason?: "scope-violations";
    /** Per FK EDGE — the breakdown, never summable into a row count. */
    violations?: ScopeViolation[];
    /** DISTINCT rows involved, per table — what the user is told. */
    violationRowsByTable?: Array<{ table: string; rows: number }>;
  }
): Promise<void> {
  const existing = await client
    .from("externalIntegrationMapping")
    .select("id")
    .eq("integration", EXPORT_INTEGRATION)
    .eq("companyId", companyId)
    .maybeSingle();
  if (existing.data) {
    await client
      .from("externalIntegrationMapping")
      .update({ metadata })
      .eq("id", existing.data.id)
      .eq("companyId", companyId);
  } else {
    await client.from("externalIntegrationMapping").insert({
      entityType: "export",
      entityId: companyId,
      integration: EXPORT_INTEGRATION,
      externalId: "",
      metadata,
      companyId,
      createdBy: userId
    });
  }
}

async function clearExportMarker(
  client: ServiceRole,
  companyId: string
): Promise<void> {
  await client
    .from("externalIntegrationMapping")
    .delete()
    .eq("integration", EXPORT_INTEGRATION)
    .eq("companyId", companyId);
}

export const companyExportFunction = inngest.createFunction(
  {
    id: "company-export",
    retries: 1,
    concurrency: { key: "event.data.companyId", limit: 1 }
  },
  { event: "carbon/company-export" },
  async ({ event, step, logger }) => {
    const { companyId, userId, label, includeStorage, skipCorrupted } =
      event.data;

    await requireBackupsEntitlement(companyId);

    return await step.run("export-company", async () => {
      const client = getCarbonServiceRole();
      const db = getJobDatabaseClient();

      // Live-progress marker (cleared on success, flipped to "failed" on error).
      // Throttled so a fast parallel dump doesn't hammer the row.
      const startedAt = new Date().toISOString();
      await upsertExportMarker(client, companyId, userId, {
        status: "running",
        startedAt
      });
      let lastAt = 0;
      let lastPhase = "";
      const report = async (progress: ExportProgress) => {
        const now = Date.now();
        const terminal = progress.done >= progress.total;
        if (progress.phase === lastPhase && !terminal && now - lastAt < 250) {
          return;
        }
        lastPhase = progress.phase;
        lastAt = now;
        await upsertExportMarker(client, companyId, userId, {
          status: "running",
          startedAt,
          progress
        });
      };

      try {
        const { name, manifest, rows, assets } = await writeCompanyBackup(
          client,
          db,
          {
            companyId,
            userId,
            label,
            includeStorage,
            skipCorrupted: skipCorrupted === true,
            onProgress: report
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

        await clearExportMarker(client, companyId);
        return { name, tables: manifest.tables.length, rows };
      } catch (err) {
        // Keep the marker with the failure so the UI can tell the user the
        // backup is invalid instead of showing "preparing" forever. A retry
        // (retries: 1) overwrites it back to "running"; the user dismisses it
        // from the Backups page, and the next export reuses the row.
        const message = err instanceof Error ? err.message : String(err);
        await upsertExportMarker(client, companyId, userId, {
          status: "failed",
          startedAt,
          error: message.slice(0, 2000),
          label: label ?? null,
          includeStorage,
          ...(err instanceof ExportScopeViolationError
            ? {
                reason: "scope-violations",
                violations: err.violations,
                violationRowsByTable: err.rowsByTable
              }
            : {})
        });
        // The guard's verdict is deterministic — a retry would only flip the
        // marker back to "running" and fail again ~10s later, resurrecting the
        // failure banner after the user has already recovered (skipped).
        if (err instanceof ExportScopeViolationError) {
          throw new NonRetriableError(message, { cause: err });
        }
        throw err;
      }
    });
  }
);
