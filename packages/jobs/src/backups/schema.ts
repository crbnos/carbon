import type { TableName } from "@carbon/database/audit.config";
import type { KyselyDatabase } from "@carbon/database/client";
import { type Kysely, sql } from "kysely";
import { TABLE_RENAMES } from "./renames";

/**
 * Schema introspection + backup-compatibility logic, shared by the backup jobs
 * (`../inngest/functions/tasks/company-backup.ts`), the commit-time drift check
 * (`../scripts/check-backups.ts`) and the ERP Backups page (via the
 * `@carbon/jobs/backups` export).
 *
 * Keep this module free of runtime `@carbon/*` imports (type-only is fine) —
 * the drift check runs under bare `tsx`, which cannot named-import CJS
 * workspace packages, and the ERP imports it into a Vite server build.
 */

export const BACKUP_KIND = "carbon-company-backup";
export const BACKUP_VERSION = 1;

/**
 * Tables whose contents must never travel in a backup — credentials,
 * integration tokens and webhook targets stay with the source company.
 * (`apiKeyRateLimit` dangles without its stripped `apiKey` and is an UNLOGGED
 * operational counter, never user data.)
 */
export const SECRET_TABLES = [
  "apiKey",
  "apiKeyRateLimit",
  "companyIntegration",
  "webhook",
  "oauthClient",
  "oauthToken"
];

/**
 * Company-singleton config tables: one row per company, keyed by `id` (the
 * row's `id` IS the company id via an `id -> company` FK), no `companyId`
 * column. `companyPlan` is deliberately absent — billing identity never travels.
 */
export const COMPANY_SINGLETON_TABLES = [
  "companySettings",
  "terms",
  "companyAccountsPayableBillingAddress",
  "companyAccountsReceivableBillingAddress"
] as const satisfies readonly TableName[];

/** The company shell itself — created by onboarding, never imported. */
export const STRUCTURAL_TABLES = ["company"];

/**
 * MRP planning output, regenerated wholesale every run. Restoring stale
 * projections is bloat, and `demandForecastSource`'s discriminator CHECK breaks
 * under the FK-nulling dangling-ref policy on a remapped restore.
 * (`demandForecast` stays: it has a user-forecast write path and no such CHECK.)
 */
export const TRANSIENT_TABLES = [
  "demandForecastSource",
  "demandActual",
  "supplyForecast",
  "supplyActual"
] as const satisfies readonly TableName[];

/**
 * Excluded from the catalog entirely — never exported, wiped, or loaded. An
 * older backup still carrying one is not schema drift; its rows are ignored.
 */
export const CATALOG_EXCLUDED_TABLES = new Set<string>([
  ...STRUCTURAL_TABLES,
  ...TRANSIENT_TABLES
]);

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

export type Manifest = {
  kind: typeof BACKUP_KIND;
  version: typeof BACKUP_VERSION;
  schemaVersion: string;
  sourceCompanyId: string;
  sourceCompanyGroupId: string | null;
  sourceCompanyName: string | null;
  exportedAt: string;
  exportedBy: string;
  label: string | null;
  includeStorage: "none" | "all";
  tables: Array<{ name: string; rows: number; columns: string[] }>;
  storage: Array<{ path: string; size: number; included: boolean }>;
  excludedTables: string[];
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
  const secret = new Set<string>(SECRET_TABLES);
  const exportable: TableInfo[] = [];
  const excludedTables: string[] = [];
  for (const table of catalog.tables) {
    if (secret.has(table.name)) excludedTables.push(table.name);
    else exportable.push(table);
  }
  return { exportable, excludedTables };
}

/** The columns a backup actually carries: generated ones are recomputed on load. */
export function exportableColumns(table: TableInfo): ColumnInfo[] {
  return table.columns.filter((c) => !c.isGenerated);
}

/**
 * Kahn's algorithm over in-set FK edges (referenced tables first). Cycles are
 * broken deterministically (fewest unmet dependencies, then alphabetically).
 * Order is best-effort: imports run with FK enforcement relaxed when possible.
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

  const sorted: TableInfo[] = [];
  while (remaining.size > 0) {
    let next: string | null = null;
    let fewest = Infinity;
    for (const name of [...remaining].sort()) {
      const unmet = [...(deps.get(name) ?? [])].filter((d) =>
        remaining.has(d)
      ).length;
      if (unmet === 0) {
        next = name;
        break;
      }
      if (unmet < fewest) {
        fewest = unmet;
        next = name;
      }
    }
    if (!next) break;
    remaining.delete(next);
    sorted.push(byName.get(next)!);
  }

  return sorted;
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
  `.execute(db);

  const primaryKeys = await sql<{
    table_name: string;
    column_name: string;
    ordinal_position: string | number;
  }>`
    SELECT tc.table_name, kcu.column_name, kcu.ordinal_position
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name
      AND kcu.table_schema = tc.table_schema
    WHERE tc.table_schema = 'public' AND tc.constraint_type = 'PRIMARY KEY'
    ORDER BY tc.table_name, kcu.ordinal_position
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

  // FK graph for EVERY table so scope can be resolved transitively below.
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

  // A table with no scope column but a FK to an already-scoped table inherits
  // that scope (nearest scoped parent wins — BFS by passes).
  const scope = new Map<string, Scope>();
  const scopeRoot = new Map<string, "companyId" | "companyGroupId">();
  for (const [name, column] of scopeByTable) {
    scope.set(name, { kind: "direct", column });
    scopeRoot.set(name, column);
  }
  // Singletons are injected BEFORE via-resolution so a FK to a scoped table
  // can't mis-scope them through it.
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
      hasDefault: c.column_default !== null
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

export type CompatibilityFinding = {
  /**
   * `defaulted` — a column added since this backup, which will take its DEFAULT.
   * `discarded` — a column removed since this backup; its values land nowhere.
   * `blocked`   — the restore cannot proceed.
   */
  kind: "defaulted" | "discarded" | "blocked";
  table: string;
  column?: string;
  reason: string;
};

/**
 * Diff a backup's manifest against a catalog: what a restore would fill with a
 * default, discard, or refuse outright. Only meaningful when the two come from
 * DIFFERENT points in time — the ERP loader computes it against the live schema,
 * and `assertBackupImportable` is its boolean form inside the restore.
 *
 * A NULLABLE column added since the backup is not reported — the ordinary
 * additive case would bury the findings that matter.
 */
export function reportBackupCompatibility(
  catalog: Catalog,
  manifest: Manifest
): { findings: CompatibilityFinding[]; blocked: boolean } {
  const findings: CompatibilityFinding[] = [];

  if (manifest.version !== BACKUP_VERSION) {
    // Nothing else about an unsupported generation is worth reporting.
    findings.push({
      kind: "blocked",
      table: "*",
      reason: `its format (generation ${manifest.version}) is no longer supported (current is ${BACKUP_VERSION})`
    });
    return { findings, blocked: true };
  }

  // Account defaults and the chart of accounts must travel together, or the
  // restore leaves a dangling FK. Read from the manifest: an empty table is
  // omitted entirely, so an absent entry IS a zero count.
  const rowsIn = (table: string) =>
    manifest.tables.find((t) => t.name === table)?.rows ?? 0;
  if (rowsIn("accountDefault") > 0 && rowsIn("account") === 0) {
    findings.push({
      kind: "blocked",
      table: "accountDefault",
      reason:
        "it has account defaults but no chart of accounts (exported from a company with no group)"
    });
  }

  const liveByName = new Map(catalog.tables.map((t) => [t.name, t]));
  const backupTableNames = new Set(manifest.tables.map((t) => t.name));
  for (const backupTable of manifest.tables) {
    if (CATALOG_EXCLUDED_TABLES.has(backupTable.name)) continue;

    // A table missing from the catalog resolves through TABLE_RENAMES: a mapped
    // name is the new table, an explicit null was dropped with its feature, and
    // an UNMAPPED name blocks — see renames.ts for why guessing is unacceptable.
    let live = liveByName.get(backupTable.name);
    if (!live) {
      const renamedTo = TABLE_RENAMES[backupTable.name];
      if (renamedTo === undefined) {
        findings.push({
          kind: "blocked",
          table: backupTable.name,
          reason: `table "${backupTable.name}" is not in the current schema and has no rename mapping`
        });
        continue;
      }
      if (renamedTo === null) {
        findings.push({
          kind: "discarded",
          table: backupTable.name,
          reason:
            "this table was removed along with its feature; its rows will not be restored"
        });
        continue;
      }
      // The backup carries BOTH names — applying the rename would merge two
      // tables and silently drop the old one's rows. Refuse.
      if (backupTableNames.has(renamedTo)) {
        findings.push({
          kind: "blocked",
          table: backupTable.name,
          reason: `it maps to "${renamedTo}", which this backup also contains`
        });
        continue;
      }
      live = liveByName.get(renamedTo);
      if (!live) {
        findings.push({
          kind: "blocked",
          table: backupTable.name,
          reason: `it maps to "${renamedTo}", which is not in the current schema either`
        });
        continue;
      }
    }

    const backupCols = new Set(backupTable.columns);
    for (const c of live.columns) {
      if (backupCols.has(c.name) || c.isGenerated || c.isNullable) continue;
      if (c.hasDefault) {
        findings.push({
          kind: "defaulted",
          table: backupTable.name,
          column: c.name,
          reason: "added since this backup; will take its default value"
        });
      } else {
        findings.push({
          kind: "blocked",
          table: backupTable.name,
          column: c.name,
          reason:
            "required since this backup, with no default value to fall back on"
        });
      }
    }

    const liveCols = new Set(live.columns.map((c) => c.name));
    for (const name of backupTable.columns) {
      if (liveCols.has(name)) continue;
      findings.push({
        kind: "discarded",
        table: backupTable.name,
        column: name,
        reason: "removed since this backup; its values will not be restored"
      });
    }
  }

  return {
    findings,
    blocked: findings.some((f) => f.kind === "blocked")
  };
}

export type BackupCompatibilityStatus =
  | "ready"
  | "restorable-with-changes"
  | "not-restorable";

/** Map a compatibility report onto the shared status vocabulary. */
export function compatibilityStatus(report: {
  findings: CompatibilityFinding[];
  blocked: boolean;
}): BackupCompatibilityStatus {
  if (report.blocked) return "not-restorable";
  return report.findings.length > 0 ? "restorable-with-changes" : "ready";
}
