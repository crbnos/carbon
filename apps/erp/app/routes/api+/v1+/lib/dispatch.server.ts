// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The bridge from an oRPC procedure to a Carbon service function.
//
// Owns the executeFunction lineage in full: positional-arg assembly from
// serviceParams, payload stamping via enrichWithAuthContext, create-vs-update
// resolution for upserts,
// and the Supabase unwrap. HTTP, MCP, the agent and the workflow dispatcher all pass
// through here. Unlike the legacy executor (which returned { success, … }), this
// THROWS an ORPCError on failure: the HTTP handler maps that to a status code and
// callOperation reconstructs the { success:false, error } envelope.

import type { AuthField, ContextSource, ManifestEntry } from "@carbon/api";
import { ORPCError } from "@orpc/server";
import { getDatabaseClient } from "~/services/database.server";
import type { AuthedContext } from "./base.server";
import { scopedToCompany } from "./company-scope.server";
import { COMPANY_TABLES } from "./operations.server";
import { functionRegistry } from "./registry.server";
import { checkSalesRulesForOperation } from "./sales-rules-gate.server";

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
  // the row table failed. Only createdBy is ADDED to elements (and only for an
  // insert): element keys are spread straight into an INSERT, so adding
  // companyId/updatedBy could add a column the row table doesn't have.
  //
  // But an identity key the CALLER put in a row is always OVERWRITTEN with the
  // authenticated value, on every operation. The input schema preserves unknown
  // keys, so without this a row could carry a forged createdBy/updatedBy (audit
  // attribution) or a foreign companyId straight into a service that spreads it.
  // Overwriting a key that is already present never changes the row's shape.
  // userId is deliberately left alone: in a row it is usually data (the employee
  // being assigned), not the caller.
  if (Array.isArray(value)) {
    const addCreatedBy = operation !== "update" && fields.includes("createdBy");
    return value.map((element) => {
      if (!element || typeof element !== "object" || Array.isArray(element)) {
        return element;
      }
      const row: Record<string, unknown> = {
        ...(element as Record<string, unknown>)
      };
      if (addCreatedBy || "createdBy" in row) row.createdBy = context.userId;
      if ("updatedBy" in row) row.updatedBy = context.userId;
      if ("companyId" in row) row.companyId = context.companyId;
      if ("companyGroupId" in row) row.companyGroupId = context.companyGroupId;
      return row;
    });
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
  // create so the row inserts. With no upsert rule (operation undefined) both
  // audit fields are stamped, exactly as before.
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
  if (fields.includes("userId")) {
    enriched.userId = context.userId;
  }

  // One level down, too. The input schema passes unknown keys through nested
  // objects as well, and a service handed the superuser `db` may spread one
  // straight into a Kysely `.set()` — `updateItemMethodAndSourcing` spreads
  // `itemUpdate`, so `{ itemUpdate: { companyId: "<other>" } }` moved the
  // caller's items into another company. The same rule as the array branch:
  // only an identity key the caller PUT there is overwritten, never added —
  // createdBy/updatedBy included, so a nested row cannot forge attribution
  // any more than a top-level array element can. Nested arrays inside THOSE
  // are not reached.
  for (const [key, nested] of Object.entries(enriched)) {
    if (Array.isArray(nested)) {
      enriched[key] = nested.map((element) =>
        overwriteIdentityKeys(element, context)
      );
    } else {
      enriched[key] = overwriteIdentityKeys(nested, context);
    }
  }

  return enriched;
}

const IDENTITY_KEYS = [
  "createdBy",
  "updatedBy",
  "companyId",
  "companyGroupId"
] as const;

/** A copy of a plain object with any caller-supplied `createdBy` /
 *  `updatedBy` / `companyId` / `companyGroupId` replaced by the authenticated
 *  value (the same keys, and the same never-add rule, as the top-level array
 *  branch); anything else is returned as is. */
function overwriteIdentityKeys(
  value: unknown,
  context: AuthStampContext
): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  if (!IDENTITY_KEYS.some((key) => key in value)) return value;
  const row: Record<string, unknown> = {
    ...(value as Record<string, unknown>)
  };
  if ("createdBy" in row) row.createdBy = context.userId;
  if ("updatedBy" in row) row.updatedBy = context.userId;
  if ("companyId" in row) row.companyId = context.companyId;
  if ("companyGroupId" in row) row.companyGroupId = context.companyGroupId;
  return row;
}

// Pulls a caller-supplied `_operation` out of the args, top level or nested.
// No schema publishes it any more — the dispatcher works out create-vs-update
// itself (resolveUpsertOperation) — but callers written against the old
// contract still send it, and an explicit answer wins. Returns every value it
// found so the caller can reject contradictory ones.
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

type UpsertRule = NonNullable<ManifestEntry["upsert"]>;

/**
 * Whether the manifest says the dispatcher fills this positional param. The
 * generator decides that from the service's signature and body
 * (`contextParamsOf`), so no parameter name is recognised here.
 */
function isContextParam(meta: ManifestEntry, paramName: string): boolean {
  return Object.hasOwn(meta.contextParams, paramName);
}

function contextValue(source: ContextSource, context: AuthedContext): unknown {
  switch (source) {
    case "client":
      return scopedToCompany(context.client, context.companyId, COMPANY_TABLES);
    case "db":
      return getDatabaseClient();
    case "userId":
      return context.userId;
    case "companyId":
      return context.companyId;
    case "companyGroupId":
      return context.companyGroupId;
  }
}

/**
 * A field of the RECORD the call is about: at the top level of the body, or
 * inside the object the payload is wrapped in — `{ job: { id } }`, where `job`
 * is one of the service's payload parameters, or a lone unnamed wrapper, which
 * the dispatcher unwraps the same way.
 *
 * Never inside any other nested object. Searching them all read
 * `{ name, customFields: { id } }` as an update of record `id`, and a create
 * was sent down the service's update branch.
 */
function recordField(
  args: Record<string, any> | undefined,
  field: string,
  payloadParams: readonly string[]
): unknown {
  if (!args) return undefined;
  if (args[field] !== undefined) return args[field];

  const isObject = (value: unknown): value is Record<string, any> =>
    value !== null && typeof value === "object" && !Array.isArray(value);

  for (const name of payloadParams) {
    const wrapper = args[name];
    if (isObject(wrapper) && wrapper[field] !== undefined)
      return wrapper[field];
  }
  const keys = Object.keys(args);
  if (keys.length === 1 && !payloadParams.includes(keys[0])) {
    const wrapper = args[keys[0]];
    if (isObject(wrapper)) return wrapper[field];
  }
  return undefined;
}

/**
 * Whether this call creates or updates, for a service that needs exactly one of
 * `createdBy` / `updatedBy` stamped. The caller is never asked:
 *
 *  - a key field missing or empty → create;
 *  - no lookups → the keys were sent, so update;
 *  - lookups → update when one of them finds the row, else create.
 *
 * `rowExists` is the only thing here that touches the database.
 */
export async function resolveUpsertOperation(
  rule: UpsertRule,
  args: Record<string, any> | undefined,
  payloadParams: readonly string[],
  rowExists: (
    table: string,
    filter: Record<string, unknown>
  ) => Promise<boolean>
): Promise<McpOperation> {
  const values: Record<string, unknown> = {};
  for (const key of rule.keys) {
    const value = recordField(args, key, payloadParams);
    if (value === undefined || value === null || value === "") return "create";
    values[key] = value;
  }
  if (!rule.lookups) return "update";

  for (const lookup of rule.lookups) {
    const filter = Object.fromEntries(
      Object.entries(lookup.match).map(([column, field]) => [
        column,
        values[field]
      ])
    );
    if (await rowExists(lookup.table, filter)) return "update";
  }
  return "create";
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
 * addressing it — pass the whole body. A property that is itself another
 * serviceParam is addressed on its own pass, so it does not count toward that
 * decision.
 */
function addressesWholeParam(meta: ManifestEntry, paramName: string): boolean {
  const properties = (meta.schema as { properties?: Record<string, unknown> })
    ?.properties;
  // Undeclared, so a key of this name can only be the caller nesting the payload
  // under it — the documented `{ account: {...} }` wrapper.
  if (!properties || !(paramName in properties)) return true;

  const payloadParams = meta.serviceParams.filter(
    (p) => !isContextParam(meta, p) && p !== "args"
  );
  if (payloadParams.length !== 1 || payloadParams[0] !== paramName) return true;

  const own = Object.keys(properties).filter(
    (k) => !(k !== paramName && meta.serviceParams.includes(k))
  );
  return own.length === 1 && own[0] === paramName;
}

/**
 * Whether the schema declares `paramName` as an argument of its own that a
 * caller may leave out — as opposed to the one payload param the body IS. A
 * scalar is always its own argument. An object or a list is too when the
 * service takes more than one payload param; when it is the only one, a caller
 * may send its contents flat and the whole body is that param.
 */
function omittedNamedParam(meta: ManifestEntry, paramName: string): boolean {
  if (declaredScalarParam(meta, paramName)) return true;
  const properties = (meta.schema as { properties?: Record<string, unknown> })
    ?.properties;
  if (!properties || !(paramName in properties)) return false;
  const payloadParams = meta.serviceParams.filter(
    (p) => !isContextParam(meta, p) && p !== "args"
  );
  return payloadParams.length > 1;
}

/**
 * The value with every default its schema publishes filled in, wherever the
 * object holding the field was sent: through `properties`, each element of a
 * list, and a union with exactly one alternative of the value's kind (a
 * nullable object; `string | { limit, offset }`). A default is a promise to
 * the caller, and a service typed from a validator's OUTPUT requires the
 * field: a pivot sent `state: {}` crashed reading `state.columnAxis.type`. The
 * generator publishes a default only where this walk reaches it
 * (`publishDefaults`).
 */
export function withSchemaDefaults(schema: unknown, value: unknown): unknown {
  if (!isRecord(schema)) return value;
  const alternatives = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(alternatives)) {
    const kind = Array.isArray(value)
      ? "array"
      : isRecord(value)
        ? "object"
        : "";
    const fitting = alternatives.filter(
      (alternative) => isRecord(alternative) && alternative.type === kind
    );
    return fitting.length === 1 ? withSchemaDefaults(fitting[0], value) : value;
  }
  if (Array.isArray(value)) {
    return isRecord(schema.items)
      ? value.map((element) => withSchemaDefaults(schema.items, element))
      : value;
  }
  if (!isRecord(schema.properties) || !isRecord(value)) return value;
  const filled: Record<string, unknown> = { ...value };
  for (const [name, property] of Object.entries(schema.properties)) {
    if (!isRecord(property)) continue;
    if (filled[name] !== undefined) {
      filled[name] = withSchemaDefaults(property, filled[name]);
    } else if ("default" in property) {
      filled[name] = structuredClone(property.default);
    }
  }
  return filled;
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

  // A legacy `_operation` never reaches the service.
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

  const distinctOperations = [...new Set(requestedOperations)];
  if (meta.upsert && distinctOperations.length > 1) {
    throw new ORPCError("BAD_REQUEST", {
      message: `${meta.name} received conflicting _operation values (${distinctOperations.join(", ")}).`
    });
  }
  const requestedOperation = distinctOperations[0];
  if (
    meta.upsert &&
    requestedOperation !== undefined &&
    requestedOperation !== "create" &&
    requestedOperation !== "update"
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message: `${meta.name}: _operation must be "create" or "update" when it is sent. It can be left out.`
    });
  }
  const operation: McpOperation | undefined = !meta.upsert
    ? undefined
    : ((requestedOperation as McpOperation | undefined) ??
      (await resolveUpsertOperation(
        meta.upsert,
        normalizedArgs,
        meta.serviceParams.filter((name) => !isContextParam(meta, name)),
        async (table, filter) => {
          // Scoped to the caller's company on top of RLS: a user-scoped client
          // can see every company the user belongs to.
          const { data, error } = await (context.client as any)
            .from(table)
            .select("companyId")
            .match(filter)
            .eq("companyId", context.companyId)
            .limit(1);
          if (error) {
            throw new ORPCError("BAD_REQUEST", {
              message: supabaseErrorMessage(error),
              data: { supabase: error }
            });
          }
          return Array.isArray(data) && data.length > 0;
        }
      )));

  // Published defaults are filled where the call supplies a whole value, and
  // never on an update: there a field left out keeps what is stored. Each
  // argument is filled against ITS schema once the body's shape is known —
  // filling the raw body first would add keys beside a wrapper and change
  // which shape it is read as.
  const fills =
    meta.defaults === "always" ||
    (meta.defaults === "create" && operation === "create");
  const filled = (schema: unknown, value: unknown) =>
    fills ? withSchemaDefaults(schema, value) : value;
  const declared = (meta.schema as { properties?: Record<string, unknown> })
    ?.properties;

  const functionArgs: any[] = [];
  for (const paramName of meta.serviceParams) {
    if (isContextParam(meta, paramName)) {
      functionArgs.push(contextValue(meta.contextParams[paramName], context));
    } else if (paramName === "args") {
      // Two wire shapes, told apart by the operation's own schema: when it
      // declares an `args` object the body is `{ args: {...} }`, otherwise the
      // body already IS the args object. A flat body is accepted for both — 18
      // ops mix `args` with sibling top-level params and the extra keys are
      // inert, since setGenericQueryFilters reads only filters/sorts/offset/limit.
      const wrapped = normalizedArgs?.args;
      const value =
        declared?.args &&
        wrapped &&
        typeof wrapped === "object" &&
        !Array.isArray(wrapped)
          ? wrapped
          : normalizedArgs || {};
      functionArgs.push(
        enrichWithAuthContext(
          filled(declared?.args ?? meta.schema, value),
          context,
          meta.injectAuth,
          operation
        )
      );
    } else if (
      normalizedArgs &&
      paramName in normalizedArgs &&
      addressesWholeParam(meta, paramName)
    ) {
      // The param's own schema when it is published as an argument; the whole
      // schema when the caller wrapped a flat payload in the param's name.
      functionArgs.push(
        enrichWithAuthContext(
          filled(
            declared?.[paramName] ?? meta.schema,
            normalizedArgs[paramName]
          ),
          context,
          meta.injectAuth,
          operation
        )
      );
    } else if (
      omittedNamedParam(meta, paramName) &&
      addressesWholeParam(meta, paramName)
    ) {
      // A param the caller addresses by name, with no matching key: it was
      // left out. The object fallbacks below would hand the service the whole
      // payload in its place — as an id (`.eq("id", { apiKeyId })` matches
      // nothing and reports success), or as a list
      // (`getActiveJobOperationsByLocation({ locationId })` sent the body as
      // `workCenterIds` and Postgres answered "expected JSON array").
      // `undefined` keeps the positional arity intact and lets the service's
      // own default apply. A missing REQUIRED param is rejected earlier by
      // input validation, so only optional ones legitimately reach here. The
      // addressesWholeParam guard keeps a collision op — whose same-named schema
      // entry describes a FIELD, so it looks scalar — falling through instead.
      const own = declared?.[paramName];
      functionArgs.push(
        fills && isRecord(own) && "default" in own
          ? structuredClone(own.default)
          : undefined
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
          filled(meta.schema, Object.values(normalizedArgs)[0]),
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
          filled(meta.schema, { ...normalizedArgs }),
          context,
          meta.injectAuth,
          operation
        )
      );
    }
    // else: optional param with nothing to fill — skip.
  }

  // Sales-rule gate — evaluates the RESOLVED payload for the gated sales
  // operations (line writes + finalize/convert transitions) and refuses on
  // error-severity violations, mirroring the route actions. Covers every
  // dispatch caller: HTTP v1, MCP, the in-app agent, and workflows.
  const salesRuleBlock = await checkSalesRulesForOperation(
    meta,
    context,
    functionArgs
  );
  if (salesRuleBlock) {
    throw new ORPCError("FORBIDDEN", { message: salesRuleBlock });
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

  return readServiceResult(meta, result);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function serviceFailure(error: unknown): ORPCError<"BAD_REQUEST", unknown> {
  return new ORPCError("BAD_REQUEST", {
    message: supabaseErrorMessage(error),
    data: { supabase: error }
  });
}

/**
 * Turn what the service returned into the operation's result, or throw when the
 * service said it failed. A service does not throw, and where it puts the
 * failure is read off its return type by the generator (`resultShape`).
 *
 * Only `{ data, error }` used to be read, and only when `data` was present, so
 * a bare `{ error }`, a failed write inside a `Promise.all`, and `{ ok: false }`
 * all went back to the caller as a success.
 */
function readServiceResult(
  meta: ManifestEntry,
  result: unknown
): DispatchResult {
  if (meta.resultShape === "envelopes" && Array.isArray(result)) {
    const failed = result.find((item) => isRecord(item) && item.error);
    if (failed) throw serviceFailure((failed as { error: unknown }).error);
    return { data: result };
  }

  if (!isRecord(result)) return { data: result };

  // Read whatever the manifest says: a truthy `error` on the result object is a
  // failure under every shape, including a return type the checker saw as `any`.
  if (result.error) throw serviceFailure(result.error);

  if (
    meta.resultShape === "flag" &&
    (result.ok === false || result.success === false)
  ) {
    const reason = result.reason ?? result.message;
    throw new ORPCError("BAD_REQUEST", {
      message:
        typeof reason === "string" ? reason : "The operation did not succeed."
    });
  }

  if ("data" in result) {
    return {
      data: result.data,
      count: (result.count as number | null | undefined) ?? undefined
    };
  }
  return { data: result };
}
