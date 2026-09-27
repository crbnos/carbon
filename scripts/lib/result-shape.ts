/**
 * The RESULT contract between a service function and the dispatcher.
 *
 * `dispatch.server.ts` has to turn whatever a service returns into success data or
 * a thrown error. Sniffing the runtime value for a `data` key (the old rule) let
 * four shapes through as success: an error-only `{ error }`, a bespoke
 * `{ success: false }` / `{ ok: false }`, a `Promise.all` array of PostgREST
 * responses, and any envelope carrying siblings next to `data`. So the generator
 * classifies each export's DECLARED return type once, the manifest records it as
 * `resultShape`, and the dispatcher branches on that static bit instead.
 *
 * - `envelope`: `{ data, error?, count?, status?, statusText?, response? }` and
 *   nothing else — a PostgREST/storage/functions response or the hand-rolled
 *   equivalent. Error thrown,
 *   `data` (+ `count`) returned.
 * - `envelope-array`: an array or tuple of envelopes (`Promise.all` over updates).
 *   Any element error is thrown — the route idiom `updates.some((u) => u.error)` —
 *   otherwise the elements' `data` is returned.
 * - `void`: nothing comes back.
 * - `plain`: any other value, returned as-is. It cannot carry a failure, so the
 *   generator refuses a plain value with a member named `error`, `success` or `ok`.
 * - `unknown`: `any`/`unknown` — nothing can be said statically; the dispatcher
 *   keeps its legacy runtime rule.
 */

import type { ResultShape } from "@carbon/api";
import { type Node, ts, type Type } from "ts-morph";

export type { ResultShape };

/** The only keys an envelope may carry next to `data`. */
export const ENVELOPE_SIBLING_KEYS = new Set([
  "error",
  "count",
  "status",
  "statusText",
  // `functions.invoke` responses carry the raw fetch Response on failure.
  "response"
]);

/** Member names that make a plain value read as a success/failure report. */
export const FAILURE_MEMBER_NAMES = ["error", "success", "ok"] as const;

/**
 * The ONE envelope predicate, over property names. Shared by the response-schema
 * reflector (which peels the envelope to document `data`) and the result
 * classifier (which tells the dispatcher to unwrap it) — so the published schema
 * and the runtime unwrap cannot disagree about what an envelope is.
 */
export function isEnvelopeKeySet(keys: readonly string[]): boolean {
  if (!keys.includes("data")) return false;
  // `{ data, error, …extras }` is still an envelope: the dispatcher throws its
  // error and returns `data`, dropping the extras (see `envelopeExtras`).
  return (
    keys.includes("error") ||
    keys.every((key) => key === "data" || ENVELOPE_SIBLING_KEYS.has(key))
  );
}

/**
 * Keys an envelope carries beyond `data` and the driver siblings — `cta`,
 * `hasMore`, `page`. The dispatcher drops them (they never reach an API or MCP
 * caller); whether they belong under `data` or in a response `meta` is an open
 * decision, so they are reported rather than refused.
 */
export function envelopeExtras(keys: readonly string[]): string[] {
  return keys.filter(
    (key) => key !== "data" && !ENVELOPE_SIBLING_KEYS.has(key)
  );
}

function propertyNames(type: Type): string[] {
  return type
    .getProperties()
    .map((p) => p.getName())
    .filter((name) => !name.startsWith("__@"));
}

function isArrayLike(type: Type): boolean {
  if (type.isArray() || type.isTuple()) return true;
  const name = type.getSymbol()?.getName();
  return name === "ReadonlyArray";
}

function arrayElementTypes(type: Type): Type[] {
  if (type.isTuple()) return type.getTupleElements();
  const element =
    type.getArrayElementType() ?? type.getTypeArguments()[0] ?? undefined;
  return element ? [element] : [];
}

function concreteMembers(type: Type): Type[] {
  const members = type.isUnion() ? type.getUnionTypes() : [type];
  return members.filter((t) => !t.isNull() && !t.isUndefined());
}

/** An object type whose property names satisfy the envelope predicate. */
export function isEnvelopeType(type: Type): boolean {
  if (!type.isObject() || isArrayLike(type)) return false;
  return isEnvelopeKeySet(propertyNames(type));
}

/**
 * Peel `Promise<T>` and any thenable (a supabase query builder returned without
 * `await`) down to the value a caller awaits.
 */
export function awaitedType(type: Type, at: Node): Type {
  let current = type;
  for (let i = 0; i < 6; i++) {
    const name =
      current.getSymbol()?.getName() ?? current.getAliasSymbol()?.getName();
    const args = current.getTypeArguments();
    if (name === "Promise" && args.length > 0) {
      current = args[0];
      continue;
    }
    if (current.isUnion() || !current.isObject()) break;
    const then = current.getProperty("then");
    if (!then) break;
    // `then(onfulfilled?: (value: T) => …)` — T is the awaited value.
    const signature = then.getTypeAtLocation(at).getCallSignatures()[0];
    const onFulfilled = signature?.getParameters()[0]?.getTypeAtLocation(at);
    const callback = onFulfilled
      ? concreteMembers(onFulfilled).find(
          (t) => t.getCallSignatures().length > 0
        )
      : undefined;
    const value = callback
      ?.getCallSignatures()[0]
      ?.getParameters()[0]
      ?.getTypeAtLocation(at);
    if (!value) break;
    current = value;
  }
  return current;
}

type MemberKind = "envelope" | "envelope-array" | "plain";

function memberKind(type: Type): MemberKind {
  if (isArrayLike(type)) {
    const elements = arrayElementTypes(type).flatMap(concreteMembers);
    return elements.length > 0 && elements.every(isEnvelopeType)
      ? "envelope-array"
      : "plain";
  }
  return isEnvelopeType(type) ? "envelope" : "plain";
}

/** Does the type, walked a few levels deep, contain a `bigint`? */
function containsBigInt(
  type: Type,
  at: Node,
  depth = 0,
  seen: Set<string> = new Set()
): boolean {
  if (depth > 4) return false;
  if (type.getFlags() & ts.TypeFlags.BigIntLike) return true;
  if (type.isUnion()) {
    return type
      .getUnionTypes()
      .some((t) => containsBigInt(t, at, depth, seen));
  }
  if (type.isIntersection()) {
    return type
      .getIntersectionTypes()
      .some((t) => containsBigInt(t, at, depth, seen));
  }
  if (isArrayLike(type)) {
    return arrayElementTypes(type).some((t) =>
      containsBigInt(t, at, depth + 1, seen)
    );
  }
  if (!type.isObject()) return false;
  const key = type.getText();
  if (seen.has(key)) return false;
  seen.add(key);
  // Functions and class instances with methods are not results; only walk data.
  if (type.getCallSignatures().length > 0) return false;
  return type
    .getProperties()
    .filter((p) => !p.getName().startsWith("__@"))
    .slice(0, 150)
    .some((p) => containsBigInt(p.getTypeAtLocation(at), at, depth + 1, seen));
}

export interface ResultShapeReport {
  shape: ResultShape;
  /** Contract violations; `generate:mcp` fails while any exist. */
  violations: string[];
  /** Envelope keys the dispatcher drops (`envelopeExtras`), sorted. */
  extras: string[];
}

/**
 * Classify a service function's declared return type. `returnType` is the raw
 * return type (Promise and builders included); `at` is the declaration node.
 */
export function classifyResultType(
  returnType: Type,
  at: Node
): ResultShapeReport {
  const type = awaitedType(returnType, at);
  const violations: string[] = [];

  if (type.isAny() || type.isUnknown()) {
    return { shape: "unknown", violations, extras: [] };
  }

  const members = concreteMembers(type).filter(
    (t) => !t.isVoid() && !t.isNever()
  );
  if (members.length === 0) return { shape: "void", violations, extras: [] };

  if (containsBigInt(type, at)) {
    violations.push(
      "returns a bigint, which JSON cannot carry — return a number (e.g. `{ removed: Number(n) }`)"
    );
  }

  const kinds = new Set(members.map(memberKind));
  if (kinds.size > 1) {
    const shapes = members
      .map((m) => (isArrayLike(m) ? "[]" : `{ ${propertyNames(m).join(", ")} }`))
      .join(" | ");
    violations.push(
      `mixes ${[...kinds].sort().join(" and ")} results (${shapes}) — return one shape (a failure belongs in \`{ data: null, error }\`)`
    );
    return { shape: "plain", violations, extras: [] };
  }

  const shape = [...kinds][0];
  const extras = new Set<string>();
  if (shape === "envelope") {
    for (const member of members) {
      for (const key of envelopeExtras(propertyNames(member))) extras.add(key);
    }
  }
  if (shape === "plain") {
    for (const member of members) {
      if (!member.isObject() || isArrayLike(member)) continue;
      const names = propertyNames(member);
      const offending = FAILURE_MEMBER_NAMES.filter((n) => names.includes(n));
      if (offending.length > 0) {
        violations.push(
          `returns a plain object { ${names.join(", ")} } — its \`${offending.join("`, `")}\` cannot reach the caller as a failure; return \`{ data, error }\` (ruleError for a service-authored message)`
        );
        break;
      }
    }
  }
  return { shape, violations, extras: [...extras].sort() };
}
