// The ONE server-side entry point for running a Carbon API operation outside HTTP:
// MCP call_tool, the in-app agent, and the workflow dispatcher all call this. It
// runs the operation through the real oRPC procedure (gate middleware included) via
// server-side call(), and folds the outcome back into the { success, … } envelope
// the legacy executeFunction callers expect.

import { getLogger } from "@carbon/logger";
import { call, ORPCError } from "@orpc/server";
import { getEdgeFunctionErrorMessage } from "~/utils/error";
import { isMcpBlockedTool } from "../../mcp+/lib/mcp-blocked-tools";
import { unwrapArgsEnvelope } from "./args-envelope";
import type { AuthedContext } from "./base.server";
import {
  classifyDatabaseFailure,
  publicDatabaseError,
  type SupabaseFailure
} from "./database-errors";
import {
  operationId,
  operationsByName,
  unshapeHttpBody
} from "./operations.server";
import { router } from "./router.server";

import {
  formatValidationIssues,
  type StandardIssue
} from "./validation-issues";

const logger = getLogger("erp", "api", "call-operation");

export type CallResult =
  | { success: true; data: unknown; count?: number }
  | { success: false; error: string; errorKind: "database" | "execution" };

async function edgeFunctionMessage(
  error: SupabaseFailure
): Promise<string | null> {
  if (
    error.name !== "FunctionsHttpError" ||
    !("context" in error) ||
    !error.context
  )
    return null;
  const message = await getEdgeFunctionErrorMessage(error, "");
  return message === "" ? null : message;
}

export async function callOperation(
  name: string,
  context: AuthedContext,
  args?: Record<string, unknown> | string
): Promise<CallResult> {
  // The step order is the contract — it reproduces executeFunction's exactly.
  if (typeof args === "string") {
    try {
      args = args.trim().length > 0 ? JSON.parse(args) : {};
    } catch {
      return {
        success: false,
        error: "Invalid JSON arguments",
        errorKind: "execution"
      };
    }
  }

  if (isMcpBlockedTool(name)) {
    return {
      success: false,
      error: `Tool disabled: ${name} is not available via MCP.`,
      errorKind: "execution"
    };
  }

  const meta = operationsByName.get(name);
  const procedure = meta ? router[meta.module]?.[operationId(meta)] : undefined;
  if (!meta || !procedure) {
    return {
      success: false,
      error: `Operation not found: ${name}`,
      errorKind: "execution"
    };
  }

  const callArgs = unwrapArgsEnvelope(
    meta,
    args as Record<string, unknown> | undefined
  );

  try {
    // The handler shapes the HTTP body (bare single results, `{ results, count }`
    // lists); unshapeHttpBody reverses it so MCP/agent/workflow callers keep
    // DispatchResult semantics.
    const body = await call(procedure, callArgs ?? {}, { context });
    const result = unshapeHttpBody(meta, body);
    return {
      success: true,
      data: result.data,
      ...(result.count !== undefined ? { count: result.count } : {})
    };
  } catch (err) {
    const supabase =
      err instanceof ORPCError
        ? (err.data as { supabase?: SupabaseFailure } | undefined)?.supabase
        : undefined;
    if (supabase) {
      const edgeMessage = await edgeFunctionMessage(supabase);
      logger.error("Operation failed", {
        name,
        kind: classifyDatabaseFailure(supabase),
        supabase,
        ...(edgeMessage ? { edgeMessage } : {})
      });
      return {
        success: false,
        error: publicDatabaseError(supabase),
        errorKind: "database"
      };
    }
    // oRPC's input-validation failure says only "Input validation failed" —
    // useless to an agent that has to fix its own call. The issues ride along
    // in `err.data`, so name the fields and what's wrong with each.
    const issues =
      err instanceof ORPCError
        ? (err.data as { issues?: StandardIssue[] } | undefined)?.issues
        : undefined;
    if (Array.isArray(issues) && issues.length > 0) {
      return {
        success: false,
        error: formatValidationIssues(issues),
        errorKind: "execution"
      };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : "Function execution failed",
      errorKind: "execution"
    };
  }
}
