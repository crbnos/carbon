// The bridge from an oRPC procedure to a Carbon service function.
//
// Owns the executeFunction lineage in full: positional-arg assembly from
// serviceParams, payload stamping via enrichWithAuthContext, `_operation` handling,
// and the Supabase unwrap. HTTP, MCP, the agent and the workflow dispatcher all pass
// through here. Unlike the legacy executor (which returned { success, … }), this
// THROWS an ORPCError on failure: the HTTP handler maps that to a status code and
// callOperation reconstructs the { success:false, error } envelope.

import type { AuthField, ManifestEntry } from "@carbon/api";
import { ORPCError } from "@orpc/server";
import { getDatabaseClient } from "~/services/database.server";
import type { AuthedContext } from "./base.server";
import { functionRegistry } from "./registry.server";

export interface DispatchResult {
  data: unknown;
  count?: number;
}

export type McpOperation = "create" | "update";

/** The identity fields the payload stamp reads — satisfied by both AuthedContext
 *  and the legacy ExecutorContext. */
type AuthStampContext = Pick<
  AuthedContext,
  "userId" | "companyId" | "companyGroupId"
>;

// Stamps auth identity onto typed payloads. Carbon's services expect auth
// fields inside the payload (predates MCP). `fields` is per-tool from
// tool-metadata.json so reads stay clean and updates don't overwrite createdBy.
export function enrichWithAuthContext(
  value: unknown,
  context: AuthStampContext,
  fields: AuthField[],
  operation?: McpOperation
): unknown {
  if (!value || typeof value !== "object") return value;
  if (fields.length === 0) return value;

  // Array payloads (e.g. the row list for upsertQuoteLinePrices) need per-element
  // stamping — enrichment never reached inside them, so a NOT NULL createdBy on
  // the row table failed. Only createdBy is injected into elements (and only for
  // an insert): element keys are spread straight into an INSERT, so injecting
  // companyId/updatedBy could add a column the row table doesn't have. The
  // service owns companyId for these rows. createdBy is stamped AFTER the spread
  // so a caller can't forge audit attribution by supplying it in a row.
  if (Array.isArray(value)) {
    if (operation === "update" || !fields.includes("createdBy")) return value;
    return value.map((element) =>
      element && typeof element === "object" && !Array.isArray(element)
        ? { ...(element as Record<string, unknown>), createdBy: context.userId }
        : element
    );
  }

  const enriched: Record<string, unknown> = {
    ...(value as Record<string, unknown>)
  };

  // A caller-supplied createdBy would send the service down its insert branch.
  if (operation === "update") {
    delete enriched.createdBy;
  } else if (fields.includes("createdBy") && !("createdBy" in enriched)) {
    enriched.createdBy = context.userId;
  }
  if (fields.includes("updatedBy")) {
    enriched.updatedBy = context.userId;
  }
  if (fields.includes("companyId")) {
    enriched.companyId = context.companyId;
  }
  if (fields.includes("companyGroupId")) {
    enriched.companyGroupId = context.companyGroupId;
  }

  return enriched;
}

// Pulls the MCP-only `_operation` flag out of the args, top level or nested.
// Returns every value it found so the caller can reject contradictory ones.
export function extractOperation(args: Record<string, any> | undefined): {
  operations: string[];
  args: Record<string, any> | undefined;
} {
  if (!args) return { operations: [], args };

  const operations: string[] = [];
  const cleaned: Record<string, any> = {};

  if (args._operation !== undefined) operations.push(String(args._operation));

  for (const [key, value] of Object.entries(args)) {
    if (key === "_operation") continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const { _operation, ...rest } = value as Record<string, any>;
      if (_operation !== undefined) {
        operations.push(String(_operation));
        cleaned[key] = rest;
        continue;
      }
    }
    cleaned[key] = value;
  }

  return { operations, args: cleaned };
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
  context: AuthedContext,
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
      // The raw error rides along so callOperation can reconstruct MCP's
      // byte-identical `Database error: ${JSON.stringify(error)}` text, and HTTP
      // callers get the Postgres code/details/hint the way Supabase REST does.
      throw new ORPCError("BAD_REQUEST", {
        message: supabaseErrorMessage(r.error),
        data: { supabase: r.error }
      });
    }
    return { data: r.data, count: r.count ?? undefined };
  }
  return { data: result };
}
