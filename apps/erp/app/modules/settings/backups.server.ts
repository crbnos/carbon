import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import { trigger } from "@carbon/jobs";
import {
  compatibilityStatus,
  getCompanyTableCatalog,
  reportBackupCompatibility
} from "@carbon/jobs/backups";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import { getDatabaseClient } from "~/services/database.server";

const log = getLogger("erp", "backups");

import {
  type CompanyBackupSummary,
  listCompanyBackupFolders
} from "./backups.service";

// Server-only: enqueues the in-place restore inngest jobs and computes the
// live compatibility verdict. Kept out of the route module so `@carbon/jobs`
// (which pulls Node `Buffer` via the Inngest client) never lands in the
// browser bundle.

/**
 * The Backups loader's list: each ready backup's manifest diffed against
 * TODAY's schema, so the badge and the restore disclosure describe what a
 * restore would actually do right now. Computed on every load rather than
 * stored — a verdict written at export time compares the manifest against the
 * very schema it was projected from and can only ever say "ready".
 */
export async function getCompanyBackups(
  client: SupabaseClient<Database>,
  companyId: string
): Promise<{ data: CompanyBackupSummary[] | null; error: Error | null }> {
  const { data, error } = await listCompanyBackupFolders(client, companyId);
  if (error || !data) return { data: null, error };

  // One schema read per page load, shared by every row. A failure here must
  // NOT take the page down: listing, downloading and deleting backups all work
  // without a verdict, and the restore has its own gate. So a database that is
  // unreachable or out of connections costs the badges, not the screen.
  let catalog: Awaited<ReturnType<typeof getCompanyTableCatalog>> | null = null;
  if (data.some((b) => b.manifest)) {
    try {
      catalog = await getCompanyTableCatalog(getDatabaseClient());
    } catch (err) {
      log.warn("Backups: live compatibility unavailable — listing without it", {
        companyId,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  return {
    data: data.map(({ manifest, ...summary }) => {
      // No catalog (schema unreadable) or no manifest (incomplete export) →
      // `compatibility` stays null: "not checked", never a green "ready".
      if (!catalog || !manifest) return summary;
      const report = reportBackupCompatibility(catalog, manifest);
      return {
        ...summary,
        compatibility: {
          status: compatibilityStatus(report),
          findings: report.findings
        }
      };
    }),
    error: null
  };
}

/**
 * Kick off an in-place restore of `filePath` (one of this company's own
 * backups). The job snapshots the current state, wipes the company's data and
 * loads the backup. Returns the restore run id used to poll status and to
 * keep/revert the result.
 */
export async function startCompanyRestore(args: {
  companyId: string;
  userId: string;
  filePath: string;
  includeStorage: "none" | "all";
  label?: string;
}): Promise<string> {
  const restoreRunId = nanoid();
  await trigger("company-restore", { ...args, restoreRunId });
  return restoreRunId;
}

/** Keep a restore — drop the pre-restore snapshot + marker. */
export async function finalizeCompanyRestore(args: {
  companyId: string;
  restoreRunId: string;
}): Promise<void> {
  await trigger("company-restore-finalize", args);
}

/** Undo a restore — wipe again and reload the pre-restore snapshot. */
export async function revertCompanyRestore(args: {
  companyId: string;
  restoreRunId: string;
}): Promise<void> {
  await trigger("company-restore-revert", args);
}

/**
 * Clear the failed-export marker once the user has acknowledged it. Service
 * role: `externalIntegrationMapping` has no DELETE policy, and the marker is
 * written by the export job (see EXPORT_INTEGRATION in
 * packages/jobs/src/inngest/functions/tasks/company-export.ts).
 */
export async function dismissCompanyExportFailure(
  companyId: string
): Promise<void> {
  const serviceRole = getCarbonServiceRole();
  await serviceRole
    .from("externalIntegrationMapping")
    .delete()
    .eq("integration", "company-export")
    .eq("companyId", companyId);
}
