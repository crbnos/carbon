import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface DispatchContext {
  client: SupabaseClient<Database>;
  companyId: string;
  companyGroupId: string;
  userId: string;
}

// Deliberately loose: the dispatcher widens `success` to boolean, so a narrower
// union here would force a cast at the one registration site.
export interface DispatchResult {
  success: boolean;
  data?: unknown;
  error?: unknown;
}

// Structurally satisfied by the ERP app's `executeFunction`, so the dependency
// points from the app into this package and never the other way.
export type WorkflowDispatch = (
  functionName: string,
  context: DispatchContext,
  args?: Record<string, unknown> | string
) => Promise<DispatchResult>;

let dispatch: WorkflowDispatch | undefined;

/** The ERP app supplies this at boot; packages/jobs cannot import ~/modules itself. */
export function setWorkflowDispatch(fn: WorkflowDispatch): void {
  dispatch = fn;
}

export function getWorkflowDispatch(): WorkflowDispatch | undefined {
  return dispatch;
}
