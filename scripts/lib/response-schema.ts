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
import { Node, Project, type SourceFile, type Type } from "ts-morph";

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
  seen: ReadonlySet<string> = new Set(),
  opts: WalkOptions = {}
): JsonSchema {
  if (depth > MAX_DEPTH) return {};

  if (type.isString()) return { type: "string" };
  if (type.isNumber()) return { type: "number" };
  if (type.isBoolean()) return { type: "boolean" };
  if (opts.input) {
    // A request carries JSON, which has no undefined: an undefined member makes
    // the property optional (see `isOptionalProperty`), never a null value.
    if (type.isNull()) return { type: "null" };
    if (type.isUndefined()) return {};
    // `Json` is any JSON value. Expanding its recursive union publishes a
    // five-member anyOf that says nothing more than "any value".
    if (isJsonAlias(type)) return {};
    // Dates cross the wire as ISO strings.
    if (type.getSymbol()?.getName() === "Date") return { type: "string" };
  } else if (type.isNull() || type.isUndefined()) {
    return { type: "null" };
  }
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
        ? typeToJsonSchema(element, at, depth + 1, seen, opts)
        : {}
    };
  }

  // A fixed-length tuple (`[number, number, number]`) is an array of exactly
  // that many elements.
  if (opts.input && type.isTuple()) {
    const elements = dedupe(
      type
        .getTupleElements()
        .map((t) => typeToJsonSchema(t, at, depth + 1, seen, opts))
    );
    const length = type.getTupleElements().length;
    return {
      type: "array",
      items: elements.length === 1 ? elements[0] : { anyOf: elements },
      minItems: length,
      maxItems: length
    };
  }

  if (type.isUnion()) return unionToJsonSchema(type, at, depth, seen, opts);

  if (type.isObject()) {
    const symbolName = type.getSymbol()?.getName();
    if (symbolName && JSON_OPAQUE_COLLECTIONS.has(symbolName)) {
      return { type: "object" };
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
          nextSeen,
          opts
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
        nextSeen,
        opts
      );
      const optional = opts.input
        ? isOptionalProperty(property, propertyType)
        : property.isOptional();
      if (!optional) required.push(property.getName());
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
  seen: ReadonlySet<string>,
  opts: WalkOptions
): JsonSchema {
  const members = type.getUnionTypes();
  const concrete = members.filter((t) => !t.isNull() && !t.isUndefined());
  // Input side: only null makes a value nullable; undefined makes the
  // property optional and is handled by the caller.
  const nullable = opts.input
    ? members.some((t) => t.isNull())
    : concrete.length !== members.length;
  if (opts.input && isJsonAlias(type)) return {};
  if (opts.input && concrete.length === 0) {
    return nullable ? { type: "null" } : {};
  }

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
    const inner = typeToJsonSchema(concrete[0], at, depth, seen, opts);
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
    concrete.map((t) => typeToJsonSchema(t, at, depth + 1, seen, opts))
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

/** Walk options. `input` switches to request semantics (see `typeToJsonSchema`). */
export interface WalkOptions {
  /**
   * Describe a value a caller SENDS rather than one it receives: `undefined`
   * makes a property optional instead of nullable, `Date` is an ISO string, and
   * `Json` is left open.
   */
  input?: boolean;
}

/** The generated database `Json` type, alone or with null/undefined. */
export function isJsonAlias(type: Type): boolean {
  if (type.getAliasSymbol()?.getName() === "Json") return true;
  return /^(?:import\([^)]*\)\.)?Json(?: \| (?:null|undefined))*$/.test(
    type.getText()
  );
}

/** Does the type admit `undefined` (a `T | undefined` union, or bare undefined)? */
export function admitsUndefined(type: Type): boolean {
  // any/unknown say nothing about undefined; treating them as optional would
  // let a caller omit a value the service never checks for.
  if (type.isUndefined()) return true;
  return type.isUnion() && type.getUnionTypes().some((t) => t.isUndefined());
}

/** Input-side optionality: a `?` property, or one whose type admits undefined. */
export function isOptionalProperty(
  property: { isOptional(): boolean },
  propertyType: Type
): boolean {
  return property.isOptional() || admitsUndefined(propertyType);
}

export interface ResponseSchemaIndex {
  /** `{module}_{fn}` → response schema, absent when nothing useful was derived. */
  get(module: string, functionName: string): JsonSchema | null;
  readonly stats: { functions: number; derived: number; empty: number };
}

function isUseful(schema: JsonSchema): boolean {
  const keys = Object.keys(schema);
  if (keys.length === 0) return false;
  // `{ type: "object" }` alone says nothing a reader can use — but the same shape
  // carrying `additionalProperties` is a typed map and does.
  return !(keys.length === 1 && schema.type === "object");
}

/** One module's scanned source file, as loaded into the shared ts-morph project. */
export interface ServiceSource {
  mod: string;
  source: SourceFile;
}

/** The ts-morph project over every scanned service file, loaded once per run. */
export interface ServiceProject {
  project: Project;
  sources: ServiceSource[];
}

/**
 * Load every module's scanned service files (`.service.ts`, `.ee.service.ts`,
 * `.mcp.server.ts`) into one ts-morph project. Loading is the expensive part
 * (~4s), so the response and input reflections share one instance.
 */
export function loadServiceProject(modules: readonly string[]): ServiceProject {
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
  return { project, sources };
}

/**
 * Reflect every module's service functions once. The result is a plain lookup
 * the synchronous manifest builder can consult.
 */
export function buildResponseSchemaIndex(
  modules: readonly string[],
  loaded: ServiceProject = loadServiceProject(modules)
): ResponseSchemaIndex {
  const { sources } = loaded;

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
