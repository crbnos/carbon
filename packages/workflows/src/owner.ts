/**
 * Who a workflow runs as.
 *
 * A workflow acts with its owner's live permissions, minted per step
 * (`getUserScopedClient(ownerId, …)`). That makes ownership the difference
 * between an automation that survives its author and one that stops the day
 * they are deactivated: `deactivateEmployee` strips the company from the
 * owner's `userPermission` row, and every node then fails its permission check.
 *
 * - `user`    — the employee who created it. Their access is the workflow's access.
 * - `company` — the company's own service identity. Outlives every employee.
 *
 * `ownerId` points at a real `user` row in both cases, which is why the engine,
 * the matcher and the scheduler need no branch: they resolve an owner id and
 * mint a client for it exactly as before.
 */
export type WorkflowOwnerKind = "user" | "company";

export const WORKFLOW_OWNER_KINDS: WorkflowOwnerKind[] = ["user", "company"];

/**
 * Prefix for the per-company workflow service identity. Kept in step with
 * `provision_workflow_service_user` in
 * `20260828103412_workflow-company-ownership.sql`, which is the only writer.
 */
export const WORKFLOW_SERVICE_USER_PREFIX = "wfsvc_";

/**
 * The service identity's user id is derived from the company id rather than
 * generated, so provisioning is idempotent and a lookup is never needed to
 * resolve it.
 */
export function getWorkflowServiceUserId(companyId: string): string {
  return `${WORKFLOW_SERVICE_USER_PREFIX}${companyId}`;
}

export function isWorkflowServiceUserId(userId: string | null): boolean {
  return userId?.startsWith(WORKFLOW_SERVICE_USER_PREFIX) ?? false;
}
