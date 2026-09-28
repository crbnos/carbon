// Guards for the API side of the form bridge (see
// app/routes/api+/v1+/lib/field-coercers.server.ts). Every write route runs
// its form validator and hands the service the OUTPUT; the manifest publishes
// the INPUT. These scan the generated manifest, the service sources and the
// generated DB types, and fail on the two ways that gap reopened:
//
//   1. A published `default` on a tool that can update a row. Input
//      validation materialises it, so a partial update overwrote the stored
//      value (a customer's `taxExempt` flipped to false).
//   2. A property published as a plain string that lands in a json column
//      with no coercer. The service stores the string scalar and every reader
//      that expects a tiptap document or an array breaks.
//   3. A published property the service spreads straight into a table that
//      has no such column (PGRST204 for any caller who sends it).
//   4. A create path that inserts a readable document number (`paymentId`,
//      `memoId`, …) it neither allocates nor requires. The UI route allocated
//      it before calling; an API caller got a NOT NULL violation.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import toolMetadataJson from "../app/routes/api+/mcp+/lib/tool-metadata.json";

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULES_DIR = join(HERE, "../app/modules");
const DB_TYPES = join(HERE, "../../../packages/database/src/types.ts");

interface Tool {
  name: string;
  module: string;
  serviceParams: string[];
  classification: "READ" | "WRITE" | "DESTRUCTIVE";
  schema: { properties?: Record<string, Record<string, unknown>> };
  coercers?: Array<{ at: string[] }>;
  createDefaults?: Record<string, unknown>;
}

const tools = (toolMetadataJson as unknown as { tools: Tool[] }).tools;
const writeTools = tools.filter((t) => t.classification !== "READ");

/**
 * Json columns fed from a string on purpose, with the reason. Keep this list
 * short: every entry is a place the service, not the dispatch bridge, turns
 * the string into structure.
 */
const STRING_INTO_JSON_ALLOWED: Record<string, string> = {
  "resources_upsertTrainingQuestion.matchingPairs":
    "the service parses the JSON text, as the question routes did (the validator's refine reads the raw string)"
};

function isUpdateCapable(tool: Tool): boolean {
  const fn = tool.name.slice(tool.module.length + 1);
  return (
    Boolean(tool.schema.properties?._operation) || /^(update|upsert)/.test(fn)
  );
}

/** Paths of `default` keywords reachable through `properties` chains only. */
function propertyDefaults(
  node: Record<string, unknown>,
  path: string[] = []
): string[] {
  const properties = node.properties as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (!properties) return [];
  return Object.entries(properties).flatMap(([key, prop]) => [
    ...(prop && "default" in prop ? [[...path, key].join(".")] : []),
    ...(prop ? propertyDefaults(prop, [...path, key]) : [])
  ]);
}

const sourceCache = new Map<string, string>();
function serviceSource(module: string): string {
  const cached = sourceCache.get(module);
  if (cached !== undefined) return cached;
  const dir = join(MODULES_DIR, module);
  const joined = readdirSync(dir)
    .filter((f) => f.endsWith(".service.ts") || f.endsWith(".mcp.server.ts"))
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");
  sourceCache.set(module, joined);
  return joined;
}

function functionBody(source: string, fn: string): string {
  const match = new RegExp(
    `export\\s+(?:async\\s+)?function\\s+${fn}\\s*[<(]`
  ).exec(source);
  if (!match) return "";
  const next = source.indexOf("\nexport ", match.index + match[0].length);
  return source.slice(match.index, next === -1 ? undefined : next);
}

function publicTablesBlock(): string {
  const types = readFileSync(DB_TYPES, "utf8");
  const publicStart = types.indexOf("\n  public: {");
  const tablesStart = types.indexOf("\n    Tables: {", publicStart);
  const viewsStart = types.indexOf("\n    Views: {", tablesStart);
  return types.slice(tablesStart, viewsStart);
}

/**
 * table → its readable-number column, for every table whose Insert type
 * requires a `<table>Id` string (purchaseOrder.purchaseOrderId, …), plus
 * memo, whose number is drawn from the creditMemo/debitMemo sequences.
 */
function readableIdColumns(): Map<string, string> {
  const out = new Map<string, string>([["memo", "memoId"]]);
  for (const table of publicTablesBlock().matchAll(
    /\n {6}(\w+): \{\n {8}Row: \{[\s\S]*?\n {8}Insert: \{([\s\S]*?)\n {8}\}/g
  )) {
    const column = `${table[1]}Id`;
    if (new RegExp(`\\n {10}${column}: string\\b`).test(table[2])) {
      out.set(table[1], column);
    }
  }
  return out;
}

/** table → every Row column, from the generated public schema. */
function columnsByTable(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const table of publicTablesBlock().matchAll(
    /\n {6}(\w+): \{\n {8}Row: \{([\s\S]*?)\n {8}\}/g
  )) {
    out.set(
      table[1],
      new Set([...table[2].matchAll(/\n {10}(\w+)\??:/g)].map((m) => m[1]))
    );
  }
  return out;
}

/** Every property name listed in any `required` array of a schema. */
function requiredAnywhere(node: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    for (const item of node) requiredAnywhere(item, out);
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "required" && Array.isArray(value)) {
        for (const name of value) out.add(String(name));
      } else {
        requiredAnywhere(value, out);
      }
    }
  }
  return out;
}

/** table → its Json-typed Row columns, from the generated public schema. */
function jsonColumnsByTable(): Map<string, Set<string>> {
  const block = publicTablesBlock();
  const out = new Map<string, Set<string>>();
  for (const table of block.matchAll(
    /\n {6}(\w+): \{\n {8}Row: \{([\s\S]*?)\n {8}\}/g
  )) {
    const columns = [...table[2].matchAll(/\n {10}(\w+)\??: Json\b/g)].map(
      (m) => m[1]
    );
    out.set(table[1], new Set(columns));
  }
  return out;
}

/** Tables a service body writes, through supabase-js or Kysely. */
function writtenTables(body: string): Set<string> {
  return new Set(
    [
      ...body.matchAll(
        /\.from\("(\w+)"\)\s*\.(?:insert|update|upsert)\b|\.(?:insertInto|updateTable)\("(\w+)"\)/g
      )
    ].map((m) => m[1] ?? m[2])
  );
}

/**
 * Identifiers assigned to a json column under the column's name —
 * `internalNotes: input.notes ?? null`, `{ externalNotes: notes }`. A value the
 * service itself converts (`toTiptapDoc(…)`, `JSON.parse(…)`) is not counted.
 */
function renamedJsonTargets(
  body: string,
  jsonColumns: Set<string>
): Set<string> {
  const out = new Set<string>();
  for (const column of jsonColumns) {
    for (const m of body.matchAll(
      new RegExp(`\\b${column}\\s*:\\s*([^,\\n}]+)`, "g")
    )) {
      const expr = m[1];
      if (/toTiptapDoc|JSON\.parse|JSON\.stringify/.test(expr)) continue;
      const ref = /^\s*(?:\w+\.)?(\w+)\b/.exec(expr);
      if (ref && ref[1] !== column) out.add(ref[1]);
    }
  }
  return out;
}

function isStringSchema(prop: Record<string, unknown>): boolean {
  const type = prop.type;
  return (
    type === "string" ||
    (Array.isArray(type) &&
      type.includes("string") &&
      type.every((x) => x === "string" || x === "null"))
  );
}

/** Top-level properties, plus those one level under a payload published under
 *  its own param name (`{ contact: { … } }`), keyed by dotted path. */
function publishedProperties(
  t: Tool
): Array<[string, Record<string, unknown>]> {
  const out: Array<[string, Record<string, unknown>]> = [];
  for (const [key, prop] of Object.entries(t.schema.properties ?? {})) {
    out.push([key, prop]);
    const nested = prop.properties as
      | Record<string, Record<string, unknown>>
      | undefined;
    if (prop.type === "object" && nested) {
      for (const [inner, child] of Object.entries(nested)) {
        out.push([`${key}.${inner}`, child]);
      }
    }
  }
  return out;
}

describe("form bridge guards", () => {
  it("no update-capable tool publishes a JSON Schema default", () => {
    const offenders = writeTools
      .filter(isUpdateCapable)
      .flatMap((t) => propertyDefaults(t.schema).map((p) => `${t.name}.${p}`));
    expect(offenders).toEqual([]);
  });

  it("create defaults are only recorded for tools with a create path", () => {
    for (const t of tools.filter((t) => t.createDefaults)) {
      const fn = t.name.slice(t.module.length + 1);
      expect(
        Boolean(t.schema.properties?._operation) || fn.startsWith("upsert"),
        t.name
      ).toBe(true);
    }
  });

  it("no published schema leaks the internal coerce marker", () => {
    expect(JSON.stringify(tools).includes("x-carbon-coerce")).toBe(false);
  });

  it("no string property lands in a json column without a coercer", () => {
    const jsonColumns = jsonColumnsByTable();
    expect(jsonColumns.size).toBeGreaterThan(100);

    const offenders: string[] = [];
    for (const t of writeTools) {
      const fn = t.name.slice(t.module.length + 1);
      const body = functionBody(serviceSource(t.module), fn);
      const written = writtenTables(body);
      const writtenJson = new Set(
        [...written].flatMap((table) => [...(jsonColumns.get(table) ?? [])])
      );
      const coerced = new Set((t.coercers ?? []).map((c) => c.at.join(".")));
      // `notes` published, `internalNotes: input.notes` written: the json
      // columns each published key reaches under another name.
      const renamedInto = renamedJsonTargets(body, writtenJson);
      for (const [path, prop] of publishedProperties(t)) {
        if (!isStringSchema(prop) || coerced.has(path)) continue;
        const key = path.split(".").at(-1) as string;
        const intoJson = writtenJson.has(key) || renamedInto.has(key);
        if (!intoJson) continue;
        const id = `${t.name}.${path}`;
        if (!(id in STRING_INTO_JSON_ALLOWED)) offenders.push(id);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the string-into-json guard sees renamed and Kysely writes", () => {
    const body = `export async function f(client, db, input) {
      const { notes, ...rest } = input;
      await db.insertInto("quote").values({ internalNotes: input.notes ?? null });
      await client.from("quote").update({ ...(notes !== undefined && { externalNotes: notes }) });
    }`;
    expect([...writtenTables(body)]).toEqual(["quote"]);
    expect([
      ...renamedJsonTargets(body, new Set(["internalNotes", "externalNotes"]))
    ]).toEqual(["notes"]);
    expect(
      renamedJsonTargets(
        "{ internalNotes: toTiptapDoc(input.notes) }",
        new Set(["internalNotes"])
      ).size
    ).toBe(0);
  });

  it("every create path that inserts a readable number allocates or requires it", () => {
    const readable = readableIdColumns();
    expect(readable.get("purchaseOrder")).toBe("purchaseOrderId");

    const offenders: string[] = [];
    for (const t of writeTools) {
      const fn = t.name.slice(t.module.length + 1);
      const body = functionBody(serviceSource(t.module), fn);
      const allocates =
        /get_next_sequence|getNextSequence|getOrAllocateReadableId|functions\.invoke\(\s*"create"/.test(
          body
        );
      if (allocates) continue;
      const required = requiredAnywhere(t.schema);
      for (const [table, column] of readable) {
        const inserts = new RegExp(
          `\\.from\\("${table}"\\)\\s*\\.(?:insert|upsert)\\b|insertInto\\("${table}"\\)`
        ).test(body);
        if (inserts && !required.has(column)) {
          offenders.push(`${t.name} → ${table}.${column}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no published property is spread into a table that lacks the column", () => {
    const columns = columnsByTable();
    const injected = new Set([
      "_operation",
      "id",
      "companyId",
      "companyGroupId",
      "createdBy",
      "updatedBy",
      "userId"
    ]);
    const offenders: string[] = [];
    for (const t of writeTools) {
      const payload = t.serviceParams.filter(
        (p) =>
          !["client", "db", "userId", "companyId", "companyGroupId", "args"].includes(p)
      );
      if (payload.length !== 1) continue;
      const param = payload[0];
      const body = functionBody(
        serviceSource(t.module),
        t.name.slice(t.module.length + 1)
      );
      // The whole payload object written as the row: `.update(sanitize(p))`,
      // `.insert([p])`, `.insert({ ...p, … })`.
      const spreadInto = new RegExp(
        `\\.from\\("(\\w+)"\\)\\s*\\.(?:update|insert|upsert)\\(\\s*(?:sanitize\\()?\\s*\\[?\\s*(?:\\{\\s*\\.\\.\\.(?:sanitize\\()?)?${param}\\s*[)\\],}]`,
        "g"
      );
      // A payload published under its own param name is checked one level down.
      const wrapper = t.schema.properties?.[param] as
        | { properties?: Record<string, unknown> }
        | undefined;
      const properties = Object.keys(
        (wrapper ? wrapper.properties : t.schema.properties) ?? {}
      );
      for (const [, table] of body.matchAll(spreadInto)) {
        const known = columns.get(table);
        if (!known) continue;
        for (const key of properties) {
          if (!injected.has(key) && !known.has(key)) {
            offenders.push(`${t.name}.${key} → ${table}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
