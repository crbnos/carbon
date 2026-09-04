import type { Database } from "@carbon/database";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import type { CompanyLock, WorkflowIssue } from "@carbon/workflows";
import {
  createWorkflowCatalog,
  readWorkflowVersion,
  syncWorkflowTriggers,
  validateDefinition
} from "@carbon/workflows";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sql } from "kysely";
import { getDatabaseClient } from "~/services/database.server";
import {
  getWorkflowVersion,
  getWorkflowVersionOwnership
} from "./workflows.service";

const logger = getLogger("erp", "workflows");

export const LOCKED_VERSION_MESSAGE =
  "This version is published. Create a new version to make changes.";

/**
 * The published version is read-only; every mutating route calls this. An id that
 * resolves to nothing returns `{ ok: true }` — it cannot be the published version —
 * matching `checkRevisionLock`'s unresolvable-is-unlocked rule.
 */
export async function checkWorkflowVersionLock(
  client: SupabaseClient<Database>,
  { versionId, companyId }: { versionId: string; companyId: string }
): Promise<{ ok: boolean; message?: string }> {
  const state = await getWorkflowVersionOwnership(client, versionId, companyId);
  if (state.error || !state.data) return { ok: true };

  const workflow = state.data.workflow as {
    publishedVersionId: string | null;
  } | null;
  if (!workflow) return { ok: true };

  return versionId === workflow.publishedVersionId
    ? { ok: false, message: LOCKED_VERSION_MESSAGE }
    : { ok: true };
}

export type WorkflowSyncResult =
  | { ok: false; issues: WorkflowIssue[]; message?: string }
  | { ok: true; issues: never[]; scheduled: boolean };

/**
 * Held for the whole sync transaction, so two publishes in one company queue up
 * instead of each reconciling the company's subscriptions from stale state.
 * `hashtext` is stable across sessions, and the `_xact_` variant releases on
 * commit or rollback — there is no unlock path to forget.
 */
const lockCompany: CompanyLock = (trx, companyId) =>
  sql`SELECT pg_advisory_xact_lock(hashtext(${companyId}))`.execute(trx);

/**
 * Rewrites the workflow's trigger rows to match whatever is now published, and
 * wakes the scheduler chain so a scheduled workflow starts within minutes rather
 * than waiting for the hourly backstop.
 *
 * DANGER: `syncWorkflowTriggers` uses Kysely and bypasses RLS entirely, so the
 * calling route's `requirePermissions` is the only authorization gate on it.
 */
async function syncAndWake(companyId: string, workflowId: string) {
  const sync = await syncWorkflowTriggers(
    getDatabaseClient(),
    companyId,
    workflowId,
    lockCompany
  );

  if (sync.scheduled) {
    await trigger("workflow-scheduler-wake", { bookedFor: null });
  }

  return {
    ok: true as const,
    issues: [] as never[],
    scheduled: sync.scheduled
  };
}

export async function publishWorkflowVersion(
  client: SupabaseClient<Database>,
  {
    workflowId,
    versionId,
    companyId,
    userId
  }: {
    workflowId: string;
    versionId: string;
    companyId: string;
    userId: string;
  }
): Promise<WorkflowSyncResult> {
  const version = await getWorkflowVersion(client, versionId, companyId);
  if (
    version.error ||
    !version.data ||
    version.data.workflowId !== workflowId
  ) {
    return { ok: false, issues: [], message: "Version not found" };
  }

  const read = readWorkflowVersion(version.data);
  if (!read.ok) {
    return { ok: false, issues: [], message: read.message };
  }

  const issues = validateDefinition(read.definition, createWorkflowCatalog());
  if (issues.length) {
    return { ok: false, issues };
  }

  const promoted = await client
    .from("workflow")
    .update({
      publishedVersionId: versionId,
      updatedBy: userId,
      updatedAt: datetime.timestamp()
    })
    .eq("id", workflowId)
    .eq("companyId", companyId);

  if (promoted.error) {
    return { ok: false, issues: [], message: promoted.error.message };
  }

  return syncAndWake(companyId, workflowId);
}

/**
 * The inverse of {@link publishWorkflowVersion}, and the only way to switch a workflow off.
 *
 * Takes no boolean: publishing needs a version id and has to pass validation first, so the
 * two directions cannot share one entry point.
 */
export async function unpublishWorkflow(
  client: SupabaseClient<Database>,
  {
    workflowId,
    companyId,
    userId
  }: {
    workflowId: string;
    companyId: string;
    userId: string;
  }
): Promise<WorkflowSyncResult> {
  const updated = await client
    .from("workflow")
    .update({
      publishedVersionId: null,
      updatedBy: userId,
      updatedAt: datetime.timestamp()
    })
    .eq("id", workflowId)
    .eq("companyId", companyId);

  if (updated.error) {
    return { ok: false, issues: [], message: updated.error.message };
  }

  // Unpublishing must still sync — that is what deletes the trigger rows and clears
  // nextRunAt, which is what actually stops the workflow firing.
  return syncAndWake(companyId, workflowId);
}

/**
 * Reconciles the company's subscriptions after a workflow row is gone.
 *
 * The FK cascade takes `workflowTriggerEvent` with the workflow, but nothing
 * touches `eventSystemSubscription` — it is keyed per company per table, not per
 * workflow. Deleting the last workflow watching a table would otherwise leave
 * that subscription active, and `dispatch_event_batch()` would keep enqueuing
 * events no workflow can consume.
 *
 * Never throws: the row is already deleted, so failing here must not present the
 * delete as failed. The orphan is wasted work, not incorrect behaviour, and the
 * next publish or unpublish in the company reconciles it away.
 */
export async function syncAfterWorkflowDelete(
  companyId: string,
  workflowId: string
): Promise<void> {
  try {
    await syncWorkflowTriggers(
      getDatabaseClient(),
      companyId,
      workflowId,
      lockCompany
    );
  } catch (err) {
    logger.error("Failed to reconcile subscriptions after workflow delete", {
      companyId,
      workflowId,
      error: err
    });
  }
}
