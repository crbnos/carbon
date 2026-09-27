// Turns a service function's return value into DispatchResult data or a thrown
// failure, by the result shape the generator recorded for it (`resultShape`,
// scripts/lib/result-shape.ts) — never by sniffing the value. HTTP, MCP, the
// in-app agent and the workflow dispatcher all receive what this returns.

import type { ManifestEntry, ResultShape } from "@carbon/api";
import { ORPCError } from "@orpc/server";
import { ruleError } from "~/utils/supabase";

export interface DispatchResult {
  data: unknown;
  count?: number;
}

type Envelope = { data?: unknown; error?: unknown; count?: number | null };

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

/**
 * The failure a service returned, classified the way `call.server.ts` reads
 * it. A database, storage or functions failure (anything carrying a `code`, a
 * PostgrestError, a pg error, a `ruleError`; or a Functions/Storage error by
 * name) keeps its identity, so a real database failure still gets the fixed
 * public message. A message the service wrote itself — a string, or an object
 * with a `message` and no `code` — becomes a `ruleError`, so callers see it as
 * written instead of "Database error: the operation could not be completed."
 */
export function classifyServiceError(error: unknown): {
  message: string;
  code?: string;
  name?: string;
} {
  if (typeof error === "string") return ruleError(error);
  if (isObject(error)) {
    const { code, name, message } = error as {
      code?: unknown;
      name?: unknown;
      message?: unknown;
    };
    if (typeof code === "string" && code.length > 0) {
      return error as { message: string; code: string };
    }
    if (
      typeof name === "string" &&
      /^(Functions|Storage)\w*Error$/.test(name)
    ) {
      return error as { message: string; name: string };
    }
    if (typeof message === "string" && message.length > 0) {
      return ruleError(message);
    }
    return error as { message: string };
  }
  return { message: String(error) };
}

/** The ORPCError a returned failure becomes — BAD_REQUEST, as it always was. */
export function serviceFailure(error: unknown): ORPCError<string, unknown> {
  const failure = classifyServiceError(error);
  return new ORPCError("BAD_REQUEST", {
    message:
      typeof failure.message === "string" && failure.message.length > 0
        ? failure.message
        : JSON.stringify(failure),
    data: { supabase: failure }
  });
}

/**
 * JSON values, by the rules the HTTP OpenAPI serializer applies
 * (`StandardOpenAPIJsonSerializer`): a Map becomes its entries array, a Set an
 * array, a bigint its decimal string. Applied here so MCP, the agent and
 * workflows receive exactly what an HTTP caller does — `JSON.stringify` alone
 * writes a Map as `{}` and throws on a bigint. Copy-on-write: a value with none
 * of these is returned as the same reference.
 */
export function toWireValue(value: unknown, depth = 0): unknown {
  if (typeof value === "bigint") return value.toString();
  if (!value || typeof value !== "object" || depth > 64) return value;
  if (value instanceof Map) {
    return toWireValue(Array.from(value.entries()), depth + 1);
  }
  if (value instanceof Set) return toWireValue(Array.from(value), depth + 1);
  if (Array.isArray(value)) {
    let out: unknown[] | null = null;
    for (let i = 0; i < value.length; i++) {
      const wire = toWireValue(value[i], depth + 1);
      if (wire !== value[i]) {
        out ??= value.slice();
        out[i] = wire;
      }
    }
    return out ?? value;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  let out: Record<string, unknown> | null = null;
  for (const [key, entry] of Object.entries(value)) {
    const wire = toWireValue(entry, depth + 1);
    if (wire !== entry) {
      out ??= { ...(value as Record<string, unknown>) };
      out[key] = wire;
    }
  }
  return out ?? value;
}

function unwrapEnvelope(result: unknown): DispatchResult {
  if (!isObject(result)) return { data: toWireValue(result) };
  const envelope = result as Envelope;
  if (envelope.error) throw serviceFailure(envelope.error);
  return {
    data: toWireValue(envelope.data),
    count: envelope.count ?? undefined
  };
}

function unwrapEnvelopeArray(result: unknown): DispatchResult {
  if (!Array.isArray(result)) return unwrapEnvelope(result);
  // Any element, not the first: the routes fail a reorder on
  // `updates.some((u) => u.error)`.
  const failed = result.find(
    (element) => isObject(element) && (element as Envelope).error
  ) as Envelope | undefined;
  if (failed) throw serviceFailure(failed.error);
  return {
    data: toWireValue(
      result.map((element) =>
        isObject(element) && "data" in element
          ? ((element as Envelope).data ?? null)
          : element
      )
    )
  };
}

/**
 * The dispatcher's reading of a service result. Keyed on the static
 * `resultShape`; only an operation the generator could not classify (`unknown`,
 * an `any` return, or a manifest predating result shapes) falls back to the
 * legacy runtime rule of unwrapping a `data` key.
 */
export function normalizeServiceResult(
  meta: Pick<ManifestEntry, "resultShape">,
  result: unknown
): DispatchResult {
  const shape: ResultShape = meta.resultShape ?? "unknown";
  switch (shape) {
    case "envelope":
      return unwrapEnvelope(result);
    case "envelope-array":
      return unwrapEnvelopeArray(result);
    case "void":
    case "plain":
      return { data: toWireValue(result) };
    case "unknown":
      return isObject(result) && !Array.isArray(result) && "data" in result
        ? unwrapEnvelope(result)
        : { data: toWireValue(result) };
  }
}
