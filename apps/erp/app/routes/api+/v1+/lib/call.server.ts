// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The ONE server-side entry point for running a Carbon API operation outside HTTP:
// MCP call_tool and the workflow dispatcher call this. It validates the
// arguments with the function's own validator, runs the function (its gate
// included) inside the operation's span, and folds the outcome into a
// { success, … } envelope. No HTTP shaping happens here, so nothing has to
// be reversed.

import { getLogger } from "@carbon/logger";
import { ORPCError } from "@orpc/server";
import type { AuthedContext } from "./base.server";
import { operationsByName } from "./operations.server";
import { traceOperation } from "./router.server";
import { callServiceFn } from "./service-fn.server";
import {
  formatValidationIssues,
  type StandardIssue
} from "./validation-issues";

const logger = getLogger("erp", "api", "call");

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

  const op = operationsByName.get(name);
  if (!op) {
    return {
      success: false,
      error: `Operation not found: ${name}`,
      errorKind: "execution"
    };
  }

  // Validation runs before the permission check, so a malformed call gets a
  // 400 before a 403, as over HTTP.
  const parsed = op.fn.input.safeParse(args ?? {});
  if (!parsed.success) {
    return {
      success: false,
      category: "validation",
      error: formatValidationIssues(parsed.error.issues as StandardIssue[]),
      errorKind: "execution"
    };
  }

  try {
    const result = await traceOperation(op, () =>
      callServiceFn(op.fn, context, args ?? {})
    );
    return {
      success: true,
      data: result.data,
      ...(result.count !== undefined ? { count: result.count } : {})
    };
  } catch (err) {
    // Anything but an ORPCError is our own failure: its text (a stack frame,
    // a connection string) is for the log, never the caller.
    if (!(err instanceof ORPCError)) {
      logger.error("Operation {name} threw", {
        name,
        companyId: context.companyId,
        error: err
      });
      return {
        success: false,
        category: "internal",
        error: "Function execution failed",
        errorKind: "execution"
      };
    }
    // oRPC's input-validation failure says only "Input validation failed" —
    // useless to an agent that has to fix its own call. The issues ride along
    // in `err.data`, so name the fields and what's wrong with each.
    const data = err.data as
      | { issues?: StandardIssue[]; category?: string }
      | undefined;
    const issues = data?.issues;
    return {
      success: false,
      ...(data?.category ? { category: data.category } : {}),
      error:
        Array.isArray(issues) && issues.length > 0
          ? formatValidationIssues(issues)
          : err.message,
      errorKind: "execution"
    };
  }
}
