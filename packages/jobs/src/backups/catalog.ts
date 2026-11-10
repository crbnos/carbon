// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { KyselyDatabase } from "@carbon/database/client";
import { type Kysely, sql } from "kysely";
import {
  CATALOG_EXCLUDED_TABLES,
  COMPANY_SINGLETON_TABLES,
  isSecretTable
} from "./policy";

/**
 * The backup catalog: every public table that carries a `companyId` or
 * `companyGroupId`, with its columns, keys and FK edges, read from the live
 * schema and sorted referenced-first. Free of runtime `@carbon/*` imports: the
 * drift check runs under bare `tsx`.
 */

export type ColumnInfo = {
  name: string;
  /** information_schema data_type, e.g. 'ARRAY', 'jsonb', 'USER-DEFINED' */
  dataType: string;
  /** information_schema udt_name, e.g. '_text', 'jsonb', 'bytea' */
  udtName: string;
  isNullable: boolean;
  /** GENERATED ALWAYS / identity columns — excluded from export & insert */
  isGenerated: boolean;
  hasDefault: boolean;
  /** `item` for a column defaulting to `id('item')`: new ids get the same prefix. */
  idPrefix?: string;
};

export type ForeignKey = {
  column: string;
  refTable: string;
  refColumn: string;
};

/**
 * How a table's rows are scoped to a company:
 * - `direct`: the table has a scope column (`companyId`/`companyGroupId`, or
 *   `id` for a company-singleton).
 * - `via`: no scope column, but a FK to a scoped table (possibly transitive) —
 *   e.g. `customerContact.customerId → customer`. Resolved from the FK graph so
 *   child tables travel with their parent without a hand-maintained list.
 */
export type Scope =
  | { kind: "direct"; column: "companyId" | "companyGroupId" | "id" }
  | { kind: "via"; column: string; refColumn: string; parent: string };

export type TableInfo = {
  name: string;
  columns: ColumnInfo[];
  scope: Scope;
  /**
   * The resolved ROOT tenant column — `companyId` for most data,
   * `companyGroupId` for shared config. For a `via` table, the root ancestor's.
   */
  scopeColumn: "companyId" | "companyGroupId";
  /** primary key column names (empty when the table has no PK) */
  pkColumns: string[];
  /**
   * Every column in ANY uniqueness constraint — PK, unique constraint, or bare
   * unique index. A foreign restore that collapses a user FK in one of these
   * would collide (`isUserScopedIdentityTable`); PK alone misses unique-index keys.
   */
  uniqueColumns: string[];
  /** true when the primary key is exactly the single column "id" */
  hasId: boolean;
  foreignKeys: ForeignKey[];
};

export type Catalog = {
  schemaVersion: string;
  /** topologically sorted — referenced tables come first */
  tables: TableInfo[];
};

/**
 * What a backup contains, decided in ONE place — the exporter and the drift
 * check's baseline must be the same rule, or the baseline quietly stops
 * describing a real backup.
 */
export function selectExportableTables(catalog: Catalog): {
  exportable: TableInfo[];
  excludedTables: string[];
} {
  const exportable: TableInfo[] = [];
  const excludedTables: string[] = [];
  for (const table of catalog.tables) {
    if (isSecretTable(table.name)) excludedTables.push(table.name);
    else exportable.push(table);
  }
  return { exportable, excludedTables };
}

/** The columns a backup actually carries: generated ones are recomputed on load. */
export function exportableColumns(table: TableInfo): ColumnInfo[] {
  return table.columns.filter((c) => !c.isGenerated);
}

/**
 * Kahn's algorithm over in-set FK edges (referenced tables first). A cycle is
 * broken inside the cycle (fewest unmet dependencies, then alphabetically):
 * only a table whose unmet dependencies all share its cycle may go early. A
 * table that merely hangs off a cycle (`jobFavorite` off `job`) waits for it —
 * the wipe runs this order backwards and filters a child through its parent,
 * so a child placed before its parent survived the wipe.
 */
export function topologicalSort(tables: TableInfo[]): TableInfo[] {
  const byName = new Map(tables.map((t) => [t.name, t]));
  const remaining = new Set(byName.keys());
  const deps = new Map<string, Set<string>>();

  for (const t of tables) {
    const set = new Set<string>();
    for (const fk of t.foreignKeys) {
      if (fk.refTable !== t.name && byName.has(fk.refTable)) {
        set.add(fk.refTable);
      }
    }
    deps.set(t.name, set);
  }

  const cycleOf = stronglyConnectedComponents([...byName.keys()].sort(), deps);

  const sorted: TableInfo[] = [];
  while (remaining.size > 0) {
    let next: string | null = null;
    let fewest = Infinity;
    for (const name of [...remaining].sort()) {
      const unmet = [...(deps.get(name) ?? [])].filter((d) => remaining.has(d));
      if (unmet.length === 0) {
        next = name;
        break;
      }
      const insideCycle = unmet.every(
        (d) => cycleOf.get(d) === cycleOf.get(name)
      );
      if (insideCycle && unmet.length < fewest) {
        fewest = unmet.length;
        next = name;
      }
    }
    if (!next) break;
    remaining.delete(next);
    sorted.push(byName.get(next)!);
  }

  return sorted;
}

/** Tarjan's algorithm: each name's component id. Names in one cycle share it. */
function stronglyConnectedComponents(
  names: string[],
  deps: Map<string, Set<string>>
): Map<string, number> {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const component = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  let counter = 0;
  let components = 0;

  const visit = (v: string) => {
    index.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of [...(deps.get(v) ?? [])].sort()) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, index.get(w)!));
      }
    }
    if (low.get(v) === index.get(v)) {
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        component.set(w, components);
      } while (w !== v);
      components++;
    }
  };

  for (const name of names) if (!index.has(name)) visit(name);
  return component;
}

/**
 * Build the catalog of tenant-scoped tables (public base tables with a
 * "companyId" or "companyGroupId" column), their columns, FK edges and a
 * topological order. A table that has both columns is companyId-scoped.
 */
export async function getCompanyTableCatalog(
  db: Kysely<KyselyDatabase>
): Promise<Catalog> {
  const scopeRows = await sql<{ name: string; column_name: string }>`
    SELECT c.table_name AS name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name IN ('companyId', 'companyGroupId')
      AND t.table_type = 'BASE TABLE'
  `.execute(db);

  const structural = CATALOG_EXCLUDED_TABLES;
  const scopeByTable = new Map<string, "companyId" | "companyGroupId">();
  for (const r of scopeRows.rows) {
    if (structural.has(r.name)) continue;
    if (r.column_name === "companyId") {
      scopeByTable.set(r.name, "companyId");
    } else if (!scopeByTable.has(r.name)) {
      scopeByTable.set(r.name, "companyGroupId");
    }
  }

  const columns = await sql<{
    table_name: string;
    column_name: string;
    data_type: string;
    udt_name: string;
    is_nullable: string;
    is_generated: string;
    identity_generation: string | null;
    column_default: string | null;
  }>`
    SELECT table_name, column_name, data_type, udt_name, is_nullable,
           is_generated, identity_generation, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `.execute(db);

  // pg_catalog, not information_schema: the information_schema join takes ~3.5 s
  // on this schema, and the backups page runs this on every load.
  const primaryKeys = await sql<{ table_name: string; column_name: string }>`
    SELECT t.relname AS table_name, a.attname AS column_name
    FROM pg_constraint con
    JOIN pg_class t ON t.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = t.relnamespace
    CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
    WHERE con.contype = 'p' AND nsp.nspname = 'public'
    ORDER BY t.relname, k.ord
  `.execute(db);

  // Columns in ANY unique index (covers PKs, unique constraints, and bare
  // CREATE UNIQUE INDEX). `attnum = ANY(indkey)` skips expression-index entries.
  const uniqueColumns = await sql<{ table_name: string; column_name: string }>`
    SELECT t.relname AS table_name, a.attname AS column_name
    FROM pg_index ix
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_namespace nsp ON nsp.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (ix.indkey)
    WHERE ix.indisunique AND nsp.nspname = 'public'
  `.execute(db);

  const foreignKeys = await sql<{
    table_name: string;
    column_name: string;
    ref_table: string;
    ref_column: string;
  }>`
    SELECT src.relname AS table_name, att.attname AS column_name,
           tgt.relname AS ref_table, tatt.attname AS ref_column
    FROM pg_constraint con
    JOIN pg_class src ON src.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = src.relnamespace
    JOIN pg_class tgt ON tgt.oid = con.confrelid
    CROSS JOIN LATERAL unnest(con.conkey, con.confkey)
      WITH ORDINALITY AS u(attnum, fattnum, ord)
    JOIN pg_attribute att
      ON att.attrelid = src.oid AND att.attnum = u.attnum
    JOIN pg_attribute tatt
      ON tatt.attrelid = tgt.oid AND tatt.attnum = u.fattnum
    WHERE con.contype = 'f' AND nsp.nspname = 'public'
  `.execute(db);

  const allFksByTable = new Map<string, ForeignKey[]>();
  for (const f of foreignKeys.rows) {
    const list = allFksByTable.get(f.table_name) ?? [];
    list.push({
      column: f.column_name,
      refTable: f.ref_table,
      refColumn: f.ref_column
    });
    allFksByTable.set(f.table_name, list);
  }

  const scope = new Map<string, Scope>();
  const scopeRoot = new Map<string, "companyId" | "companyGroupId">();
  for (const [name, column] of scopeByTable) {
    scope.set(name, { kind: "direct", column });
    scopeRoot.set(name, column);
  }
  const existingTables = new Set(columns.rows.map((c) => c.table_name));
  for (const name of COMPANY_SINGLETON_TABLES) {
    if (!existingTables.has(name) || scope.has(name)) continue;
    scope.set(name, { kind: "direct", column: "id" });
    scopeRoot.set(name, "companyId");
  }
  let resolvedMore = true;
  while (resolvedMore) {
    resolvedMore = false;
    for (const [name, fks] of allFksByTable) {
      if (scope.has(name) || structural.has(name)) continue;
      const fk = fks.find((f) => f.refTable !== name && scope.has(f.refTable));
      if (!fk) continue;
      scope.set(name, {
        kind: "via",
        column: fk.column,
        refColumn: fk.refColumn,
        parent: fk.refTable
      });
      scopeRoot.set(name, scopeRoot.get(fk.refTable)!);
      resolvedMore = true;
    }
  }
  const tableSet = new Set(scope.keys());

  let schemaVersion = "unknown";
  try {
    const migration = await sql<{ version: string }>`
      SELECT version FROM supabase_migrations.schema_migrations
      ORDER BY version DESC LIMIT 1
    `.execute(db);
    schemaVersion = migration.rows[0]?.version ?? "unknown";
  } catch {
    // migrations table unavailable — leave as unknown
  }

  const columnsByTable = new Map<string, ColumnInfo[]>();
  for (const c of columns.rows) {
    if (!tableSet.has(c.table_name)) continue;
    const list = columnsByTable.get(c.table_name) ?? [];
    list.push({
      name: c.column_name,
      dataType: c.data_type,
      udtName: c.udt_name,
      isNullable: c.is_nullable === "YES",
      isGenerated:
        c.is_generated === "ALWAYS" || c.identity_generation !== null,
      hasDefault: c.column_default !== null,
      idPrefix: c.column_default?.match(/^id\('([^']+)'/)?.[1]
    });
    columnsByTable.set(c.table_name, list);
  }

  const pkColumnsByTable = new Map<string, string[]>();
  for (const p of primaryKeys.rows) {
    const list = pkColumnsByTable.get(p.table_name) ?? [];
    list.push(p.column_name);
    pkColumnsByTable.set(p.table_name, list);
  }

  const uniqueColumnsByTable = new Map<string, Set<string>>();
  for (const u of uniqueColumns.rows) {
    const set = uniqueColumnsByTable.get(u.table_name) ?? new Set<string>();
    set.add(u.column_name);
    uniqueColumnsByTable.set(u.table_name, set);
  }

  const fksByTable = new Map<string, ForeignKey[]>();
  for (const f of foreignKeys.rows) {
    if (!tableSet.has(f.table_name)) continue;
    const list = fksByTable.get(f.table_name) ?? [];
    list.push({
      column: f.column_name,
      refTable: f.ref_table,
      refColumn: f.ref_column
    });
    fksByTable.set(f.table_name, list);
  }

  const tables: TableInfo[] = [...tableSet].sort().map((name) => {
    const pkColumns = pkColumnsByTable.get(name) ?? [];
    return {
      name,
      columns: columnsByTable.get(name) ?? [],
      scope: scope.get(name)!,
      scopeColumn: scopeRoot.get(name)!,
      pkColumns,
      uniqueColumns: [...(uniqueColumnsByTable.get(name) ?? [])],
      hasId: pkColumns.length === 1 && pkColumns[0] === "id",
      foreignKeys: fksByTable.get(name) ?? []
    };
  });

  return { schemaVersion, tables: topologicalSort(tables) };
}
