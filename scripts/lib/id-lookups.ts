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
 * - `id` / `ids`: the only table the operation reads, when all its reads are known;
 * - otherwise a foreign key on a table the operation touches (generated DB
 *   types); when its own tables are unknown, the only table any foreign key of
 *   that column name points at; then a table named after the field
 *   (`salesInvoiceId` → `salesInvoice`).
 *
 * The operation's reads are found syntactically (`queriedRelations`): resolving
 * calls through the type checker took the manifest build past its heap. An RPC,
 * raw SQL or a call the walk cannot follow makes them unknown.
 *
 * The lookup: a general list READ (paged, filterable, a `…List`, or scoped by a
 * parent) whose every read is that table, or a view whose `id` IS that table's
 * id (read from the view's SQL with the Postgres parser).
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
import { type QueriedRelations, queriedRelations, runOf } from "./service-ast";
import type { ServiceFnLeaf } from "./service-fn-metadata";

const MIGRATIONS = path.resolve(
  __dirname,
  "../../packages/database/supabase/migrations"
);

// biome-ignore lint/suspicious/noExplicitAny: libpg-query's AST is untyped JSON
type Ast = any;

export interface SqlSource {
  name: string;
  sql: string;
}

/** Every migration, oldest first. */
function migrations(): SqlSource[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(path.join(MIGRATIONS, name), "utf8") }));
}

/** `column = 'constant'` tests a view applies to the rows its id comes from. */
type Equalities = Map<string, string>;

interface IdSource {
  relation: string;
  equalities: Equalities;
}

interface Source {
  name: string;
  /** Undefined for a subquery, a function or anything else not a relation. */
  relation: string | undefined;
}

/** The FROM items of a select, through joins; a subquery or function has no relation. */
function fromSources(from: Ast[] | undefined, out: Source[] = []): Source[] {
  for (const item of from ?? []) {
    if (item.RangeVar) {
      const relation = item.RangeVar.relname as string;
      out.push({ name: item.RangeVar.alias?.aliasname ?? relation, relation });
    } else if (item.JoinExpr) {
      fromSources([item.JoinExpr.larg, item.JoinExpr.rarg], out);
    } else {
      const node = Object.values(item)[0] as Ast;
      out.push({ name: node?.alias?.aliasname ?? "", relation: undefined });
    }
  }
  return out;
}

/** The `col = 'text'` conjuncts of a WHERE clause. */
function equalitiesOf(where: Ast): Equalities {
  const out: Equalities = new Map();
  const conjuncts =
    where?.BoolExpr?.boolop === "AND_EXPR" ? where.BoolExpr.args : where ? [where] : [];
  for (const conjunct of conjuncts) {
    const expr = conjunct.A_Expr;
    if (expr?.kind !== "AEXPR_OP" || expr.name?.[0]?.String?.sval !== "=") continue;
    const fields = expr.lexpr?.ColumnRef?.fields;
    const column = fields?.[fields.length - 1]?.String?.sval;
    // `'Material'::"itemType"` is the same constant, cast.
    const value = (expr.rexpr?.TypeCast?.arg ?? expr.rexpr)?.A_Const?.sval?.sval;
    if (column && value !== undefined) out.set(column, value);
  }
  return out;
}

/**
 * Where a view's `id` column comes from: `ncr.*` or `i."id"` resolved through
 * the FROM clause, and through a CTE (`WITH latest AS (SELECT i.* FROM item i)
 * SELECT latest.* …`), with the `col = 'text'` filters on the way. Undefined
 * for a set operation, an expression, a subquery or anything else not plainly
 * one relation's id.
 */
function idSource(
  select: Ast,
  hasId: (relation: string) => boolean,
  outer: Map<string, Ast> = new Map()
): IdSource | undefined {
  if (!select || (select.op && select.op !== "SETOP_NONE")) return undefined;
  const ctes = new Map(outer);
  for (const cte of select.withClause?.ctes ?? []) {
    const { ctename, ctequery } = cte.CommonTableExpr ?? {};
    if (ctename) ctes.set(ctename, ctequery?.SelectStmt);
  }
  const own = equalitiesOf(select.whereClause);
  const sources = fromSources(select.fromClause).map((s) => {
    if (!s.relation || !ctes.has(s.relation)) {
      return { ...s, inner: s.relation ? { relation: s.relation, equalities: own } : undefined };
    }
    const inner = idSource(ctes.get(s.relation), hasId, ctes);
    return {
      ...s,
      inner: inner && {
        relation: inner.relation,
        equalities: new Map([...inner.equalities, ...own])
      }
    };
  });
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
    const source = sourceOf(qualifier)?.inner;
    if (star && !(source && hasId(source.relation))) continue;
    return source;
  }
  return undefined;
}

export interface ViewBase {
  table: string;
  /** `col = 'text'` filters on the table's rows: `type = 'Part'` for `parts`. */
  equalities: Equalities;
}

/**
 * View → the table its `id` is. A view built on another view follows it down;
 * a view whose SQL does not parse, or whose id is not one table's, is absent.
 */
export async function viewBaseTables(
  tables: Set<string>,
  views: Set<string>,
  /** SQL holding the view definitions, oldest first; by default every migration. */
  sources: SqlSource[] = migrations(),
  tableHasId: (table: string) => boolean = (table) =>
    Boolean(getDbTableTypeFields(table, "Row")?.some((f) => f.name === "id"))
): Promise<Map<string, ViewBase>> {
  // Parsed in order, so a later definition of a view replaces an earlier one.
  const definitions = new Map<string, Ast>();
  const unparsed: string[] = [];
  for (const { name, sql } of sources) {
    let tree: Ast;
    try {
      tree = await parse(sql);
    } catch {
      unparsed.push(name);
      continue;
    }
    for (const { stmt } of tree.stmts ?? []) {
      const rel = stmt.ViewStmt?.view ?? stmt.CreateTableAsStmt?.into?.rel;
      const query = stmt.ViewStmt?.query ?? stmt.CreateTableAsStmt?.query;
      const schema = rel?.schemaname ?? "public";
      if (rel?.relname && schema === "public" && views.has(rel.relname)) {
        definitions.set(rel.relname, query?.SelectStmt);
      }
    }
  }
  if (unparsed.length > 0) {
    console.warn(
      `id lookups: ${unparsed.length} migration(s) do not parse; views defined only there have no lookup: ${unparsed.join(", ")}`
    );
  }

  const out = new Map<string, ViewBase>();
  const resolving = new Set<string>();
  const baseOf = (relation: string): ViewBase | undefined => {
    if (tables.has(relation)) return { table: relation, equalities: new Map() };
    if (out.has(relation)) return out.get(relation);
    if (!definitions.has(relation) || resolving.has(relation)) return undefined;
    resolving.add(relation);
    const hasId = (r: string) => (tables.has(r) ? tableHasId(r) : baseOf(r) !== undefined);
    const source = idSource(definitions.get(relation), hasId);
    const below = source ? baseOf(source.relation) : undefined;
    resolving.delete(relation);
    if (!source || !below) return undefined;
    const base = {
      table: below.table,
      equalities: new Map([...below.equalities, ...source.equalities])
    };
    out.set(relation, base);
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
  viewBases: Map<string, ViewBase>;
  foreignKeys: Map<string, Map<string, Set<string>>>;
}

interface Reads extends QueriedRelations {
  /** The tables behind the relations (a view counts as its base table). */
  bases: Set<string>;
  /** Every row the operation reads comes from `bases`. */
  known: boolean;
}

interface ListCandidate {
  tool: ManifestEntry;
  /** The relations it reads, as one key: two lists of one view are one source. */
  via: string;
  /** The view's `col = 'text'` filters on the table, when it reads one view. */
  equalities: Equalities | undefined;
}

/** Fewest required inputs, then a `…List` (made for picking), then paged, then shortest. */
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
 * Whether lists are slices of one table on one column — `parts` (`type =
 * 'Part'`), `materials`, `tools` — so only all of them together cover it.
 */
function partitionsOneColumn(candidates: ListCandidate[]): boolean {
  const first = candidates[0]?.equalities;
  if (candidates.length < 2 || !first) return false;
  return [...first.keys()].some((column) => {
    const values = candidates.map((c) => c.equalities?.get(column));
    return values.every((v) => v !== undefined) && new Set(values).size === values.length;
  });
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
    tables.has(relation) ? relation : viewBases.get(relation)?.table;
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
  const readsOf = new Map<string, Reads>();
  // Tool → field → the table its id belongs to.
  const fieldTables = new Map<string, Map<string, string>>();
  for (const tool of tools) {
    const run = runs.get(tool.name);
    const read = run ? queriedRelations(run) : { relations: new Set<string>(), complete: false };
    const bases = new Set(
      [...read.relations].map(baseOf).filter((t): t is string => t !== undefined)
    );
    const known = read.complete && [...read.relations].every((r) => baseOf(r) !== undefined);
    readsOf.set(tool.name, { ...read, bases, known });

    const properties = (tool.schema as Schema).properties ?? {};
    const fields = new Map<string, string>();
    for (const [name, schema] of Object.entries(properties)) {
      if (!isIdField(name, schema)) continue;
      const column = name.replace(/Ids$/, "Id");
      const named = column.replace(/Id$/, "");
      const table = /^ids?$/.test(name)
        ? known && bases.size === 1
          ? [...bases][0]
          : undefined
        : (only([...bases].flatMap((t) => [...(foreignKeys.get(t)?.get(column) ?? [])])) ??
          // Another table's key of the same name says something only when this
          // operation's own tables cannot answer.
          (known && bases.size > 0 ? undefined : only(globalKeys.get(column) ?? [])) ??
          (tables.has(named) ? named : undefined));
      if (table) fields.set(name, table);
    }
    fieldTables.set(tool.name, fields);
  }

  // Table → the general lists of its rows. A list is general when it can
  // reach any row: paged or filterable, a `…List`, or scoped only by a parent
  // the table points at (`getJobOperations(jobId)`). A special-purpose list
  // (`getUnbatchedBatchableOperationCount`) is a subset and is no lookup.
  const listsOf = new Map<string, ListCandidate[]>();
  for (const tool of tools) {
    if (tool.classification !== "READ") continue;
    const response = tool.responseSchema as Schema | undefined;
    const row = types(response).includes("array") ? response?.items : undefined;
    if (!row?.properties?.id) continue;
    const read = readsOf.get(tool.name)!;
    if (!read.known || read.bases.size !== 1) continue;
    const table = [...read.bases][0]!;
    const schema = tool.schema as Schema;
    const required = schema.required ?? [];
    const parents = [...(foreignKeys.get(table)?.values() ?? [])];
    const scopedByParent =
      required.length > 0 &&
      required.every((field) => {
        const target = fieldTables.get(tool.name)?.get(field);
        return target !== undefined && target !== table && parents.some((p) => p.has(target));
      });
    const general =
      required.length > 0
        ? scopedByParent
        : tool.paginates || tool.name.endsWith("List") || Boolean(schema.properties?.filters);
    if (!general) continue;
    const relations = [...read.relations].sort();
    listsOf.set(table, [
      ...(listsOf.get(table) ?? []),
      {
        tool,
        via: relations.join(","),
        equalities: relations.length === 1 ? viewBases.get(relations[0]!)?.equalities : undefined
      }
    ]);
  }
  for (const candidates of listsOf.values()) candidates.sort((a, b) => compare(a.tool, b.tool));

  /**
   * The best list of the table, or every list of the best tier when they are
   * slices of it on one column: any one alone would send a caller with a
   * material's id to the parts.
   */
  const best = (table: string, self: string): string[] => {
    const candidates = (listsOf.get(table) ?? []).filter(({ tool }) => tool.name !== self);
    const top = candidates[0];
    if (!top) return [];
    const tier = rank(top.tool).slice(0, 2).join();
    const perSource = new Map<string, ListCandidate>();
    for (const candidate of candidates) {
      if (rank(candidate.tool).slice(0, 2).join() !== tier) break;
      if (!perSource.has(candidate.via)) perSource.set(candidate.via, candidate);
    }
    const slices = [...perSource.values()];
    return partitionsOneColumn(slices) ? slices.map((c) => c.tool.name) : [top.tool.name];
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
  return `See ${names}.`;
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
