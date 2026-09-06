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
 * Peel the layers between the declared return type and the payload a caller sees:
 * `Promise<PostgrestSingleResponse<T>>` and the hand-rolled
 * `Promise<{ data: T | null; error }>` both reduce to `T`.
 *
 * This mirrors `dispatch.server.ts`, which unwraps the Supabase result to `data`
 * plus an optional `count` before returning it — so the schema describes what lands
 * in the response's `data`, not the driver's envelope.
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
    const key = type.getText();
    // Cycle: the type is already being expanded further up this branch.
    if (seen.has(key)) return { type: "object" };

    const properties = type.getProperties();
    if (properties.length === 0) return { type: "object" };
    if (properties.length > MAX_PROPERTIES) return { type: "object" };

    const nextSeen = new Set(seen).add(key);
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

  const anyOf = concrete.map((t) => typeToJsonSchema(t, at, depth + 1, seen));
  return nullable ? { anyOf: [...anyOf, { type: "null" }] } : { anyOf };
}

export interface ResponseSchemaIndex {
  /** `{module}_{fn}` → response schema, absent when nothing useful was derived. */
  get(module: string, functionName: string): JsonSchema | null;
  readonly stats: { functions: number; derived: number; empty: number };
}

function isUseful(schema: JsonSchema): boolean {
  const keys = Object.keys(schema);
  if (keys.length === 0) return false;
  // `{ type: "object" }` with no properties says nothing a reader can use.
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
  const stats = { functions: 0, derived: 0, empty: 0 };

  for (const { mod, source } of sources) {
    for (const fn of source.getFunctions()) {
      if (!fn.isExported()) continue;
      stats.functions++;
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
    stats
  };
}
