// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The ONE server-side entry point for running a Carbon API operation outside HTTP:
// MCP call_tool, the in-app agent, and the workflow dispatcher all call this. It
// runs the operation through the real oRPC procedure (gate middleware included) via
// server-side call(), and folds the outcome into a { success, … } envelope.

import { call, ORPCError } from "@orpc/server";
import type { AuthedContext } from "./base.server";
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

export type CallResult =
  | { success: true; data: unknown; count?: number }
  | {
      success: false;
      error: string;
      errorKind: "execution";
      /** The service function's refusal (`notFound`, `rule`, …), when it refused. */
      category?: string;
    };

export async function callOperation(
  name: string,
  context: AuthedContext,
  args?: Record<string, unknown> | string
): Promise<CallResult> {
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
    // lists); unshapeHttpBody reverses it for MCP, agent and workflow callers.
    const body = await call(procedure, args ?? {}, { context });
    const result = unshapeHttpBody(meta, body);
    return {
      success: true,
      data: result.data,
      ...(result.count !== undefined ? { count: result.count } : {})
    };
  } catch (err) {
    // oRPC's input-validation failure says only "Input validation failed" —
    // useless to an agent that has to fix its own call. The issues ride along
    // in `err.data`, so name the fields and what's wrong with each.
    const data =
      err instanceof ORPCError
        ? (err.data as
            | { issues?: StandardIssue[]; category?: string }
            | undefined)
        : undefined;
    const issues = data?.issues;
    return {
      success: false,
      ...(data?.category ? { category: data.category } : {}),
      error:
        Array.isArray(issues) && issues.length > 0
          ? formatValidationIssues(issues)
          : err instanceof Error
            ? err.message
            : "Function execution failed",
      errorKind: "execution"
    };
  }
}
