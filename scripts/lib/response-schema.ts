/**
 * Derives each operation's RESPONSE schema by reflecting the service function's
 * TypeScript return type.
 *
 * The input side comes from zod validators (`validator-to-json-schema.ts`), but
 * nothing declares a response — it is whatever the service returns. Most services
 * `return client.from(...).select(...)`, and supabase-js infers the SELECTED
 * columns from the select string, so the compiler already knows the exact row
 * shape. This reads it back out with ts-morph.
 *
 * Measured over all 1500 exported service functions: 1423 (95%) yield a non-trivial
 * schema, ~10s to walk. The manifest grows 1.3 -> 1.6 MB, and it is gitignored.
 */

import * as fs from "fs";
import * as path from "path";
import { Node, Project, type Type } from "ts-morph";
import {
  awaitedType,
  classifyResultType,
  isEnvelopeType,
  type ResultShapeReport
} from "./result-shape";

export type JsonSchema = Record<string, unknown>;

const ROOT = path.resolve(__dirname, "../..");
const ERP_ROOT = path.join(ROOT, "apps/erp");
const MODULES_DIR = path.join(ERP_ROOT, "app/modules");

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
 * Collections whose members are methods and symbol-keyed slots. Walking them
 * emitted the checker's per-program symbol ids (`__@toStringTag@75448`) as
 * property names, so an unrelated edit anywhere renumbered them and flipped the
 * tool's digest. The dispatcher serializes a Map to its entries array and a Set
 * to an array (`toWireValue`, the same rule the HTTP OpenAPI serializer
 * applies), so those two reflect to that wire shape; the weak collections
 * cannot be enumerated and stay opaque.
 */
const MAP_COLLECTIONS = new Set(["Map", "ReadonlyMap"]);
/** Marks a Map's entries-array schema; mirrored in `operations.server.ts`. */
export const MAP_ENTRIES_MARKER = "x-carbon-map-entries";
const SET_COLLECTIONS = new Set(["Set", "ReadonlySet"]);
const JSON_OPAQUE_COLLECTIONS = new Set(["WeakMap", "WeakSet"]);

/**
 * Peel the layers between the declared return type and the payload a caller sees:
 * `Promise<PostgrestSingleResponse<T>>`, a returned query builder, and the
 * hand-rolled `Promise<{ data: T | null; error }>` all reduce to `T`.
 *
 * This mirrors the dispatcher, which unwraps an ENVELOPE (`isEnvelopeType`, the
 * predicate the result classifier shares) to `data` plus an optional `count` — so
 * the schema describes what lands in the response's `data`, not the driver's
 * envelope. A `{ data, count }` read is a list here exactly as it is at runtime.
 */
export function unwrapResponseType(type: Type, at: Node): Type {
  let current = awaitedType(type, at);
  for (let i = 0; i < 5; i++) {
    const name =
      current.getSymbol()?.getName() ?? current.getAliasSymbol()?.getName();
    const args = current.getTypeArguments();

    if (/^Postgrest\w*Response$/.test(name ?? "") && args.length > 0) {
      current = args[0];
      continue;
    }

    // An envelope, or a union whose every member is one (the success/failure pair).
    const members = current.isUnion()
      ? current.getUnionTypes().filter((t) => !t.isNull() && !t.isUndefined())
      : [current];
    // `getProperty` on a union yields the union of the members' `data` types.
    const data = current.getProperty("data");
    if (data && members.length > 0 && members.every(isEnvelopeType)) {
      current = stripNullish(data.getTypeAtLocation(at));
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
  seen: ReadonlySet<string> = new Set()
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
      items: element ? typeToJsonSchema(element, at, depth + 1, seen) : {}
    };
  }

  if (type.isUnion()) return unionToJsonSchema(type, at, depth, seen);

  if (type.isObject()) {
    const symbolName = type.getSymbol()?.getName();
    if (symbolName && JSON_OPAQUE_COLLECTIONS.has(symbolName)) {
      return { type: "object" };
    }
    if (symbolName && MAP_COLLECTIONS.has(symbolName)) {
      const [key, value] = type.getTypeArguments();
      const members = dedupe(
        [key, value]
          .filter((t): t is Type => !!t)
          .map((t) => typeToJsonSchema(t, at, depth + 2, seen))
      );
      return {
        type: "array",
        description: "Map entries as [key, value] pairs",
        // A keyed result, not a list: `isListOperation` keeps it bare over HTTP.
        [MAP_ENTRIES_MARKER]: true,
        items: {
          type: "array",
          minItems: 2,
          maxItems: 2,
          items: members.length === 1 ? members[0] : { anyOf: members }
        }
      };
    }
    if (symbolName && SET_COLLECTIONS.has(symbolName)) {
      const [element] = type.getTypeArguments();
      return {
        type: "array",
        items: element ? typeToJsonSchema(element, at, depth + 1, seen) : {}
      };
    }

    const key = type.getText();
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
    if (indexValue) {
      return {
        type: "object",
        additionalProperties: typeToJsonSchema(
          indexValue,
          at,
          depth + 1,
          nextSeen
        )
      };
    }

    // Symbol-keyed members (`[Symbol.iterator]`, reported as `__@iterator@206`)
    // are dropped by JSON.stringify, and their names carry unstable checker ids.
    const properties = type
      .getProperties()
      .filter((property) => !property.getName().startsWith("__@"));
    if (properties.length === 0) return { type: "object" };
    if (properties.length > MAX_PROPERTIES) return { type: "object" };

    const shape: Record<string, unknown> = {};
    const required: string[] = [];
    for (const property of properties) {
      const propertyType = property.getTypeAtLocation(at);
      shape[property.getName()] = typeToJsonSchema(
        propertyType,
        at,
        depth + 1,
        nextSeen
      );
      if (!property.isOptional()) required.push(property.getName());
    }

    const out: JsonSchema = { type: "object", properties: shape };
    if (required.length > 0) out.required = required;
    return out;
  }

  return {};
}

function unionToJsonSchema(
  type: Type,
  at: Node,
  depth: number,
  seen: ReadonlySet<string>
): JsonSchema {
  const members = type.getUnionTypes();
  const concrete = members.filter((t) => !t.isNull() && !t.isUndefined());
  const nullable = concrete.length !== members.length;

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
    const inner = typeToJsonSchema(concrete[0], at, depth, seen);
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
    concrete.map((t) => typeToJsonSchema(t, at, depth + 1, seen))
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

export type ResultContract = ResultShapeReport;

export interface ResponseSchemaIndex {
  /** `{module}_{fn}` → response schema, absent when nothing useful was derived. */
  get(module: string, functionName: string): JsonSchema | null;
  /** `{module}_{fn}` → the declared result's shape and contract violations. */
  result(module: string, functionName: string): ResultContract | null;
  readonly stats: { functions: number; derived: number; empty: number };
}

function isUseful(schema: JsonSchema): boolean {
  const keys = Object.keys(schema);
  if (keys.length === 0) return false;
  // `{ type: "object" }` alone says nothing a reader can use — but the same shape
  // carrying `additionalProperties` is a typed map and does.
  return !(keys.length === 1 && schema.type === "object");
}

/**
 * Reflect every module's service functions once. Loading the TS project is the
 * expensive part (~4s), so it happens here and the result is a plain lookup the
 * synchronous manifest builder can consult.
 */
export function buildResponseSchemaIndex(
  modules: readonly string[]
): ResponseSchemaIndex {
  const project = new Project({
    tsConfigFilePath: path.join(ERP_ROOT, "tsconfig.json"),
    skipAddingFilesFromTsConfig: true
  });

  const sources = modules.flatMap((mod) =>
    [`${mod}.service.ts`, `${mod}.ee.service.ts`, `${mod}.mcp.server.ts`]
      .map((name) => ({ mod, file: path.join(MODULES_DIR, mod, name) }))
      .filter((entry) => fs.existsSync(entry.file))
      .map((entry) => ({ mod: entry.mod, source: project.addSourceFileAtPath(entry.file) }))
  );
  project.resolveSourceFileDependencies();

  const schemas = new Map<string, JsonSchema>();
  const results = new Map<string, ResultContract>();
  const stats = { functions: 0, derived: 0, empty: 0 };

  for (const { mod, source } of sources) {
    for (const fn of source.getFunctions()) {
      if (!fn.isExported()) continue;
      stats.functions++;
      try {
        results.set(
          `${mod}_${fn.getName()}`,
          classifyResultType(fn.getReturnType(), fn)
        );
      } catch (err) {
        results.set(`${mod}_${fn.getName()}`, {
          shape: "unknown",
          violations: [`result type could not be classified: ${String(err)}`],
          extras: []
        });
      }
      let schema: JsonSchema;
      try {
        schema = typeToJsonSchema(unwrapResponseType(fn.getReturnType(), fn), fn);
      } catch {
        stats.empty++;
        continue;
      }
      if (!isUseful(schema)) {
        stats.empty++;
        continue;
      }
      schemas.set(`${mod}_${fn.getName()}`, schema);
      stats.derived++;
    }
  }

  return {
    get(module, functionName) {
      return schemas.get(`${module}_${functionName}`) ?? null;
    },
    result(module, functionName) {
      return results.get(`${module}_${functionName}`) ?? null;
    },
    stats
  };
}
