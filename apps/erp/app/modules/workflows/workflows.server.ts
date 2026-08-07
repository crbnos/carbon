import type { Database } from "@carbon/database";
import { trigger } from "@carbon/jobs";
import { datetime } from "@carbon/utils";
import type { WorkflowIssue } from "@carbon/workflows";
import {
  createWorkflowCatalog,
  readWorkflowVersion,
  syncWorkflowTriggers,
  validateDefinition
} from "@carbon/workflows";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDatabaseClient } from "~/services/database.server";
import { getWorkflow, getWorkflowVersion } from "./workflows.service";

export const LOCKED_VERSION_MESSAGE =
  "This version is live. Create a new version to make changes.";

export function getWorkflowLockFlags({
  versionId,
  activeVersionId
}: {
  versionId: string;
  activeVersionId: string | null;
}) {
  const isLive = activeVersionId !== null && versionId === activeVersionId;
  return { isLive, isVersionLocked: isLive };
}

/**
 * The promoted version is read-only; every mutating route calls this. An id that
 * resolves to nothing returns `{ ok: true }` — it cannot be the active version —
 * matching `checkRevisionLock`'s unresolvable-is-unlocked rule.
 */
export async function checkWorkflowVersionLock(
  client: SupabaseClient<Database>,
  { versionId, companyId }: { versionId: string; companyId: string }
): Promise<{ ok: boolean; message?: string }> {
  const version = await getWorkflowVersion(client, versionId, companyId);
  if (version.error || !version.data) return { ok: true };

  const workflow = await getWorkflow(
    client,
    version.data.workflowId,
    companyId
  );
  if (workflow.error || !workflow.data) return { ok: true };

  const { isVersionLocked } = getWorkflowLockFlags({
    versionId,
    activeVersionId: workflow.data.activeVersionId
  });

  return isVersionLocked
    ? { ok: false, message: LOCKED_VERSION_MESSAGE }
    : { ok: true };
}

export type WorkflowSyncResult =
  | { ok: false; issues: WorkflowIssue[]; message?: string }
  | { ok: true; issues: never[]; scheduled: boolean };

/**
 * Rewrites the workflow's trigger rows to match whatever is now promoted, and
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
    workflowId
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
      activeVersionId: versionId,
      active: true,
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

export async function setWorkflowActive(
  client: SupabaseClient<Database>,
  {
    workflowId,
    companyId,
    userId,
    active
  }: {
    workflowId: string;
    companyId: string;
    userId: string;
    active: boolean;
  }
): Promise<WorkflowSyncResult> {
  const updated = await client
    .from("workflow")
    .update({
      active,
      updatedBy: userId,
      updatedAt: datetime.timestamp()
    })
    .eq("id", workflowId)
    .eq("companyId", companyId);

  if (updated.error) {
    return { ok: false, issues: [], message: updated.error.message };
  }

  // Turning a workflow off must still sync — that is what deletes its trigger rows.
  return syncAndWake(companyId, workflowId);
}
