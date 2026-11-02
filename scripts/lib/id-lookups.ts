// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Where a caller gets the value of an id input. `quality_createIssue` takes a
 * `nonConformanceTypeId`; its schema says only "string". This pass finds the
 * table the id belongs to and the READ operation that lists that table
 * (`quality_getIssueTypesList`), and says so on the field. Nothing is guessed:
 * a field whose table, or whose list, is not certain gets no lookup.
 *
 * The id's table, first rule that settles it:
 * - `id` / `ids`: the only table the operation touches;
 * - otherwise a foreign key on a table the operation touches (generated DB
 *   types), then the only table any foreign key of that column name points at,
 *   then a table named after the field (`salesInvoiceId` → `salesInvoice`).
 *
 * The operation's tables are read syntactically (`queriedRelations`): resolving
 * calls through the type checker took the manifest build past its heap.
 *
 * The lookup: a list READ whose every queried relation is that table, or a view
 * whose `id` IS that table's id (read from the view's SQL with the Postgres
 * parser), and that does not itself need an id of the table.
 */

import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import type { ManifestEntry } from "@carbon/api";
import { parse } from "libpg-query";
import {
  getDbForeignKeys,
  getDbRelationNames,
  getDbTableTypeFields
} from "./db-types";
import { queriedRelations, runOf } from "./service-ast";
import type { ServiceFnLeaf } from "./service-fn-metadata";

const MIGRATIONS = path.resolve(
  __dirname,
  "../../packages/database/supabase/migrations"
);

// biome-ignore lint/suspicious/noExplicitAny: libpg-query's AST is untyped JSON
type Ast = any;

const VIEW_DEFINITION =
  /create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?(?:"?public"?\.)?"?(\w+)"?/gi;

/** The newest migration that (re)defines each view. Files sort by timestamp. */
function newestViewMigrations(views: Set<string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(path.join(MIGRATIONS, file), "utf8");
    for (const match of sql.matchAll(VIEW_DEFINITION)) {
      if (views.has(match[1]!)) out.set(match[1]!, file);
    }
  }
  return out;
}

interface Source {
  name: string;
  relation: string;
}

/** The plain relations of a FROM clause, through joins; subqueries are skipped. */
function fromSources(from: Ast[] | undefined, out: Source[] = []): Source[] {
  for (const item of from ?? []) {
    if (item.RangeVar) {
      const relation = item.RangeVar.relname as string;
      out.push({ name: item.RangeVar.alias?.aliasname ?? relation, relation });
    } else if (item.JoinExpr) {
      fromSources([item.JoinExpr.larg, item.JoinExpr.rarg], out);
    }
  }
  return out;
}

/**
 * The relation a view's `id` column comes from: `ncr.*` or `i."id"` resolved
 * through the FROM clause, and through a CTE (`WITH latest AS (SELECT i.* FROM
 * item i) SELECT latest.* …`). Undefined for a set operation, an expression or
 * anything else not plainly one relation's id.
 */
function idSource(
  select: Ast,
  hasId: (relation: string) => boolean,
  outer: Map<string, Ast> = new Map()
): string | undefined {
  if (!select || (select.op && select.op !== "SETOP_NONE")) return undefined;
  const ctes = new Map(outer);
  for (const cte of select.withClause?.ctes ?? []) {
    const { ctename, ctequery } = cte.CommonTableExpr ?? {};
    if (ctename) ctes.set(ctename, ctequery?.SelectStmt);
  }
  const relationOf = (relation: string) =>
    ctes.has(relation) ? idSource(ctes.get(relation), hasId, ctes) : relation;
  const sources = fromSources(select.fromClause).map((s) => ({
    ...s,
    relation: relationOf(s.relation)
  }));
  const sourceOf = (qualifier: string | undefined) =>
    qualifier
      ? sources.find((s) => s.name === qualifier)
      : sources.length === 1
        ? sources[0]
        : undefined;

  for (const target of select.targetList ?? []) {
    const result = target.ResTarget;
    const fields: Ast[] | undefined = result?.val?.ColumnRef?.fields;
    if (!fields) {
      if (result?.name === "id") return undefined;
      continue;
    }
    const star = Boolean(fields[fields.length - 1]?.A_Star);
    const column = fields[fields.length - 1]?.String?.sval as string | undefined;
    const qualifier =
      fields.length > 1 ? (fields[0]?.String?.sval as string | undefined) : undefined;
    const named = result.name ?? column;
    if (!star && named !== "id") continue;
    if (!star && column !== "id") return undefined;
    const source = sourceOf(qualifier);
    if (star && !(source?.relation && hasId(source.relation))) continue;
    return source?.relation;
  }
  return undefined;
}

/**
 * View → the table its `id` is. A view built on another view follows it down;
 * a view whose SQL does not parse, or whose id is not one table's, is absent.
 */
export async function viewBaseTables(
  tables: Set<string>,
  views: Set<string>,
  /** SQL holding the view definitions; by default each view's newest migration. */
  sources: string[] = [...new Set(newestViewMigrations(views).values())].sort().map((file) =>
    readFileSync(path.join(MIGRATIONS, file), "utf8")
  ),
  tableHasId: (table: string) => boolean = (table) =>
    Boolean(getDbTableTypeFields(table, "Row")?.some((f) => f.name === "id"))
): Promise<Map<string, string>> {
  // Sources run oldest first, so a later definition of a view replaces an earlier one.
  const definitions = new Map<string, Ast>();
  for (const sql of sources) {
    let tree: Ast;
    try {
      tree = await parse(sql);
    } catch {
      continue;
    }
    for (const { stmt } of tree.stmts ?? []) {
      const view = stmt.ViewStmt?.view?.relname ?? stmt.CreateTableAsStmt?.into?.rel?.relname;
      const query = stmt.ViewStmt?.query ?? stmt.CreateTableAsStmt?.query;
      if (view && views.has(view)) definitions.set(view, query?.SelectStmt);
    }
  }

  const out = new Map<string, string>();
  const resolving = new Set<string>();
  const baseOf = (relation: string): string | undefined => {
    if (tables.has(relation)) return relation;
    if (out.has(relation)) return out.get(relation);
    if (!definitions.has(relation) || resolving.has(relation)) return undefined;
    resolving.add(relation);
    const hasId = (r: string) => (tables.has(r) ? tableHasId(r) : baseOf(r) !== undefined);
    const source = idSource(definitions.get(relation), hasId);
    const base = source ? baseOf(source) : undefined;
    resolving.delete(relation);
    if (base) out.set(relation, base);
    return base;
  };
  for (const view of views) baseOf(view);
  return out;
}

type Schema = {
  type?: string | string[];
  items?: Schema;
  description?: string;
  properties?: Record<string, Schema>;
  required?: string[];
};

const types = (s: Schema | undefined) => [s?.type ?? []].flat();

/** An id input: a string, or a list of strings, named `id`/`…Id`/`…Ids`. */
function isIdField(name: string, schema: Schema): boolean {
  if (!/(^ids?$|Ids?$)/.test(name)) return false;
  return types(schema).includes("string") ||
    (types(schema).includes("array") && types(schema.items).includes("string"));
}

export interface LookupInputs {
  tools: ManifestEntry[];
  /** Each tool's run, as router leaves; matched to tools by name. */
  leaves: ServiceFnLeaf[];
  tables: Set<string>;
  /** View → the table its id is. */
  viewBases: Map<string, string>;
  foreignKeys: Map<string, Map<string, Set<string>>>;
}

/** Tool name → field → the operations that list that field's ids. */
export function resolveIdLookups({
  tools,
  leaves,
  tables,
  viewBases,
  foreignKeys
}: LookupInputs): Map<string, Map<string, string[]>> {
  const baseOf = (relation: string) =>
    tables.has(relation) ? relation : viewBases.get(relation);
  const only = <T>(values: Iterable<T | undefined>): T | undefined => {
    const set = new Set([...values].filter((v): v is T => v !== undefined));
    return set.size === 1 ? [...set][0] : undefined;
  };
  const globalKeys = new Map<string, Set<string>>();
  for (const columns of foreignKeys.values()) {
    for (const [column, targets] of columns) {
      const all = globalKeys.get(column) ?? new Set<string>();
      for (const t of targets) all.add(t);
      globalKeys.set(column, all);
    }
  }

  const runs = new Map(leaves.map((leaf) => [leaf.path.join("_"), runOf(leaf.call)]));
  // Tool → field → the table its id belongs to.
  const fieldTables = new Map<string, Map<string, string>>();
  const touched = new Map<string, Set<string>>();
  const relationsOf = new Map<string, Set<string>>();
  for (const tool of tools) {
    const run = runs.get(tool.name);
    const relations = run ? queriedRelations(run) : new Set<string>();
    relationsOf.set(tool.name, relations);
    touched.set(
      tool.name,
      new Set([...relations].map(baseOf).filter((t): t is string => t !== undefined))
    );
    // A relation the base table map cannot place makes the tool's reads unknown.
    if ([...relations].some((r) => !baseOf(r))) touched.get(tool.name)!.add("?");
    const own = touched.get(tool.name)!;
    const properties = (tool.schema as Schema).properties ?? {};
    const fields = new Map<string, string>();
    for (const [name, schema] of Object.entries(properties)) {
      if (!isIdField(name, schema)) continue;
      const column = name.replace(/Ids$/, "Id");
      const named = column.replace(/Id$/, "");
      const table = /^ids?$/.test(name)
        ? own.size === 1 && !own.has("?")
          ? [...own][0]
          : undefined
        : (only([...own].flatMap((t) => [...(foreignKeys.get(t)?.get(column) ?? [])])) ??
          only(globalKeys.get(column) ?? []) ??
          (tables.has(named) ? named : undefined));
      if (table) fields.set(name, table);
    }
    fieldTables.set(tool.name, fields);
  }

  // Table → the list READs that return its rows, with the relation they read.
  const listsOf = new Map<string, { tool: ManifestEntry; via: string }[]>();
  for (const tool of tools) {
    if (tool.classification !== "READ") continue;
    const response = tool.responseSchema as Schema | undefined;
    const row = types(response).includes("array") ? response?.items : undefined;
    if (!row?.properties?.id) continue;
    const reads = touched.get(tool.name)!;
    if (reads.size !== 1 || reads.has("?")) continue;
    const table = [...reads][0]!;
    const required = (tool.schema as Schema).required ?? [];
    if (required.some((field) => fieldTables.get(tool.name)?.get(field) === table)) continue;
    const via = [...relationsOf.get(tool.name)!].sort().join(",");
    listsOf.set(table, [...(listsOf.get(table) ?? []), { tool, via }]);
  }
  // Fewest required inputs, then a `…List` (id and name, made for picking),
  // then a paged list, then the shortest name.
  const rank = (tool: ManifestEntry) => [
    ((tool.schema as Schema).required ?? []).length,
    tool.name.endsWith("List") ? 0 : 1,
    tool.paginates ? 0 : 1,
    tool.name.length
  ];
  const compare = (a: ManifestEntry, b: ManifestEntry) => {
    const [x, y] = [rank(a), rank(b)];
    const i = x.findIndex((v, k) => v !== y[k]);
    return i < 0 ? a.name.localeCompare(b.name) : x[i]! - y[i]!;
  };
  /**
   * The best list of the table. When the best tier holds lists of different
   * views of it — items come as `parts`, `materials`, `tools` — each is named:
   * any one alone would send a caller with a material's id to the parts.
   */
  const best = (table: string, self: string): string[] => {
    const candidates = (listsOf.get(table) ?? [])
      .filter(({ tool }) => tool.name !== self)
      .sort((a, b) => compare(a.tool, b.tool));
    const top = candidates[0];
    if (!top) return [];
    const tier = rank(top.tool).slice(0, 2).join();
    const picked = new Map<string, string>();
    for (const { tool, via } of candidates) {
      if (rank(tool).slice(0, 2).join() !== tier) break;
      if (!picked.has(via)) picked.set(via, tool.name);
    }
    return [...picked.values()];
  };

  const out = new Map<string, Map<string, string[]>>();
  for (const [toolName, fields] of fieldTables) {
    const lookups = new Map<string, string[]>();
    for (const [field, table] of fields) {
      const lookup = best(table, toolName);
      if (lookup.length > 0) lookups.set(field, lookup);
    }
    if (lookups.size > 0) out.set(toolName, lookups);
  }
  return out;
}

/** The sentence a looked-up field's description carries. */
export function lookupSentence(lookups: string[]): string {
  const names =
    lookups.length > 1
      ? `${lookups.slice(0, -1).join(", ")} or ${lookups[lookups.length - 1]}`
      : lookups[0];
  return `Ids come from ${names}.`;
}

/** Writes each lookup onto its tool: `lookups`, and a sentence on the field. */
export async function linkIdLookups(
  tools: ManifestEntry[],
  leaves: ServiceFnLeaf[]
): Promise<void> {
  const tables = getDbRelationNames("Tables");
  const viewBases = await viewBaseTables(tables, getDbRelationNames("Views"));
  const resolved = resolveIdLookups({
    tools,
    leaves,
    tables,
    viewBases,
    foreignKeys: getDbForeignKeys()
  });
  for (const tool of tools) {
    const lookups = resolved.get(tool.name);
    if (!lookups) continue;
    const properties = (tool.schema as Schema).properties!;
    for (const [field, lookup] of lookups) {
      const property = properties[field]!;
      const text = property.description?.trim();
      const sentence = lookupSentence(lookup);
      property.description = text
        ? `${/[.!?]$/.test(text) ? text : `${text}.`} ${sentence}`
        : sentence;
    }
    tool.lookups = Object.fromEntries(lookups);
  }
}
