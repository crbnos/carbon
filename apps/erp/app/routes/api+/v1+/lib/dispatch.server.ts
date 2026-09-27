// The bridge from an oRPC procedure to a Carbon service function.
//
// Owns the executeFunction lineage in full: positional-arg assembly from
// serviceParams and the manifest's declared context contract (`contextSlots`),
// payload stamping via enrichWithAuthContext, `_operation` handling, and the
// Supabase unwrap. HTTP, MCP, the agent and the workflow dispatcher all pass
// through here. Unlike the legacy executor (which returned { success, … }), this
// THROWS an ORPCError on failure: the HTTP handler maps that to a status code and
// callOperation reconstructs the { success:false, error } envelope.

import type { AuthField, ManifestEntry, PayloadContext } from "@carbon/api";
import { ORPCError } from "@orpc/server";
import { getDatabaseClient } from "~/services/database.server";
import type { AuthedContext } from "./base.server";
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

const IDENTITY_KEYS = [
  "createdBy",
  "updatedBy",
  "companyId",
  "companyGroupId"
] as const;

function identityValue(
  field: AuthField,
  context: AuthStampContext
): string | undefined {
  switch (field) {
    case "createdBy":
    case "updatedBy":
    case "userId":
      return context.userId;
    case "companyId":
      return context.companyId;
    case "companyGroupId":
      return context.companyGroupId;
  }
}

/**
 * The identity fields to set on one payload object: its contract's fields, or,
 * for a union, the branch the service will take — read off the payload exactly
 * as the service's `"key" in payload` test reads it, or, when the service splits
 * on an identity field the dispatcher itself sets, off the caller's
 * `_operation`.
 */
function branchFields(
  row: Record<string, unknown>,
  contract: PayloadContext,
  operation: McpOperation | undefined
): AuthField[] {
  if (contract.byOperation) {
    return operation ? contract.byOperation[operation] : [];
  }
  if (contract.discriminator) {
    return contract.discriminator.key in row
      ? contract.discriminator.present
      : contract.discriminator.absent;
  }
  return contract.fields;
}

/**
 * Sets the declared identity fields on one payload object from the
 * authenticated context, and removes every other identity key the caller sent:
 * the service declared exactly what it takes, and an undeclared key is either a
 * column the table does not have (PGRST204) or a forged author. A payload whose
 * type declares no fields (`opaque`) cannot say which keys are real, so a
 * caller-sent identity key is overwritten there instead of removed. `userId` is
 * never removed: in a row it is usually data (the employee being assigned), and
 * neither is an identity-named field a form declares (`callerFields`).
 */
function stampRow(
  row: Record<string, unknown>,
  fields: readonly AuthField[],
  context: AuthStampContext,
  contract: PayloadContext
): Record<string, unknown> {
  const stamped: Record<string, unknown> = { ...row };
  for (const key of IDENTITY_KEYS) {
    if (!(key in stamped) || fields.includes(key)) continue;
    // A form field that happens to carry an identity name is the caller's data.
    if (contract.callerFields?.includes(key)) continue;
    if (contract.opaque) stamped[key] = identityValue(key, context);
    else delete stamped[key];
  }
  for (const field of fields) stamped[field] = identityValue(field, context);
  return stamped;
}

/**
 * Stamps auth identity onto one payload argument, following the argument's
 * declared context contract (`contextSlots.payloads`, derived by the generator
 * from the service signature): exactly the identity fields the service declares
 * — per union branch, and per element for an array of rows — are set from the
 * authenticated context, never from the caller.
 */
export function enrichWithAuthContext(
  value: unknown,
  context: AuthStampContext,
  contract: PayloadContext | undefined,
  operation?: McpOperation
): unknown {
  if (!value || typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value.map((element) => {
      if (!element || typeof element !== "object" || Array.isArray(element)) {
        return element;
      }
      const row = element as Record<string, unknown>;
      // Rows of a declared array get their declared fields; rows the caller put
      // where the service expects something else only lose forged identity.
      return contract?.elements
        ? stampRow(
            row,
            branchFields(row, contract, operation),
            context,
            contract
          )
        : overwriteIdentityKeys(row, context);
    });
  }

  const payload = value as Record<string, unknown>;
  const enriched =
    contract && !contract.elements
      ? stampRow(
          payload,
          branchFields(payload, contract, operation),
          context,
          contract
        )
      : (overwriteIdentityKeys(payload, context) as Record<string, unknown>);

  // One level down, too. The input schema passes unknown keys through nested
  // objects as well, and a service handed the superuser `db` may spread one
  // straight into a Kysely `.set()` — `updateItemMethodAndSourcing` spreads
  // `itemUpdate`, so `{ itemUpdate: { companyId: "<other>" } }` moved the
  // caller's items into another company. Only an identity key the caller PUT
  // there is overwritten, never added: a nested row's shape is not declared in
  // the contract. Nested arrays inside THOSE are not reached.
  for (const [key, nested] of Object.entries(enriched)) {
    if (contract?.db?.includes(key)) continue;
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

/** A copy of a plain object with any caller-supplied `createdBy` /
 *  `updatedBy` / `companyId` / `companyGroupId` replaced by the authenticated
 *  value; anything else is returned as is. */
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
  for (const key of IDENTITY_KEYS) {
    if (key in row) row[key] = identityValue(key, context);
  }
  return row;
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

/** The service params the caller supplies — every other slot is filled from
 *  the authenticated context. */
function payloadParams(meta: ManifestEntry): string[] {
  return meta.serviceParams.filter(
    (_, i) => meta.contextSlots.params[i] === "payload"
  );
}

/**
 * The one payload param that receives the whole request body when the caller
 * does not address it by name: the sole payload param, or else the schema's
 * sole required property when that is an object param (the same shape input
 * validation accepts sent flat — `compileSoleWrapper`). Every other param the
 * caller leaves out gets `undefined`, so an optional `options` / `window` /
 * id list never receives the body meant for its sibling.
 */
function bodyTarget(meta: ManifestEntry): string | undefined {
  const payload = payloadParams(meta);
  const properties = (
    meta.schema as { properties?: Record<string, { type?: unknown }> }
  )?.properties;
  if (payload.length === 1) {
    // A sole array or scalar param is published wrapped under its own name and
    // never describes the body; a same-named FIELD of a flattened object param
    // (a collision, see addressesWholeParam) does not make it one.
    const only = payload[0];
    const type = properties?.[only]?.type;
    const wrapsNonObject =
      type !== undefined &&
      type !== "object" &&
      addressesWholeParam(meta, only);
    return wrapsNonObject ? undefined : only;
  }
  const required = (meta.schema as { required?: unknown }).required;
  if (!Array.isArray(required) || required.length !== 1) return undefined;
  const sole = required[0] as string;
  return payload.includes(sole) && properties?.[sole]?.type === "object"
    ? sole
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

  const payload = payloadParams(meta);
  if (payload.length !== 1 || payload[0] !== paramName) return true;

  const own = Object.keys(properties).filter(
    (k) =>
      k !== "_operation" && !(k !== paramName && meta.serviceParams.includes(k))
  );
  return own.length === 1 && own[0] === paramName;
}

/** A payload property typed `Kysely<…>` is the server database client — the
 *  route builds it with `getDatabaseClient()` and passes it in the payload
 *  (`activateAssemblyInstructionVersion`). Never read from the caller. */
function fillPayloadDb(
  value: unknown,
  contract: PayloadContext | undefined
): unknown {
  if (!contract?.db?.length) return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const filled: Record<string, unknown> = { ...(value as object) };
  for (const key of contract.db) filled[key] = getDatabaseClient();
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

  const target = bodyTarget(meta);
  const functionArgs: any[] = [];
  meta.serviceParams.forEach((paramName, index) => {
    const slot = meta.contextSlots.params[index];
    switch (slot) {
      case "client":
        functionArgs.push(context.client);
        return;
      case "db":
        functionArgs.push(getDatabaseClient());
        return;
      case "userId":
      case "auditUser":
        // A positional createdBy/updatedBy is the acting user, the same value
        // the route passes (`updatedBy: userId`) — never read from the body.
        functionArgs.push(context.userId);
        return;
      case "companyId":
        functionArgs.push(context.companyId);
        return;
      case "companyGroupId":
        functionArgs.push(context.companyGroupId);
        return;
      case "eliminationClient":
        // A second client for consolidation reads, defaulted by the service to its
        // own `client`. Context, never caller-supplied.
        functionArgs.push(context.client);
        return;
    }

    const contract = meta.contextSlots.payloads[paramName];
    const fill = (value: unknown) =>
      fillPayloadDb(
        enrichWithAuthContext(value, context, contract, operation),
        contract
      );

    if (paramName === "args") {
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
      functionArgs.push(fill(value));
    } else if (
      normalizedArgs &&
      paramName in normalizedArgs &&
      addressesWholeParam(meta, paramName)
    ) {
      functionArgs.push(fill(normalizedArgs[paramName]));
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
    } else if (paramName !== target) {
      // Not addressed, and not the param the body describes: an omitted
      // optional param. The service applies its own default.
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
      functionArgs.push(fill(Object.values(normalizedArgs)[0]));
    } else if (normalizedArgs && Object.keys(normalizedArgs).length > 0) {
      // No key matched — pass the whole args object positionally (flat-field calls
      // like upsertPart(client, part)).
      functionArgs.push(fill({ ...normalizedArgs }));
    } else if (
      contract &&
      !contract.elements &&
      (contract.fields.length > 0 ||
        contract.discriminator ||
        contract.byOperation ||
        contract.db?.length)
    ) {
      // Nothing sent, but the payload declares context of its own (a payload of
      // only `{ companyId; userId }`, or a `db`): it still gets it.
      functionArgs.push(fill({}));
    } else {
      functionArgs.push(undefined);
    }
  });

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

  // Supabase response shape { data, error, count } — unwrap, or throw on error.
  if (result && typeof result === "object" && "data" in result) {
    const r = result as { data: unknown; error?: unknown; count?: number };
    if (r.error) {
      throw new ORPCError("BAD_REQUEST", {
        message: supabaseErrorMessage(r.error),
        data: { supabase: r.error }
      });
    }
    return { data: r.data, count: r.count ?? undefined };
  }
  return { data: result };
}
