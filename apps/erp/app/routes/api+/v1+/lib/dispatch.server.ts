// The bridge from an oRPC procedure to a Carbon service function.
//
// Ports the executeFunction body (positional-arg assembly from serviceParams, payload
// stamping via enrichWithAuthContext, `_operation` handling, Supabase unwrap) so HTTP
// and MCP share ONE dispatch. Unlike executeFunction (which returns { success, … }),
// this THROWS an ORPCError on failure: the HTTP handler maps that to a status code and
// MCP's call() wrapper reconstructs its own { success:false, error } envelope.

import type { ManifestEntry } from "@carbon/api";
import { ORPCError } from "@orpc/server";
import { getDatabaseClient } from "~/services/database.server";
import {
  type ExecutorContext,
  enrichWithAuthContext,
  extractOperation,
  functionRegistry,
  type McpOperation
} from "../../mcp+/lib/direct-executor";

export interface DispatchResult {
  data: unknown;
  count?: number;
}

function supabaseErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return JSON.stringify(error);
}

export async function dispatchOperation(
  meta: ManifestEntry,
  context: ExecutorContext,
  input: unknown
): Promise<DispatchResult> {
  const rawArgs =
    input && typeof input === "object"
      ? (input as Record<string, any>)
      : undefined;

  // Strip the MCP `_operation` discriminator before the args reach the service.
  const { operations: requestedOperations, args: normalizedArgs } =
    extractOperation(rawArgs);

  const funcName = meta.name.slice(meta.module.length + 1);
  const moduleFns =
    functionRegistry[meta.module as keyof typeof functionRegistry];
  const func = (moduleFns as Record<string, unknown> | undefined)?.[funcName];
  if (typeof func !== "function") {
    throw new ORPCError("NOT_FOUND", {
      message: `Operation not found: ${meta.name}`
    });
  }

  const needsOperation = Boolean(
    (meta.schema as { properties?: Record<string, unknown> })?.properties
      ?._operation
  );
  const distinctOperations = [...new Set(requestedOperations)];
  if (needsOperation && distinctOperations.length > 1) {
    throw new ORPCError("BAD_REQUEST", {
      message: `${meta.name} received conflicting _operation values (${distinctOperations.join(", ")}).`
    });
  }
  const requestedOperation = distinctOperations[0];
  if (
    needsOperation &&
    requestedOperation !== "create" &&
    requestedOperation !== "update"
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message: `${meta.name} requires _operation to be "create" (insert a new record) or "update" (modify an existing one).`
    });
  }
  const operation = needsOperation
    ? (requestedOperation as McpOperation)
    : undefined;

  const functionArgs: any[] = [];
  for (const paramName of meta.serviceParams) {
    if (paramName === "client") {
      functionArgs.push(context.client);
    } else if (paramName === "db") {
      functionArgs.push(getDatabaseClient());
    } else if (paramName === "userId") {
      functionArgs.push(context.userId);
    } else if (paramName === "companyId") {
      functionArgs.push(context.companyId);
    } else if (paramName === "companyGroupId") {
      functionArgs.push(context.companyGroupId);
    } else if (paramName === "args") {
      functionArgs.push(normalizedArgs || {});
    } else if (normalizedArgs && paramName in normalizedArgs) {
      functionArgs.push(
        enrichWithAuthContext(
          normalizedArgs[paramName],
          context,
          meta.injectAuth,
          operation
        )
      );
    } else if (
      normalizedArgs &&
      Object.keys(normalizedArgs).length === 1 &&
      !meta.serviceParams.some((p) => p in normalizedArgs) &&
      typeof Object.values(normalizedArgs)[0] === "object" &&
      Object.values(normalizedArgs)[0] !== null
    ) {
      // Single-key payload whose name doesn't match a param — unwrap and use it
      // positionally (the documented `{ args: {...} }` wrapper, or a guessed key).
      functionArgs.push(
        enrichWithAuthContext(
          Object.values(normalizedArgs)[0],
          context,
          meta.injectAuth,
          operation
        )
      );
    } else if (normalizedArgs && Object.keys(normalizedArgs).length > 0) {
      // No key matched — pass the whole args object positionally (flat-field calls
      // like upsertPart(client, part)).
      functionArgs.push(
        enrichWithAuthContext(
          { ...normalizedArgs },
          context,
          meta.injectAuth,
          operation
        )
      );
    }
    // else: optional param with nothing to fill — skip.
  }

  let result = await (func as (...args: any[]) => any)(...functionArgs);
  // Supabase query builders are thenable but not yet executed.
  if (
    result &&
    typeof result === "object" &&
    typeof result.then === "function"
  ) {
    result = await result;
  }

  // Supabase response shape { data, error, count } — unwrap, or throw on error.
  if (result && typeof result === "object" && "data" in result) {
    const r = result as { data: unknown; error?: unknown; count?: number };
    if (r.error) {
      throw new ORPCError("BAD_REQUEST", {
        message: supabaseErrorMessage(r.error)
      });
    }
    return { data: r.data, count: r.count ?? undefined };
  }
  return { data: result };
}
