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

  // A caller-supplied createdBy would send a `"createdBy" in` service down its
  // insert branch.
  if (operation === "update") {
    delete enriched.createdBy;
  } else if (fields.includes("createdBy")) {
    // Overwrite, never fill a gap — a caller-supplied createdBy would attribute
    // the record to someone else. The array branch stamps after its spread for
    // the same reason, and the two shapes must not disagree.
    enriched.createdBy = context.userId;
  }
  // Symmetric to createdBy: a stamped updatedBy sends a service that
  // discriminates on `"updatedBy" in` (update-branch first — upsertJobMaterial,
  // upsertQuoteMaterial, …) down its UPDATE branch, which matches zero rows for a
  // new id and returns PGRST116, so the record never inserts. Suppress it on an
  // explicit create so the row inserts. With no _operation (operation undefined)
  // both audit fields are stamped, exactly as before.
  if (operation === "create") {
    delete enriched.updatedBy;
  } else if (fields.includes("updatedBy")) {
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

const SCALAR_PARAM_TYPES = new Set(["string", "number", "integer", "boolean"]);

// The declared JSON-Schema type of a top-level parameter, when that type is a
// scalar. `["string","null"]` unions are common in the manifest, so the null
// member is ignored rather than treated as a non-scalar.
function declaredScalarParam(
  meta: ManifestEntry,
  name: string
): string | undefined {
  const prop = (
    meta.schema as { properties?: Record<string, { type?: unknown }> }
  )?.properties?.[name];
  const raw = Array.isArray(prop?.type)
    ? (prop.type as unknown[]).find((t) => t !== "null")
    : prop?.type;
  return typeof raw === "string" && SCALAR_PARAM_TYPES.has(raw)
    ? raw
    : undefined;
}

/** Params the loop fills from context rather than from the request body. */
const CONTEXT_PARAM_NAMES = new Set([
  "client",
  "db",
  "userId",
  "companyId",
  "companyGroupId",
  "eliminationClient",
  "args"
]);

/**
 * Is `paramName` a key the caller genuinely addresses, or does it just happen to
 * collide with a field of the object this param expects? A service whose sole
 * payload param is a destructured object can share its name with one of that
 * object's own fields — `upsertMaintenanceDispatchComment(client, comment: {
 * maintenanceDispatchId, comment, … })`, where reading `body.comment` hands the
 * service the string instead of the record.
 *
 * A wrapper op declares exactly one property named for the param — read it. An op
 * whose schema lists the param's own FIELDS is describing the object, not
 * addressing it — pass the whole body. `_operation` is a synthetic discriminator
 * and any property that is itself another serviceParam is addressed on its own
 * pass, so neither counts toward that decision.
 */
function addressesWholeParam(meta: ManifestEntry, paramName: string): boolean {
  const properties = (meta.schema as { properties?: Record<string, unknown> })
    ?.properties;
  // Undeclared, so a key of this name can only be the caller nesting the payload
  // under it — the documented `{ account: {...} }` wrapper.
  if (!properties || !(paramName in properties)) return true;

  const payloadParams = meta.serviceParams.filter(
    (p) => !CONTEXT_PARAM_NAMES.has(p)
  );
  if (payloadParams.length !== 1 || payloadParams[0] !== paramName) return true;

  const own = Object.keys(properties).filter(
    (k) =>
      k !== "_operation" && !(k !== paramName && meta.serviceParams.includes(k))
  );
  return own.length === 1 && own[0] === paramName;
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
    } else if (paramName === "eliminationClient") {
      // A second client for consolidation reads, defaulted by the service to its
      // own `client`. Context, never caller-supplied.
      functionArgs.push(context.client);
    } else if (paramName === "args") {
      // Two wire shapes, told apart by the operation's own schema: when it
      // declares an `args` object the body is `{ args: {...} }`, otherwise the
      // body already IS the args object. A flat body is accepted for both — 18
      // ops mix `args` with sibling top-level params and the extra keys are
      // inert, since setGenericQueryFilters reads only filters/sorts/offset/limit.
      const wrapped = normalizedArgs?.args;
      const value =
        (meta.schema as { properties?: Record<string, unknown> })?.properties
          ?.args &&
        wrapped &&
        typeof wrapped === "object" &&
        !Array.isArray(wrapped)
          ? wrapped
          : normalizedArgs || {};
      functionArgs.push(
        enrichWithAuthContext(value, context, meta.injectAuth, operation)
      );
    } else if (
      normalizedArgs &&
      paramName in normalizedArgs &&
      addressesWholeParam(meta, paramName)
    ) {
      functionArgs.push(
        enrichWithAuthContext(
          normalizedArgs[paramName],
          context,
          meta.injectAuth,
          operation
        )
      );
    } else if (
      declaredScalarParam(meta, paramName) &&
      addressesWholeParam(meta, paramName)
    ) {
      // A scalar param with no matching key. The object fallbacks below would
      // hand the service the whole payload as an id (`.eq("id", { apiKeyId })`
      // matches nothing and reports success); `undefined` keeps the positional
      // arity intact. A missing REQUIRED scalar is rejected earlier by input
      // validation, so only optional ones legitimately reach here. The
      // addressesWholeParam guard keeps a collision op — whose same-named schema
      // entry describes a FIELD, so it looks scalar — falling through instead.
      functionArgs.push(undefined);
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
