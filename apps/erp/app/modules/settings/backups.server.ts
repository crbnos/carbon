import { trigger } from "@carbon/jobs";
import { nanoid } from "nanoid";

// Server-only: enqueues the in-place restore inngest jobs. Kept out of the
// route module so `@carbon/jobs` (which pulls Node `Buffer` via the Inngest
// client) never lands in the browser bundle.

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
