import { trigger } from "@carbon/jobs";
import { nanoid } from "nanoid";

// Server-only: enqueues the demo-template inngest jobs. Kept out of the route
// module so `@carbon/jobs` (which pulls Node `Buffer` via the Inngest client)
// never lands in the browser bundle.

/**
 * Apply a demo dataset to this company. Always snapshots first, so the result is
 * revertible — `snapshot: true` also drives the wipe, since wiping without a
 * snapshot would be unrecoverable. Returns the run id used to poll status and to
 * keep/revert the result.
 */
export async function startCompanyTemplate(args: {
  companyId: string;
  userId: string;
  datasetKey: string;
}): Promise<string> {
  const templateRunId = nanoid();
  await trigger("company-template", {
    ...args,
    templateRunId,
    snapshot: true
  });
  return templateRunId;
}

/**
 * Resolve a settled template run — drop the pre-apply snapshot, then the marker.
 * Backs both "Keep" (on a ready run) and "Dismiss" (on a failed one): they are
 * the same operation. Deleting the marker row from here instead would strand the
 * snapshot folder in storage, since a failed revert keeps its `snapshotPath` so
 * the user can retry.
 */
export async function finalizeCompanyTemplate(args: {
  companyId: string;
  templateRunId: string;
}): Promise<void> {
  await trigger("company-template-finalize", args);
}

/** Undo an applied template — wipe again and reload the pre-apply snapshot. */
export async function revertCompanyTemplate(args: {
  companyId: string;
  userId: string;
  templateRunId: string;
}): Promise<void> {
  await trigger("company-template-revert", args);
}
