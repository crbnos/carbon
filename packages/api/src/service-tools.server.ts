// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// What a service function does around the building block it calls: put the
// caller's identity on the payload (`payload`), read the building block's
// `{ data, error }` as the result (`unwrap`, `paged`), and turn a posting
// engine's throw into a refusal (`run`).

import { failSpan, inSpan } from "@carbon/logger/span";
import { RAISED_EXCEPTION, ServerFnError, toServerFnError } from "./errors";
import { SERVICE_RULE_ERROR_CODE } from "./rule-error";
import {
  CarbonError,
  type ErrorCategory,
  type ServiceContext
} from "./service-fn.server";

type StampField =
  | "companyId"
  | "companyGroupId"
  | "createdBy"
  | "updatedBy"
  | "userId";

const IDENTITY_KEYS = [
  "createdBy",
  "updatedBy",
  "companyId",
  "companyGroupId"
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Overwrite an identity key the caller put in `value`; never add one. */
function overwriteIdentityKeys(ctx: ServiceContext, value: unknown): unknown {
  if (!isRecord(value) || !IDENTITY_KEYS.some((key) => key in value)) {
    return value;
  }
  const row = { ...value };
  if ("createdBy" in row) row.createdBy = ctx.auditUserId;
  if ("updatedBy" in row) row.updatedBy = ctx.auditUserId;
  if ("companyId" in row) row.companyId = ctx.company.id;
  if ("companyGroupId" in row) row.companyGroupId = ctx.company.groupId;
  return row;
}

/**
 * The payload with the caller's identity in `fields`. `operation` picks the audit field of an upsert: a create gets
 * `createdBy` and loses `updatedBy`, an update the reverse (a service that
 * branches on `"createdBy" in` or `"updatedBy" in` takes the right branch).
 * Without it, `fields` naming only `updatedBy` means an update and only
 * `createdBy` a create.
 *
 * The input keeps unknown keys, so an identity key (`companyId`,
 * `companyGroupId`, `createdBy`, `updatedBy`) the caller put at the top level,
 * one level down, or in a row of a list is overwritten too, listed in `fields`
 * or not: a payload cannot name another company or forge who wrote it.
 * `userId` is overwritten only when listed: some inputs name a target user
 * with it.
 */
function stamp<T>(
  ctx: ServiceContext,
  value: T,
  fields: StampField[],
  operation?: "create" | "update"
): T {
  if (!value || typeof value !== "object") return value;

  if (Array.isArray(value)) {
    // A row of a list is spread into an INSERT: only createdBy is added (on a
    // create), the other identity keys only overwritten.
    const addCreatedBy = operation !== "update" && fields.includes("createdBy");
    return value.map((element) => {
      if (!isRecord(element)) return element;
      const row: Record<string, unknown> = { ...element };
      if (addCreatedBy || "createdBy" in row) row.createdBy = ctx.auditUserId;
      if ("updatedBy" in row) row.updatedBy = ctx.auditUserId;
      if ("companyId" in row) row.companyId = ctx.company.id;
      if ("companyGroupId" in row) row.companyGroupId = ctx.company.groupId;
      return row;
    }) as T;
  }

  const stamped: Record<string, unknown> = { ...(value as object) };
  const sets = (field: StampField) =>
    fields.includes(field) || field in stamped;
  // Fields that name one audit column name the operation: an update must not
  // rewrite a record's creator, nor a create its last editor.
  operation ??= fields.includes("createdBy")
    ? fields.includes("updatedBy")
      ? undefined
      : "create"
    : fields.includes("updatedBy")
      ? "update"
      : undefined;
  if (operation === "update") delete stamped.createdBy;
  else if (sets("createdBy")) stamped.createdBy = ctx.auditUserId;
  if (operation === "create") delete stamped.updatedBy;
  else if (sets("updatedBy")) stamped.updatedBy = ctx.auditUserId;
  if (sets("companyId")) stamped.companyId = ctx.company.id;
  if (sets("companyGroupId")) stamped.companyGroupId = ctx.company.groupId;
  if (fields.includes("userId")) stamped.userId = ctx.auditUserId;

  for (const [key, nested] of Object.entries(stamped)) {
    stamped[key] = Array.isArray(nested)
      ? nested.map((element) => overwriteIdentityKeys(ctx, element))
      : overwriteIdentityKeys(ctx, nested);
  }
  return stamped as T;
}

/**
 * The payload a service writes, with the caller's identity on it: the
 * company always (unless `withoutCompany`), the author by the terminal.
 *
 * - `forCreate()` — `createdBy`; a `updatedBy` the caller sent is dropped.
 * - `forUpdate()` — `updatedBy`; a `createdBy` is dropped, so an update never
 *   rewrites a record's creator.
 * - `forUpsert()` — both: a service that branches on `"createdBy" in` picks.
 * - `for(operation)` — `forCreate`, `forUpdate` or `forUpsert` by value.
 * - `build()` — no author: a read, or a service that stamps its own.
 *
 * Whatever the terminal, an identity key (`companyId`, `companyGroupId`,
 * `createdBy`, `updatedBy`) the caller put in the payload, one level down or
 * in a list's rows is overwritten: a payload cannot name another company or
 * forge who wrote it. `userId` is set only with `withUser`, since some
 * inputs name a target user with it.
 */
export function payload<T>(ctx: ServiceContext, value: T) {
  const fields = new Set<StampField>(["companyId"]);
  const done = (audit: StampField[], operation?: "create" | "update") =>
    stamp(ctx, value, [...fields, ...audit], operation);
  const builder = {
    /** Also `userId`, as the caller. */
    withUser() {
      fields.add("userId");
      return builder;
    },
    /** Also `companyGroupId`. */
    withGroup() {
      fields.add("companyGroupId");
      return builder;
    },
    /** No `companyId`: the table has none. */
    withoutCompany() {
      fields.delete("companyId");
      return builder;
    },
    forCreate: (): T => done(["createdBy"], "create"),
    forUpdate: (): T => done(["updatedBy"], "update"),
    forUpsert: (): T => done(["createdBy", "updatedBy"]),
    for: (operation: "create" | "update" | undefined): T =>
      done(["createdBy", "updatedBy"], operation),
    build: (): T => done([])
  };
  return builder;
}

const DATABASE_REFUSALS: Record<string, [ErrorCategory, string]> = {
  "23505": ["conflict", "A record with these values already exists."],
  "23503": [
    "conflict",
    "The operation would violate a reference between records."
  ],
  "23502": ["validation", "A required field was missing."],
  "42501": ["forbidden", "You do not have permission to do this"],
  PGRST116: ["notFound", "No matching record was found."]
};

function serviceRefusal(ctx: ServiceContext, error: unknown): CarbonError {
  if (isRecord(error) && error.code === SERVICE_RULE_ERROR_CODE) {
    return ctx.error("rule", String(error.message));
  }
  // A RAISE in our own SQL: its message was written for the person.
  if (
    isRecord(error) &&
    error.code === RAISED_EXCEPTION &&
    typeof error.message === "string" &&
    error.message !== ""
  ) {
    return ctx.error("rule", error.message, error);
  }
  const code = isRecord(error) ? String(error.code ?? "") : "";
  const known = DATABASE_REFUSALS[code];
  return known
    ? ctx.error(known[0], known[1], error)
    : ctx.error("internal", "The operation could not be completed.", error);
}

const STATUS_CATEGORIES: Record<number, ErrorCategory> = {
  400: "validation",
  401: "unauthenticated",
  402: "entitlement",
  403: "forbidden",
  404: "notFound",
  409: "conflict",
  422: "rule",
  429: "rateLimited"
};

/**
 * A server function's refusal as a `CarbonError`: its status picks the
 * category. A message at 500 is a body's authored refusal (a plain throw,
 * which `toServerFnError` keeps): the caller's to fix. Our own failures (a
 * programming error, a thrown 5xx, the data layer, a server failure) arrive
 * with none and are `internal`, with `fallback` as the message.
 */
export function serverFnRefusal(
  ctx: ServiceContext,
  error: { status: number; message: string },
  fallback = "The operation could not be completed."
): CarbonError {
  const { status, message } = error;
  const category =
    STATUS_CATEGORIES[status] ?? (message ? "validation" : "internal");
  return ctx.error(category, message || fallback, error);
}

/**
 * What the service returned, as the tool's result: its `data` (with the
 * `count` of a paged list), or the refusal it reported. A service does not
 * throw: its failure is an `error` in what it returns, a failed element of a
 * list of results, or `{ ok: false }`.
 */
function read(
  ctx: ServiceContext,
  result: unknown,
  paginates = false
): unknown {
  if (!isRecord(result)) return result;

  if (result.error instanceof ServerFnError) {
    return serverFnRefusal(ctx, result.error);
  }
  if (result.error) return serviceRefusal(ctx, result.error);

  if ("data" in result) {
    return paginates
      ? { rows: result.data, count: (result.count as number | null) ?? null }
      : result.data;
  }
  return result;
}

type Envelope = { data?: unknown; error?: unknown; count?: number | null };
type DataOf<R> = R extends { data: infer D } ? D : never;

/**
 * What a building block returned, as the service function's result: the
 * `data` of each `{ data, error }`, or the first refusal. One result gives
 * its data; several give a tuple of them.
 */
export function unwrap<R extends Envelope>(
  ctx: ServiceContext,
  result: R
): DataOf<R> | CarbonError;
export function unwrap<R extends Envelope[]>(
  ctx: ServiceContext,
  ...results: R
): { [K in keyof R]: DataOf<R[K]> } | CarbonError;
export function unwrap(ctx: ServiceContext, ...results: Envelope[]): unknown {
  const values: unknown[] = [];
  for (const result of results) {
    const value = read(ctx, result);
    if (value instanceof CarbonError) return value;
    values.push(value);
  }
  return results.length === 1 ? values[0] : values;
}

/** A paged list's `{ data, count, error }`: its rows and total, or its refusal. */
export function paged<R extends Envelope>(
  ctx: ServiceContext,
  result: R
): { rows: DataOf<R>; count: number | null } | CarbonError {
  return read(ctx, result, true) as
    | { rows: DataOf<R>; count: number | null }
    | CarbonError;
}

/**
 * Run a posting engine's body (a server function ported from
 * `@carbon/server-functions`): its value, or what it threw as the refusal
 * `defineServerFn` made of it. A thrown message is shown to the caller unless
 * it came from the data layer, so the engines keep their own wording; the
 * status decides the category (`NotFoundError` → `notFound`). One span per
 * call, named `function <name>` as before.
 */
export async function run<R>(
  ctx: ServiceContext,
  name: string,
  body: () => Promise<R>,
  defaultStatus = 500
): Promise<R | CarbonError> {
  const out = await attempt(ctx, name, body, defaultStatus);
  return out.error ? (read(ctx, out) as CarbonError) : out.data;
}

/**
 * {@link run}, but the refusal is the `ServerFnError` itself, as
 * `serverFns.invoke` returned it: for a caller that reads its status or body.
 * `body` gets the span, to name the actor when only it knows who the caller is.
 */
export function attempt<R>(
  ctx: Pick<ServiceContext, "actor">,
  name: string,
  body: (span: {
    setAttribute(key: string, value: string): unknown;
  }) => Promise<R>,
  defaultStatus = 500
): Promise<{ data: R; error: null } | { data: null; error: ServerFnError }> {
  return inSpan(
    `function ${name}`,
    { "carbon.function": name, "carbon.function.actor": ctx.actor.type },
    async (span) => {
      try {
        return { data: await body(span), error: null };
      } catch (err) {
        const error = toServerFnError(name, err, defaultStatus);
        span.setAttribute("carbon.function.status", error.status);
        // The span keeps the detail a 5xx withholds from the caller.
        if (error.status >= 500) {
          failSpan(
            span,
            error.message || (err instanceof Error ? err.message : String(err))
          );
        }
        return { data: null, error };
      }
    }
  );
}
