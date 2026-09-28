/**
 * The identifier contract, as the manifest generator applies it and the guard
 * test checks it. The contract itself (which params key which entity, and
 * what the dispatcher resolves) lives in
 * `apps/erp/app/routes/api+/mcp+/lib/identifier-keys.ts`.
 *
 * Everything here reads service source TEXT: which column of which table a
 * param is compared against (`.from("job")…eq("id", jobId)`, Kysely
 * `.where("job.id", "=", jobId)`). It is a scan, not a type check, so it
 * reports what it can see and stays silent on shapes it cannot (RPC args,
 * values passed on to another function).
 */

import {
  describeIdentifierKey,
  IDENTIFIER_KEYS,
  identifierEntityFor,
  TOOL_IDENTIFIER_KEYS
} from "../../apps/erp/app/routes/api+/mcp+/lib/identifier-keys";
import { getDbRelations } from "./db-types";

export interface ParamFilter {
  /** The table or view the comparison runs against; null when not found. */
  table: string | null;
  column: string;
}

export type IdentifierFindingKind =
  /** A param named after a readable column that the contract does not cover. */
  | "unkeyed-readable-param"
  /** A keyed param the service compares against the READABLE column, so
   *  resolving it to the record id would break the call. */
  | "readable-compared"
  /** A param named after a column of the table it filters, but compared
   *  against that table's `id` — the name promises the column, the service
   *  wants the row id. */
  | "fk-named-row-id"
  /** A param named `id` that the service never compares against an `id`
   *  column — it is some other key under a name that promises the row id. */
  | "id-names-other-column"
  /** A list read whose rows omit the key the keyed tools of its table take. */
  | "list-omits-key";

export interface IdentifierFinding {
  tool: string;
  kind: IdentifierFindingKind;
  param?: string;
  detail: string;
}

interface ServiceParam {
  name: string;
  typeStr: string;
}

const SCALAR_STRING = /^string(\s*\|\s*(null|undefined))*$/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lastMatchBefore(
  body: string,
  index: number,
  pattern: RegExp
): string | null {
  let found: string | null = null;
  for (const m of body.matchAll(pattern)) {
    if ((m.index ?? 0) >= index) break;
    found = m[1];
  }
  return found;
}

/** Every column `param` is compared against in `body`, with its table. */
export function paramFilters(body: string, param: string): ParamFilter[] {
  const name = escapeRegExp(param);
  const filters: ParamFilter[] = [];
  const split = (column: string, table: string | null): ParamFilter => {
    const dot = column.lastIndexOf(".");
    return dot === -1
      ? { table, column }
      : { table: column.slice(0, dot), column: column.slice(dot + 1) };
  };

  // Supabase: .eq("col", param) / .in(...) / .neq(...) — the table is the
  // nearest `.from("t")` before it.
  const supabase = new RegExp(
    `\\.(?:eq|neq|in)\\(\\s*"([\\w.]+)"\\s*,\\s*(?<![\\w.])${name}(?![\\w.\\[])`,
    "g"
  );
  for (const m of body.matchAll(supabase)) {
    const table = lastMatchBefore(
      body,
      m.index ?? 0,
      /\.from\(\s*"(\w+)"\s*\)/g
    );
    filters.push(split(m[1], table));
  }

  // Kysely: .where("col", "=", param) — the table is the nearest
  // selectFrom/updateTable/deleteFrom before it, unless the column names one.
  const kysely = new RegExp(
    `\\.where\\(\\s*"([\\w.]+)"\\s*,\\s*"(?:=|in)"\\s*,\\s*(?<![\\w.])${name}(?![\\w.\\[])`,
    "g"
  );
  for (const m of body.matchAll(kysely)) {
    const table = lastMatchBefore(
      body,
      m.index ?? 0,
      /\.(?:selectFrom|updateTable|deleteFrom)\(\s*"(\w+)"/g
    );
    filters.push(split(m[1], table));
  }
  return filters;
}

/** Column names that are some entity's readable number. */
export function readableColumnUniverse(): Set<string> {
  const universe = new Set<string>();
  for (const [table, relation] of getDbRelations()) {
    if (relation.kind === "table" && relation.columns.includes(`${table}Id`)) {
      universe.add(`${table}Id`);
    }
  }
  for (const key of Object.values(IDENTIFIER_KEYS)) {
    for (const column of key.readable) universe.add(column);
  }
  return universe;
}

/** The table plus its conventional list view (`job` → `jobs`). */
function entitySources(entity: string): string[] {
  const table = IDENTIFIER_KEYS[entity].table;
  return [table, `${table}s`];
}

function readableColumnsOf(entity: string): string[] {
  const key = IDENTIFIER_KEYS[entity];
  // An id-only key still has a readable-looking column (`supplierPartId`).
  return key.readable.length > 0 ? key.readable : [`${entity}Id`];
}

/**
 * The entity an `id` param keys, when every `id` comparison it takes part in
 * runs against that one entity's table or list view (`deleteItem(id)` →
 * `.from("item").delete().eq("id", id)`).
 */
function entityKeyedById(filters: ParamFilter[]): string | null {
  const idFilters = filters.filter((f) => f.column === "id");
  if (idFilters.length === 0) return null;
  const candidates = Object.keys(IDENTIFIER_KEYS).filter((entity) =>
    idFilters.every(
      (f) => f.table !== null && entitySources(entity).includes(f.table)
    )
  );
  return candidates.length === 1 ? candidates[0] : null;
}

export interface IdentifierContract {
  keys: Record<string, string>;
  /** param → published description for keyed params. */
  descriptions: Record<string, string>;
  findings: IdentifierFinding[];
}

/**
 * The keyed params of one operation, and every contract violation its
 * signature and body show. `body` must already have comments stripped.
 */
export function deriveIdentifierContract(
  toolName: string,
  params: ServiceParam[],
  body: string,
  universe: Set<string> = readableColumnUniverse()
): IdentifierContract {
  const keys: Record<string, string> = {};
  const descriptions: Record<string, string> = {};
  const findings: IdentifierFinding[] = [];
  const relations = getDbRelations();
  const reviewed = TOOL_IDENTIFIER_KEYS[toolName] ?? {};

  for (const param of params) {
    if (!SCALAR_STRING.test(param.typeStr.trim())) continue;
    const filters = paramFilters(body, param.name);
    const entity =
      identifierEntityFor(toolName, param.name) ??
      (param.name === "id" ? entityKeyedById(filters) : null);

    if (entity) {
      const readable = readableColumnsOf(entity);
      const sources = entitySources(entity);
      const comparedReadable = filters.find(
        (f) =>
          f.table !== null &&
          sources.includes(f.table) &&
          readable.includes(f.column)
      );
      if (comparedReadable) {
        findings.push({
          tool: toolName,
          kind: "readable-compared",
          param: param.name,
          detail: `${param.name} is compared against ${comparedReadable.table}.${comparedReadable.column}, the readable column; the contract resolves it to the record id`
        });
        continue;
      }
      keys[param.name] = entity;
      descriptions[param.name] = describeIdentifierKey(entity);
    } else if (universe.has(param.name) && !(param.name in reviewed)) {
      const byDesign = filters.some((f) => f.column === param.name);
      if (!byDesign) {
        findings.push({
          tool: toolName,
          kind: "unkeyed-readable-param",
          param: param.name,
          detail: `${param.name} is the name of a readable column, and no entry in identifier-keys.ts says which entity's id it takes`
        });
      }
    }

    if (param.name === "id") {
      if (filters.length > 0 && !filters.some((f) => f.column === "id")) {
        const columns = [
          ...new Set(filters.map((f) => `${f.table ?? "?"}.${f.column}`))
        ];
        findings.push({
          tool: toolName,
          kind: "id-names-other-column",
          param: "id",
          detail: `id is compared only against ${columns.join(", ")}`
        });
      }
      continue;
    }

    const entitySourceTables = entity ? entitySources(entity) : [];
    for (const f of filters) {
      if (f.column !== "id" || f.table === null) continue;
      if (entitySourceTables.includes(f.table)) continue;
      const columns = relations.get(f.table)?.columns ?? [];
      if (columns.includes(param.name)) {
        findings.push({
          tool: toolName,
          kind: "fk-named-row-id",
          param: param.name,
          detail: `${param.name} is compared against ${f.table}.id, but ${f.table} also has a ${param.name} column`
        });
        break;
      }
    }
  }

  return { keys, descriptions, findings };
}

/** The table a READ operation lists from: the first `.from("t")` in its body. */
export function listSourceTable(body: string): string | null {
  return body.match(/\.from\(\s*"(\w+)"\s*\)/)?.[1] ?? null;
}

/** Tables some operation keys by `id` through one of its scalar params. */
export function idKeyedTables(
  operations: Array<{ name: string; params: ServiceParam[]; body: string }>
): Map<string, string[]> {
  const keyed = new Map<string, string[]>();
  for (const op of operations) {
    for (const param of op.params) {
      if (!SCALAR_STRING.test(param.typeStr.trim())) continue;
      for (const f of paramFilters(op.body, param.name)) {
        if (f.column !== "id" || f.table === null) continue;
        const tools = keyed.get(f.table) ?? [];
        if (!tools.includes(op.name)) tools.push(op.name);
        keyed.set(f.table, tools);
      }
    }
  }
  return keyed;
}

/**
 * A list read whose rows omit the key its table's keyed tools take. A row
 * carries the key as `id`, or as `<table>Id` when it is a projection of the
 * table (a join row naming the record it points at).
 */
export function listRowKeyFinding(
  toolName: string,
  body: string,
  rowProperties: string[],
  keyedTables: Map<string, string[]>
): IdentifierFinding | null {
  const table = listSourceTable(body);
  if (!table) return null;
  const keyedBy = keyedTables.get(table)?.filter((t) => t !== toolName);
  if (!keyedBy || keyedBy.length === 0) return null;
  if (rowProperties.includes("id") || rowProperties.includes(`${table}Id`)) {
    return null;
  }
  return {
    tool: toolName,
    kind: "list-omits-key",
    detail: `rows from ${table} carry no id, which ${keyedBy.slice(0, 3).join(", ")} take`
  };
}
