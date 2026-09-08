// The ONE server-side entry point for running a Carbon API operation outside HTTP:
// MCP call_tool, the in-app agent, and the workflow dispatcher all call this. It
// runs the operation through the real oRPC procedure (gate middleware included) via
// server-side call(), and folds the outcome back into the { success, … } envelope
// the legacy executeFunction callers expect.

import { call, ORPCError } from "@orpc/server";
import { isMcpBlockedTool } from "../../mcp+/lib/mcp-blocked-tools";
import type { AuthedContext } from "./base.server";
import {
  operationId,
  operationsByName,
  unshapeHttpBody
} from "./operations.server";
import { router } from "./router.server";

export type CallResult =
  | { success: true; data: unknown; count?: number }
  | { success: false; error: string; errorKind: "database" | "execution" };

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

  try {
    // The handler shapes the HTTP body (bare single results, `{ results, count }`
    // lists); unshapeHttpBody reverses it so MCP/agent/workflow callers keep
    // DispatchResult semantics.
    const body = await call(
      procedure,
      (args as Record<string, unknown> | undefined) ?? {},
      { context }
    );
    const result = unshapeHttpBody(meta, body);
    return {
      success: true,
      data: result.data,
      ...(result.count !== undefined ? { count: result.count } : {})
    };
  } catch (err) {
    const supabase =
      err instanceof ORPCError
        ? (err.data as { supabase?: unknown } | undefined)?.supabase
        : undefined;
    if (supabase) {
      // A Supabase failure keeps MCP's exact `Database error:` text, raw error
      // JSON included — the errorKind lets the formatter skip its `Error: ` prefix.
      return {
        success: false,
        error: `Database error: ${JSON.stringify(supabase)}`,
        errorKind: "database"
      };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : "Function execution failed",
      errorKind: "execution"
    };
  }
}
