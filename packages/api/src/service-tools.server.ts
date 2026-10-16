// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// What a service function does around the building block it calls: stamp the
// caller's identity onto the payload, read the building block's `{ data, error }`
// as a service function's result, and settle a posting engine's throw.

import { failSpan, inSpan } from "@carbon/logger/span";
import { ServerFnError, toServerFnError } from "./errors";
import { SERVICE_RULE_ERROR_CODE } from "./rule-error";
import type {
  CarbonError,
  ErrorCategory,
  ServiceContext
} from "./service-fn.server";

export type StampField =
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
 * The payload with the caller's identity in the fields the service reads it
 * from. `operation` picks the audit field of an upsert: a create gets
 * `createdBy` and loses `updatedBy`, an update the reverse (a service that
 * branches on `"createdBy" in` or `"updatedBy" in` takes the right branch).
 *
 * The input keeps unknown keys, so an identity key the caller put anywhere
 * one level down, or in a row of a list, is overwritten too: a payload cannot
 * name another company or forge who wrote it.
 */
export function stamp<T>(
  ctx: ServiceContext,
  value: T,
  fields: StampField[],
  operation?: "create" | "update"
): T {
  if (!value || typeof value !== "object" || fields.length === 0) return value;

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
  if (operation === "update") delete stamped.createdBy;
  else if (fields.includes("createdBy")) stamped.createdBy = ctx.auditUserId;
  if (operation === "create") delete stamped.updatedBy;
  else if (fields.includes("updatedBy")) stamped.updatedBy = ctx.auditUserId;
  if (fields.includes("companyId")) stamped.companyId = ctx.company.id;
  if (fields.includes("companyGroupId")) {
    stamped.companyGroupId = ctx.company.groupId;
  }
  if (fields.includes("userId")) stamped.userId = ctx.auditUserId;

  for (const [key, nested] of Object.entries(stamped)) {
    stamped[key] = Array.isArray(nested)
      ? nested.map((element) => overwriteIdentityKeys(ctx, element))
      : overwriteIdentityKeys(ctx, nested);
  }
  return stamped as T;
}

/** Where a service reports what it did: read off its return type. */
export type ResultShape = "envelope" | "plain" | "envelopes" | "flag";

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
 * What the service returned, as the tool's result: its `data` (with the
 * `count` of a paged list), or the refusal it reported. A service does not
 * throw: its failure is an `error` in what it returns, a failed element of a
 * list of results, or `{ ok: false }`.
 */
export function serviceResult(
  ctx: ServiceContext,
  result: unknown,
  shape: ResultShape,
  { paginates = false }: { paginates?: boolean } = {}
): unknown {
  if (shape === "envelopes" && Array.isArray(result)) {
    const failed = result.find((item) => isRecord(item) && item.error);
    return failed
      ? serviceRefusal(ctx, (failed as { error: unknown }).error)
      : result;
  }
  if (!isRecord(result)) return result;

  if (result.error instanceof ServerFnError) {
    const { status, message } = result.error;
    // A server function's own refusal is the caller's to fix, whatever its
    // status; an empty message is a data-layer failure.
    const category =
      STATUS_CATEGORIES[status] ?? (message ? "validation" : "internal");
    return ctx.error(
      category,
      message || "The operation could not be completed.",
      result.error
    );
  }
  if (result.error) return serviceRefusal(ctx, result.error);

  if (shape === "flag" && (result.ok === false || result.success === false)) {
    const reason = result.reason ?? result.message;
    return ctx.error(
      "rule",
      typeof reason === "string" ? reason : "The operation did not succeed."
    );
  }

  if ("data" in result) {
    return paginates
      ? { rows: result.data, count: (result.count as number | null) ?? null }
      : result.data;
  }
  return result;
}

type Envelope = { data?: unknown; error?: unknown; count?: number | null };
type DataOf<R> = R extends { data: infer D } ? D : never;

/** A `{ data, error }` service result: its data, or its refusal. */
export function envelope<R extends Envelope>(
  ctx: ServiceContext,
  result: R
): DataOf<R> | CarbonError {
  return serviceResult(ctx, result, "envelope") as DataOf<R> | CarbonError;
}

/** A paged list's `{ data, count, error }`: its rows and total, or its refusal. */
export function paged<R extends Envelope>(
  ctx: ServiceContext,
  result: R
): { rows: DataOf<R>; count: number | null } | CarbonError {
  return serviceResult(ctx, result, "envelope", { paginates: true }) as
    | { rows: DataOf<R>; count: number | null }
    | CarbonError;
}

/** A value with no envelope; a truthy `error` on it is still a refusal. */
export function plain<R>(ctx: ServiceContext, result: R): R | CarbonError {
  return serviceResult(ctx, result, "plain") as R | CarbonError;
}

/** The results of several writes: refused when any one failed. */
export function envelopes<R extends unknown[]>(
  ctx: ServiceContext,
  result: R
): R | CarbonError {
  return serviceResult(ctx, result, "envelopes") as R | CarbonError;
}

/** A `{ success | ok, message | reason }` result: refused when false. */
export function flag<R>(ctx: ServiceContext, result: R): R | CarbonError {
  return serviceResult(ctx, result, "flag") as R | CarbonError;
}

/**
 * Run a posting engine's body (a server function ported from
 * `@carbon/server-functions`): its value, or what it threw as the refusal
 * `defineServerFn` made of it. A thrown message is shown to the caller unless
 * it came from the data layer, so the engines keep their own wording; the
 * status decides the category (`NotFoundError` → `notFound`). One span per
 * call, named `function <name>` as before.
 */
export function settle<R>(
  ctx: ServiceContext,
  name: string,
  body: () => Promise<R>,
  defaultStatus = 500
): Promise<R | CarbonError> {
  return inSpan(
    `function ${name}`,
    { "carbon.function": name, "carbon.function.actor": ctx.actor.type },
    async (span) => {
      try {
        return await body();
      } catch (err) {
        const error = toServerFnError(name, err, defaultStatus);
        span.setAttribute("carbon.function.status", error.status);
        if (error.status >= 500) failSpan(span, error.message);
        return serviceResult(
          ctx,
          { data: null, error },
          "envelope"
        ) as CarbonError;
      }
    }
  );
}
