import type { KyselyDatabase } from "@carbon/database/client";
import { type Kysely, type RawBuilder, sql } from "kysely";
import type { TableInfo } from "./schema";

/**
 * Company-scope SQL for backups: the per-table scope predicate, the export
 * closure guard (`findExportScopeViolations`), and the opt-in exclusion/purge
 * of rows whose NOT-NULL FK escapes that scope.
 *
 * Keep this module free of runtime `@carbon/*` imports (type-only is fine) —
 * the ERP reaches it through `@carbon/jobs/backups`, and bare-`tsx` scripts
 * cannot named-import CJS workspace packages.
 */

/** Run `fn` over `items` with at most `limit` in flight. */
export async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const item = items[next++];
        if (item === undefined) break;
        await fn(item);
      }
    }
  );
  await Promise.all(workers);
}

/**
 * FK targets a restore resolves WITHOUT the referenced row being in the backup:
 * `user` (global identity table, never in the catalog) and `company` (structural),
 * plus `employee` (collapsed to the importer) and `companyGroup` (re-stamped to the
 * target group). A FK to any of these can't be a closure gap.
 */
export const RETAINED_REF_TABLES = new Set([
  "user",
  "employee",
  "company",
  "companyGroup"
]);

/**
 * A SQL predicate scoping a table's rows to one company. For a directly-scoped
 * table it's `companyId = $`; for a `via` table it's
 * `fk IN (SELECT parent.refColumn FROM parent WHERE <parent's predicate>)`,
 * recursing to the scoped root. The subquery is NOT correlated (it lists the
 * parent's ids for the company), so it stays a cheap semi-join. `byName` must
 * hold every catalog table so parents resolve.
 */
export function buildScopeFilter(
  table: TableInfo,
  byName: Map<string, TableInfo>,
  companyId: string,
  companyGroupId: string | null
): RawBuilder<unknown> {
  if (table.scope.kind === "direct") {
    const value =
      table.scope.column === "companyGroupId" ? companyGroupId : companyId;
    return sql`${sql.id(table.scope.column)} = ${value}`;
  }
  const parent = byName.get(table.scope.parent);
  if (!parent) {
    throw new Error(
      `Scope parent "${table.scope.parent}" of "${table.name}" is not in the catalog`
    );
  }
  return sql`${sql.id(table.scope.column)} IN (SELECT ${sql.id(
    table.scope.refColumn
  )} FROM ${sql.id(table.scope.parent)} WHERE ${buildScopeFilter(
    parent,
    byName,
    companyId,
    companyGroupId
  )})`;
}

/** One FK edge whose rows escape the company's export scope. */
export type ScopeViolation = {
  table: string;
  column: string;
  refTable: string;
  rows: number;
};

/** The exact message the export has always refused with — quoted in prod logs and specs. */
export function formatScopeViolations(
  companyId: string,
  violations: ScopeViolation[]
): string {
  const lines = violations.map(
    (v) =>
      `${v.table}.${v.column} → ${v.refTable} (${v.rows} row${
        v.rows === 1 ? "" : "s"
      })`
  );
  return (
    `Refusing to export ${companyId}: ${violations.length} NOT-NULL reference(s) ` +
    `escape company scope, so the backup could never be restored:\n  ${lines.join(
      "\n  "
    )}`
  );
}

/**
 * Thrown by the export when the closure guard finds out-of-scope rows. Typed so
 * the jobs can record WHICH failure this was (and the offending edges) in their
 * marker, and the UI can offer the sanctioned recovery for exactly this case.
 */
export class ExportScopeViolationError extends Error {
  /** Per FK edge — the breakdown. Never summable into a row count. */
  readonly violations: ScopeViolation[];
  /** DISTINCT rows behind those edges, per table — what the user is told. */
  readonly rowsByTable: Array<{ table: string; rows: number }>;
  constructor(
    companyId: string,
    violations: ScopeViolation[],
    rowsByTable: Array<{ table: string; rows: number }> = []
  ) {
    super(formatScopeViolations(companyId, violations));
    this.name = "ExportScopeViolationError";
    this.violations = violations;
    this.rowsByTable = rowsByTable;
  }
}

/** A NOT-NULL FK from an exportable table to another exportable, non-retained table. */
export type ScopeEdge = { table: TableInfo; column: string; parent: TableInfo };

/**
 * The FK edges the closure guard, the exclusion and the purge all reason about —
 * ONE definition so the three can never disagree about what "escapes scope" means.
 * Skips nullable FKs (restore nulls a missing ref), refs to retained tables (user,
 * company, …) and refs to tables outside the export (global/secret → not in closure).
 */
export function scopeEdges(
  table: TableInfo,
  exportableNames: Set<string>,
  byName: Map<string, TableInfo>
): ScopeEdge[] {
  const colByName = new Map(table.columns.map((c) => [c.name, c]));
  const edges: ScopeEdge[] = [];
  for (const fk of table.foreignKeys) {
    if (fk.refColumn !== "id") continue;
    if (RETAINED_REF_TABLES.has(fk.refTable)) continue;
    if (!exportableNames.has(fk.refTable)) continue;
    const col = colByName.get(fk.column);
    if (!col || col.isNullable) continue;
    const parent = byName.get(fk.refTable);
    if (!parent) continue;
    edges.push({ table, column: fk.column, parent });
  }
  return edges;
}

/**
 * Where a parent row may legitimately live for a child in this company's scope.
 * A `companyId IS NULL` parent row is shared substrate (seeded `material*`,
 * currencies, …) present in every target — never a gap. A row owned by a
 * DIFFERENT company still surfaces.
 */
function parentExistence(
  parent: TableInfo,
  byName: Map<string, TableInfo>,
  companyId: string,
  companyGroupId: string | null
): RawBuilder<unknown> {
  const parentScope = buildScopeFilter(
    parent,
    byName,
    companyId,
    companyGroupId
  );
  return parent.scope.kind === "direct"
    ? sql`${parentScope} OR ${sql.id(parent.scope.column)} IS NULL`
    : parentScope;
}

/** `<col> IS NOT NULL AND <col> NOT IN (parent rows that exist for this company)` */
function violationTerm(
  edge: ScopeEdge,
  byName: Map<string, TableInfo>,
  companyId: string,
  companyGroupId: string | null
): RawBuilder<unknown> {
  return sql`(${sql.id(edge.column)} IS NOT NULL AND ${sql.id(
    edge.column
  )} NOT IN (SELECT ${sql.id("id")} FROM ${sql.id(
    edge.parent.name
  )} WHERE ${parentExistence(edge.parent, byName, companyId, companyGroupId)}))`;
}

/**
 * Export-time closure guard — refuse to PRODUCE a backup that could never be
 * restored. For each NOT-NULL FK from an exportable scoped table to another
 * exportable scoped table, count rows in this company's export scope whose
 * reference falls OUTSIDE the referenced table's export scope (the child row
 * would be dumped but its parent would not). DB-level and count-only. The
 * export mirror of the restore-side `assertReferentiallyClosed`.
 *
 * Callers format with `formatScopeViolations` or throw `ExportScopeViolationError`.
 */
export async function findExportScopeViolations(
  db: Kysely<KyselyDatabase>,
  exportable: TableInfo[],
  byName: Map<string, TableInfo>,
  companyId: string,
  companyGroupId: string | null
): Promise<ScopeViolation[]> {
  return (
    await findExportScopeViolationsDetailed(
      db,
      exportable,
      byName,
      companyId,
      companyGroupId
    )
  ).violations;
}

/**
 * The guard's full result: the per-edge breakdown AND the DISTINCT rows behind
 * it, per table. A row violating three of its FKs is three `violations` entries
 * but one row — only `rowsByTable` may be summed into a figure a person reads.
 */
export async function findExportScopeViolationsDetailed(
  db: Kysely<KyselyDatabase>,
  exportable: TableInfo[],
  byName: Map<string, TableInfo>,
  companyId: string,
  companyGroupId: string | null
): Promise<{
  violations: ScopeViolation[];
  rowsByTable: Array<{ table: string; rows: number }>;
}> {
  const exportableNames = new Set(exportable.map((t) => t.name));
  const checks: Array<{
    edge: ScopeEdge;
    query: RawBuilder<{ n: string }>;
  }> = [];
  for (const t of exportable) {
    const childScope = buildScopeFilter(t, byName, companyId, companyGroupId);
    for (const edge of scopeEdges(t, exportableNames, byName)) {
      checks.push({
        edge,
        query: sql<{ n: string }>`
          SELECT count(*)::text AS n
          FROM ${sql.id(t.name)}
          WHERE ${childScope}
            AND ${violationTerm(edge, byName, companyId, companyGroupId)}`
      });
    }
  }

  const violations: ScopeViolation[] = [];
  await mapWithConcurrency(checks, 6, async (c) => {
    const r = await c.query.execute(db);
    const n = Number(r.rows[0]?.n ?? 0);
    if (n > 0) {
      violations.push({
        table: c.edge.table.name,
        column: c.edge.column,
        refTable: c.edge.parent.name,
        rows: n
      });
    }
  });

  // One distinct-row count per offending table — the OR of its violating edges,
  // so a row counts once however many of its FKs escaped.
  const offending = [...new Set(violations.map((v) => v.table))];
  const rowsByTable: Array<{ table: string; rows: number }> = [];
  await mapWithConcurrency(offending, 6, async (name) => {
    const t = byName.get(name);
    if (!t) return;
    const edges = scopeEdges(t, exportableNames, byName).filter((e) =>
      violations.some((v) => v.table === name && v.column === e.column)
    );
    if (edges.length === 0) return;
    const anyEdge = sql.join(
      edges.map((e) => violationTerm(e, byName, companyId, companyGroupId)),
      sql` OR `
    );
    const r = await sql<{ n: string }>`
      SELECT count(*)::text AS n
      FROM ${sql.id(name)}
      WHERE ${buildScopeFilter(t, byName, companyId, companyGroupId)}
        AND (${anyEdge})`.execute(db);
    rowsByTable.push({ table: name, rows: Number(r.rows[0]?.n ?? 0) });
  });

  return { violations, rowsByTable };
}

export type ExclusionCause = "violation" | "cascade";

export type ExclusionTerm = {
  edge: ScopeEdge;
  cause: ExclusionCause;
  predicate: RawBuilder<unknown>;
};

/**
 * SQL predicate selecting the rows of `table` that must be EXCLUDED from an
 * export: a NOT-NULL FK escaping scope ("violation"), or pointing at a row
 * already excluded from its parent ("cascade" — `excludedIds` holds the parent
 * ids decided earlier, so callers must walk tables parents-first). `null` when
 * the table has no edge that could exclude anything.
 *
 * NOTE on "cascade": no corruption seen in production has exercised it. Both
 * known offenders are leaves — `pickMethod` has no `id` column and nothing
 * references `jobOperationDependency` — so neither can be a cascade PARENT. It
 * is kept because the restore-side closure preflight WOULD refuse a backup whose
 * excluded row still had children, which is a silent trap for the next
 * corruption shape; `scope.test.ts` pins the predicate it emits. Do not delete
 * it without making that preflight the thing that proves it unnecessary.
 */
export function buildExclusionPredicate(
  table: TableInfo,
  exportableNames: Set<string>,
  byName: Map<string, TableInfo>,
  companyId: string,
  companyGroupId: string | null,
  excludedIds: Map<string, unknown[]>
): { predicate: RawBuilder<unknown>; terms: ExclusionTerm[] } | null {
  const terms: ExclusionTerm[] = [];
  for (const edge of scopeEdges(table, exportableNames, byName)) {
    terms.push({
      edge,
      cause: "violation",
      predicate: violationTerm(edge, byName, companyId, companyGroupId)
    });
    const ids = excludedIds.get(edge.parent.name);
    if (ids && ids.length > 0) {
      terms.push({
        edge,
        cause: "cascade",
        predicate: sql`${sql.id(edge.column)} IN (${sql.join(
          ids.map((v) => sql`${v}`)
        )})`
      });
    }
  }
  if (terms.length === 0) return null;
  return {
    predicate: sql.join(
      terms.map((t) => t.predicate),
      sql` OR `
    ),
    terms
  };
}

export type ScopeExclusions = {
  /** table → predicate to `AND NOT (…)` into that table's dump. Only tables with something to exclude. */
  predicates: Map<string, RawBuilder<unknown>>;
  /** table → excluded `id`s (tables with an `id` column only), so children can cascade. */
  excludedIds: Map<string, unknown[]>;
  /**
   * What was excluded, per FK EDGE — the breakdown a support engineer reads.
   * NOT summable into a row count: one row violating three of its FKs appears
   * three times here (`jobOperationDependency` does exactly that). Use
   * {@link totalExcludedRows} over `perTable` for anything a user sees.
   */
  summary: Array<{
    table: string;
    column: string;
    refTable: string;
    rows: number;
    cause: ExclusionCause;
  }>;
  /** table → DISTINCT rows excluded. The only correct basis for a total. */
  perTable: Array<{ table: string; rows: number }>;
};

/**
 * The number of ROWS a skip/purge affects — the one figure a person is shown.
 * Counting `summary` instead double-counts every row that violates more than
 * one of its foreign keys.
 */
export function totalExcludedRows(
  perTable: Array<{ table: string; rows: number }>
): number {
  return perTable.reduce((sum, t) => sum + t.rows, 0);
}

/**
 * Decide which rows a `skipCorrupted` export leaves out. Walks `exportable` in
 * the given (catalog = topological) order so a parent's excluded ids are known
 * before its children are examined. DB-backed: one count per term plus one id
 * read per table that excludes anything.
 */
export async function computeScopeExclusions(
  db: Kysely<KyselyDatabase>,
  exportable: TableInfo[],
  byName: Map<string, TableInfo>,
  companyId: string,
  companyGroupId: string | null
): Promise<ScopeExclusions> {
  const exportableNames = new Set(exportable.map((t) => t.name));
  const predicates = new Map<string, RawBuilder<unknown>>();
  const excludedIds = new Map<string, unknown[]>();
  const summary: ScopeExclusions["summary"] = [];
  const perTable: ScopeExclusions["perTable"] = [];

  for (const table of exportable) {
    const built = buildExclusionPredicate(
      table,
      exportableNames,
      byName,
      companyId,
      companyGroupId,
      excludedIds
    );
    if (!built) continue;
    const scope = buildScopeFilter(table, byName, companyId, companyGroupId);

    let excludesAny = false;
    for (const term of built.terms) {
      const r = await sql<{ n: string }>`
        SELECT count(*)::text AS n
        FROM ${sql.id(table.name)}
        WHERE ${scope} AND ${term.predicate}`.execute(db);
      const n = Number(r.rows[0]?.n ?? 0);
      if (n === 0) continue;
      excludesAny = true;
      summary.push({
        table: table.name,
        column: term.edge.column,
        refTable: term.edge.parent.name,
        rows: n,
        cause: term.cause
      });
    }
    if (!excludesAny) continue;

    predicates.set(table.name, built.predicate);
    // One count over the WHOLE predicate: distinct rows, however many of their
    // FKs escaped scope. This is what the user is told and what the purge deletes.
    const distinct = await sql<{ n: string }>`
      SELECT count(*)::text AS n
      FROM ${sql.id(table.name)}
      WHERE ${scope} AND (${built.predicate})`.execute(db);
    perTable.push({
      table: table.name,
      rows: Number(distinct.rows[0]?.n ?? 0)
    });
    if (table.columns.some((c) => c.name === "id")) {
      const ids = await sql<{ id: unknown }>`
        SELECT ${sql.id("id")} AS id
        FROM ${sql.id(table.name)}
        WHERE ${scope} AND (${built.predicate})`.execute(db);
      if (ids.rows.length > 0) {
        excludedIds.set(
          table.name,
          ids.rows.map((r) => r.id)
        );
      }
    }
  }

  return { predicates, excludedIds, summary, perTable };
}

/**
 * Permanently DELETE the rows `computeScopeExclusions` would exclude. Call it
 * INSIDE a transaction the caller owns. Deletes children first (reverse
 * catalog order) so a `NO ACTION` FK never blocks a parent's delete, then
 * re-runs the closure guard and throws if anything is left — a purge that
 * leaves a violation behind must not commit.
 */
export async function purgeScopeViolations(
  trx: Kysely<KyselyDatabase>,
  exportable: TableInfo[],
  byName: Map<string, TableInfo>,
  companyId: string,
  companyGroupId: string | null
): Promise<{ deleted: Array<{ table: string; rows: number }> }> {
  const exclusions = await computeScopeExclusions(
    trx,
    exportable,
    byName,
    companyId,
    companyGroupId
  );

  // A `companyGroupId`-scoped row (chart of accounts, currencies, dimensions) is
  // shared with the sibling companies in the group, so deleting it reaches data
  // this company does not own — and the delete is irreversible. Refused
  // unconditionally rather than gated on the group having siblings today, since
  // one can be added later. Mirrors `resolveRestoreScope`, which is why a restore
  // refuses to touch group data unless the company is its group's only member.
  const shared = [...exclusions.predicates.keys()].filter(
    (name) => byName.get(name)?.scopeColumn === "companyGroupId"
  );
  if (shared.length > 0) {
    throw new Error(
      "These rows are shared with the other companies in this group, so " +
        "removing them would change their records too. They need to be " +
        `corrected directly (${shared.join(", ")}).`
    );
  }

  const deleted: Array<{ table: string; rows: number }> = [];
  for (const table of [...exportable].reverse()) {
    const predicate = exclusions.predicates.get(table.name);
    if (!predicate) continue;
    const scope = buildScopeFilter(table, byName, companyId, companyGroupId);
    const r = await sql`
      DELETE FROM ${sql.id(table.name)}
      WHERE ${scope} AND (${predicate})`.execute(trx);
    deleted.push({ table: table.name, rows: Number(r.numAffectedRows ?? 0) });
  }

  const left = await findExportScopeViolations(
    trx,
    exportable,
    byName,
    companyId,
    companyGroupId
  );
  if (left.length > 0) {
    throw new Error(
      `Purge left scope violations behind: ${formatScopeViolations(
        companyId,
        left
      )}`
    );
  }
  return { deleted };
}
