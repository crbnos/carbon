import type { Database } from "@carbon/database";
import {
  type ActionOutcome,
  getActionRoute,
  type OperationOutcome,
  type RuntimeValue,
  type SearchCriterion,
  type SearchOutcome,
  type WorkflowCatalog,
  type WorkflowServices
} from "@carbon/workflows";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runCreateAction } from "./create";
import { getWorkflowDispatch } from "./dispatcher";
import { runNotifyAction } from "./notify";
import { runOperation } from "./operations";
import { runSearch } from "./search";
import { runUpdateAction } from "./update";
import { runWebhookAction } from "./webhook";

const GONE = "This step is no longer available.";
const NO_DISPATCH = "This step is not available in this environment.";
const UNKNOWN_RESULT = "This step does not say what it creates.";

/** Everything the runtime cannot do for itself, behind one owner-scoped client. */
export function createWorkflowServices(params: {
  client: SupabaseClient<Database>;
  catalog: WorkflowCatalog;
  companyId: string;
  companyGroupId: string;
  ownerId: string;
  runId: string;
  workflowId: string;
}): WorkflowServices {
  const {
    client,
    catalog,
    companyId,
    companyGroupId,
    ownerId,
    runId,
    workflowId
  } = params;

  async function runAction(
    actionId: string,
    inputs: Record<string, RuntimeValue>
  ): Promise<ActionOutcome> {
    if (actionId === "notify") {
      return runNotifyAction({ companyId, runId, inputs });
    }
    if (actionId === "webhook") {
      return runWebhookAction({ client, companyId, workflowId, inputs });
    }

    // Routed off the catalog, never off the id's shape: an id that reads like
    // `x.update` but carries no update block must not reach the update executor.
    const action = catalog.getAction(actionId);
    const route = getActionRoute(actionId);
    if (action === undefined || route === undefined) {
      return { ok: false, error: GONE };
    }

    if (route.update !== undefined) {
      return runUpdateAction({
        client,
        companyId,
        ownerId,
        entity: route.update.entity,
        inputs,
        action
      });
    }

    if (route.call !== undefined) {
      const dispatch = getWorkflowDispatch();
      if (dispatch === undefined) return { ok: false, error: NO_DISPATCH };

      const record = action.outputs.record;
      if (record === undefined || record.kind !== "entity") {
        return { ok: false, error: UNKNOWN_RESULT };
      }

      return runCreateAction({
        dispatch,
        context: { client, companyId, companyGroupId, userId: ownerId },
        call: route.call,
        entity: record.of,
        inputs
      });
    }

    return { ok: false, error: GONE };
  }

  return {
    runAction,
    runOperation: (
      operationId: string,
      inputs: Record<string, RuntimeValue>
    ): Promise<OperationOutcome> =>
      runOperation({ client, companyId, operationId, inputs }),
    search: (search: {
      entity: string;
      returns: "one" | "list";
      criteria: SearchCriterion[];
    }): Promise<SearchOutcome> => runSearch({ client, companyId, ...search })
  };
}
