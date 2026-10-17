// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * A TypeScript type as a JSON Schema, read with ts-morph: a service
 * function's input and its response. Nothing declares a response — it is
 * whatever `run` returns — and supabase-js infers the SELECTED columns from the
 * select string, so the compiler already knows the exact row shape.
 */

import { Node, type Type } from "ts-morph";

export type JsonSchema = Record<string, unknown>;

/**
 * Rows are wide (40+ columns) and embeds nest, so an uncapped walk can emit a
 * megabyte for one operation. Depth 6 covers the deepest real select — a row, an
 * embedded array, an embed of that, and their columns — which is where PostgREST
 * embeds actually stop. Measured: 5 and 6 cost 1.6 MB and 1.7 MB against 1.6 MB at
 * 4, so the cap is not what the size hinges on; capping too SHALLOW is visible,
 * since a truncated branch renders as a column of nulls in the docs sample.
 */
const MAX_DEPTH = 6;
/** A guard against pathological types, not a real limit — real rows sit well under. */
const MAX_PROPERTIES = 120;

/**
 * Collections `JSON.stringify` writes as `{}` — their members are methods and
 * symbol-keyed slots, none of which reach the wire. Walking them emitted the
 * checker's per-program symbol ids (`__@toStringTag@75448`) as property names,
 * so an unrelated edit anywhere renumbered them and flipped the tool's digest.
 */
const JSON_OPAQUE_COLLECTIONS = new Set([
  "Map",
  "ReadonlyMap",
  "WeakMap",
  "Set",
  "ReadonlySet",
  "WeakSet"
]);

/**
 * Peel the layers between the declared return type and the payload a caller sees:
 * `Promise<PostgrestSingleResponse<T>>` and the hand-rolled
 * `Promise<{ data: T | null; error }>` both reduce to `T`.
 *
 * This mirrors the result readers (`unwrap`, `paged` in
 * `@carbon/api/service-tools.server`), which unwrap the Supabase result to its
 * `data` — so the schema describes what a caller receives, not the driver's
 * envelope.
 */
export function unwrapResponseType(type: Type, at: Node): Type {
  let current = type;
  for (let i = 0; i < 5; i++) {
    const name =
      current.getSymbol()?.getName() ?? current.getAliasSymbol()?.getName();
    const args = current.getTypeArguments();

    if ((name === "Promise" || /^Postgrest\w*Response$/.test(name ?? "")) && args.length > 0) {
      current = args[0];
      continue;
    }

    // `{ data: T | null; error: ... }` — the shape services hand-roll.
    const data = current.getProperty("data");
    if (data && current.getProperty("error")) {
      const dataType = data.getTypeAtLocation(at);
      current = stripNullish(dataType);
      continue;
    }

    break;
  }
  return current;
}

function stripNullish(type: Type): Type {
  if (!type.isUnion()) return type;
  const concrete = type
    .getUnionTypes()
    .filter((t) => !t.isNull() && !t.isUndefined());
  return concrete.length === 1 ? concrete[0] : type;
}

/**
 * Walk a TypeScript type into JSON Schema.
 *
 * `at` is the node types are resolved against (the function declaration) — a
 * property's type is only meaningful at a location. `seen` carries the type-text of
 * every ancestor so a self-referential type (a tree node, a row embedding its own
 * table) terminates instead of recursing forever.
 */
export function typeToJsonSchema(
  type: Type,
  at: Node,
  depth = 0,
  seen: ReadonlySet<string> = new Set(),
  /** For an INPUT: `undefined` means "may be left out", which `required`
   *  already says, so it is dropped instead of read as `null`. */
  undefinedIsAbsent = false
): JsonSchema {
  if (depth > MAX_DEPTH) return {};

  if (type.isString()) return { type: "string" };
  if (type.isNumber()) return { type: "number" };
  if (type.isBoolean()) return { type: "boolean" };
  if (type.isNull() || type.isUndefined()) return { type: "null" };
  if (type.isAny() || type.isUnknown()) return {};
  if (type.isStringLiteral()) {
    return { type: "string", enum: [type.getLiteralValue()] };
  }
  if (type.isNumberLiteral()) {
    return { type: "number", enum: [type.getLiteralValue()] };
  }
  if (type.isBooleanLiteral()) return { type: "boolean" };

  if (type.isArray()) {
    const element = type.getArrayElementType();
    return {
      type: "array",
      items: element
        ? typeToJsonSchema(element, at, depth + 1, seen, undefinedIsAbsent)
        : {}
    };
  }
  // A tuple or a readonly array is a list on the wire too. Neither is
  // `isArray()`, so both fell through to the object walk and came out as a map
  // (`typeof riskStatus`, an `as const` list, read as `Record<string, status>`).
  if (type.isTuple() || type.isReadonlyArray()) {
    const element = type.getNumberIndexType();
    return {
      type: "array",
      items: element
        ? typeToJsonSchema(element, at, depth + 1, seen, undefinedIsAbsent)
        : {}
    };
  }

  if (type.isUnion()) {
    return unionToJsonSchema(type, at, depth, seen, undefinedIsAbsent);
  }

  if (type.isObject()) {
    const symbolName = type.getSymbol()?.getName();
    if (symbolName && JSON_OPAQUE_COLLECTIONS.has(symbolName)) {
      return { type: "object" };
    }

    // The checker's own type id, NOT `type.getText()`. getText() serializes the
    // whole structural type to a string, and a supabase row with embeds
    // serializes to a very large one — paying that at every object node was
    // measured at 5.2s of a 5.2s walk, i.e. effectively the entire cost of
    // walking 1574 return types. The id is O(1), it is only ever a Map key here
    // (never emitted — that is the `__@toStringTag@75448` trap noted above), and
    // it is per-program so it stays valid for the one walk that uses it.
    // Verified byte-identical over all 1574 functions.
    const key = String(
      (type.compilerType as unknown as { id?: number }).id ?? type.getText()
    );
    // Cycle: the type is already being expanded further up this branch.
    if (seen.has(key)) return { type: "object" };

    const nextSeen = new Set(seen).add(key);

    // `Record<K, V>` / any index signature. TypeScript reports these as an object
    // with ZERO NAMED PROPERTIES, so a plain property walk emits a bare
    // `{type:"object"}` and the map's value type is lost — that alone accounted for
    // 9 operations with no usable response, plus every Record nested inside one
    // that otherwise worked. `additionalProperties` is the JSON Schema equivalent,
    // and the docs SchemaTable already renders it as `Record<string, …>`.
    const indexValue =
      type.getStringIndexType() ?? type.getNumberIndexType() ?? undefined;
    const additional = indexValue
      ? typeToJsonSchema(indexValue, at, depth + 1, nextSeen, undefinedIsAbsent)
      : undefined;

    // Symbol-keyed members (`[Symbol.iterator]`, reported as `__@iterator@206`)
    // are dropped by JSON.stringify, and their names carry unstable checker ids.
    const properties = type
      .getProperties()
      .filter((property) => !property.getName().startsWith("__@"));
    // A map with named keys too (a zod `looseObject`: its fields plus any
    // other key) publishes both; a bare map only its value type.
    if (properties.length === 0) {
      return additional
        ? { type: "object", additionalProperties: additional }
        : { type: "object" };
    }
    if (properties.length > MAX_PROPERTIES) return { type: "object" };

    const shape: Record<string, unknown> = {};
    const required: string[] = [];
    for (const property of properties) {
      const propertyType = property.getTypeAtLocation(at);
      shape[property.getName()] = typeToJsonSchema(
        propertyType,
        at,
        depth + 1,
        nextSeen,
        undefinedIsAbsent
      );
      if (!property.isOptional()) required.push(property.getName());
    }

    const out: JsonSchema = { type: "object", properties: shape };
    if (required.length > 0) out.required = required;
    if (additional) out.additionalProperties = additional;
    return out;
  }

  return {};
}

function unionToJsonSchema(
  type: Type,
  at: Node,
  depth: number,
  seen: ReadonlySet<string>,
  undefinedIsAbsent: boolean
): JsonSchema {
  const members = type.getUnionTypes();
  const concrete = members.filter((t) => !t.isNull() && !t.isUndefined());
  const nullable = members.some(
    (t) => t.isNull() || (!undefinedIsAbsent && t.isUndefined())
  );

  // A union of string literals is an enum — the single most useful thing this
  // reflection recovers, and invisible in a hand-written response example.
  if (concrete.length > 0 && concrete.every((t) => t.isStringLiteral())) {
    return {
      type: nullable ? ["string", "null"] : "string",
      enum: concrete.map((t) => t.getLiteralValue())
    };
  }

  // `boolean` is internally `true | false`; keep it as one type.
  if (concrete.length > 0 && concrete.every((t) => t.isBooleanLiteral())) {
    return { type: nullable ? ["boolean", "null"] : "boolean" };
  }

  if (concrete.length === 1) {
    const inner = typeToJsonSchema(
      concrete[0],
      at,
      depth,
      seen,
      undefinedIsAbsent
    );
    if (nullable && typeof inner.type === "string") {
      return { ...inner, type: [inner.type, "null"] };
    }
    return inner;
  }

  // Dedupe: `boolean` is internally `true | false`, so a MIXED union (the `Json`
  // type is the common one — string | number | boolean | object | array) yields two
  // identical `{type:"boolean"}` members. The all-boolean shortcut above only fires
  // when every member is a boolean literal, so mixed unions need this.
  const anyOf = dedupe(
    concrete.map((t) =>
      typeToJsonSchema(t, at, depth + 1, seen, undefinedIsAbsent)
    )
  );
  if (anyOf.length === 1 && !nullable) return anyOf[0];
  return nullable ? { anyOf: [...anyOf, { type: "null" }] } : { anyOf };
}

function dedupe(schemas: JsonSchema[]): JsonSchema[] {
  const seen = new Set<string>();
  const out: JsonSchema[] = [];
  for (const schema of schemas) {
    const key = JSON.stringify(schema);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(schema);
  }
  return out;
}
