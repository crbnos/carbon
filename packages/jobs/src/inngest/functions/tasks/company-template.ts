import {
  getPostgresClient,
  getPostgresConnectionPool,
  type KyselyDatabase
} from "@carbon/database/client";
import { type Kysely, PostgresDriver, sql } from "kysely";

/**
 * Shared core for company template export/import.
 *
 * The table catalog is derived from the live database schema
 * (information_schema + pg_constraint) rather than a hand-maintained list,
 * so new company-scoped tables are picked up automatically.
 */

export const ARTIFACT_KIND = "carbon-company-template";
export const ARTIFACT_VERSION = 1;
export const TEMPLATE_INTEGRATION = "company-template";
export const EXPORTS_PREFIX = "exports";
/** Shared, env-agnostic bucket backing the demo catalog. */
export const TEMPLATES_BUCKET = "company-templates";

/**
 * Tables whose contents must never travel in an artifact — credentials,
 * integration tokens and webhook targets stay with the source company.
 */
export const SECRET_TABLES = [
  "apiKey",
  "companyIntegration",
  "webhook",
  "oauthClient",
  "oauthToken"
];

/**
 * Tenant-root tables that carry a scope column but are NOT tenant data — the
 * company shell itself is created by onboarding, never imported. Excluded
 * from the catalog entirely.
 */
export const STRUCTURAL_TABLES = ["company"];

/**
 * Additional tables skipped in `reseed` mode — memberships, invites and
 * integration state belong to the source company's users, not to a copy.
 * The importing company already has its admin membership from onboarding.
 */
export const RESEED_SKIPPED_TABLES = [
  "userToCompany",
  "employee",
  "employeeType",
  "employeeTypePermission",
  "invite",
  "externalIntegrationMapping"
];

export type ColumnInfo = {
  name: string;
  /** information_schema data_type, e.g. 'ARRAY', 'jsonb', 'USER-DEFINED' */
  dataType: string;
  /** information_schema udt_name, e.g. '_text', 'jsonb', 'bytea' */
  udtName: string;
  isNullable: boolean;
  /** GENERATED ALWAYS / identity columns — excluded from export & insert */
  isGenerated: boolean;
  /** has a column default (so a backup that omits it can still insert) */
  hasDefault: boolean;
};

export type ForeignKey = {
  column: string;
  refTable: string;
  refColumn: string;
};

export type TableInfo = {
  name: string;
  columns: ColumnInfo[];
  /**
   * The tenant column the rows are filtered/stamped by. Most data is
   * `companyId`-scoped; the chart of accounts and other shared config
   * (account, currency, dimension, …) is `companyGroupId`-scoped.
   */
  scopeColumn: "companyId" | "companyGroupId";
  /** primary key column names (empty when the table has no PK) */
  pkColumns: string[];
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
  kind: typeof ARTIFACT_KIND;
  version: typeof ARTIFACT_VERSION;
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

export type Artifact = {
  manifest: Manifest;
  data: Record<string, Record<string, unknown>[]>;
  /** path within the company bucket -> base64 contents */
  storage?: Record<string, string>;
};

export function getJobDatabaseClient(size = 1) {
  const pool = getPostgresConnectionPool(size);
  return getPostgresClient(
    pool,
    PostgresDriver
  ) as unknown as Kysely<KyselyDatabase>;
}

/**
 * Build the catalog of tenant-scoped tables (public base tables with a
 * "companyId" or "companyGroupId" column), their columns, FK edges and a
 * topological order. A table that has both columns is treated as
 * companyId-scoped.
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

  // companyId wins when a table carries both columns.
  const structural = new Set(STRUCTURAL_TABLES);
  const scopeByTable = new Map<string, "companyId" | "companyGroupId">();
  for (const r of scopeRows.rows) {
    if (structural.has(r.name)) continue;
    if (r.column_name === "companyId") {
      scopeByTable.set(r.name, "companyId");
    } else if (!scopeByTable.has(r.name)) {
      scopeByTable.set(r.name, "companyGroupId");
    }
  }
  const tableSet = new Set(scopeByTable.keys());

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
      scopeColumn: scopeByTable.get(name)!,
      pkColumns,
      hasId: pkColumns.length === 1 && pkColumns[0] === "id",
      foreignKeys: fksByTable.get(name) ?? []
    };
  });

  return { schemaVersion, tables: topologicalSort(tables) };
}

/**
 * Decide whether a backup can be imported into the *current* schema. A backup
 * is a point-in-time snapshot; a breaking migration since then would make the
 * insert fail. Incompatible when, for a table the backup populates, the live
 * schema either no longer has the table, or has gained a required column (NOT
 * NULL, no default, not generated) the backup can't supply. Additive migrations
 * (new nullable/defaulted columns, new tables) stay compatible automatically —
 * so there's no version to bump by hand.
 */
export function assertBackupImportable(
  catalog: Catalog,
  artifact: Artifact
): { ok: true } | { ok: false; reason: string } {
  const { manifest } = artifact;

  if (manifest.version !== ARTIFACT_VERSION) {
    return {
      ok: false,
      reason: `its format (generation ${manifest.version}) is no longer supported (current is ${ARTIFACT_VERSION})`
    };
  }

  // Account defaults reference the chart of accounts, so the two must travel
  // together; defaults without accounts came from a groupless company and would
  // leave a dangling FK (the export-side guard now prevents producing these).
  if (
    (artifact.data.accountDefault?.length ?? 0) > 0 &&
    (artifact.data.account?.length ?? 0) === 0
  ) {
    return {
      ok: false,
      reason:
        "it has account defaults but no chart of accounts (exported from a company with no group)"
    };
  }

  const liveByName = new Map(catalog.tables.map((t) => [t.name, t]));
  for (const backupTable of manifest.tables) {
    const live = liveByName.get(backupTable.name);
    if (!live) {
      return {
        ok: false,
        reason: `table "${backupTable.name}" no longer exists in the current schema`
      };
    }
    const backupCols = new Set(backupTable.columns);
    const missing = live.columns.find(
      (c) =>
        !c.isNullable &&
        !c.hasDefault &&
        !c.isGenerated &&
        !backupCols.has(c.name)
    );
    if (missing) {
      return {
        ok: false,
        reason: `"${backupTable.name}" now requires column "${missing.name}", which this backup predates`
      };
    }
  }
  return { ok: true };
}

/**
 * Kahn's algorithm over in-set FK edges (referenced tables first). Cycles
 * are broken deterministically by picking the remaining table with the
 * fewest unmet dependencies (then alphabetically). Order is best-effort:
 * imports run with FK enforcement relaxed when possible.
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

/** Convert a pg-returned value into a JSON-safe artifact value. */
export function encodeValue(value: unknown, col: ColumnInfo): unknown {
  if (value === null || value === undefined) return null;
  if (col.udtName === "bytea" && Buffer.isBuffer(value)) {
    return value.toString("base64");
  }
  if (value instanceof Date) return value.toISOString();
  return value;
}

/**
 * Convert an artifact value into a parameter node-pg can bind for this
 * column. Strings pass through untyped so Postgres coerces them into
 * enums/timestamps/numerics by column type; json(b) values are stringified
 * so JS arrays inside jsonb are not mistaken for Postgres arrays.
 */
export function bindValue(value: unknown, col: ColumnInfo): unknown {
  if (value === null || value === undefined) return null;
  if (col.udtName === "bytea" && typeof value === "string") {
    return Buffer.from(value, "base64");
  }
  if (col.udtName === "json" || col.udtName === "jsonb") {
    return JSON.stringify(value);
  }
  return value;
}

/**
 * Of the given tables, return only those the target has NOT yet populated in
 * its scope (companyId or companyGroupId). Reseed import uses this so it
 * never overwrites data the target already owns — a bare clone keeps every
 * table, an identity-seeded onboard drops the ones its seed/triggers filled.
 */
export async function filterUnpopulated(
  db: Kysely<KyselyDatabase>,
  tables: TableInfo[],
  companyId: string,
  companyGroupId: string | null
): Promise<TableInfo[]> {
  const isEmpty = await Promise.all(
    tables.map(async (t) => {
      const scopeValue =
        t.scopeColumn === "companyGroupId" ? companyGroupId : companyId;
      if (scopeValue === null) return true;
      const result = await sql<{ present: boolean }>`
        SELECT EXISTS(
          SELECT 1 FROM ${sql.id(t.name)}
          WHERE ${sql.id(t.scopeColumn)} = ${scopeValue}
        ) AS present
      `.execute(db);
      return !result.rows[0]?.present;
    })
  );
  return tables.filter((_, i) => isEmpty[i]);
}

/**
 * Probe whether this connection may disable triggers/FK enforcement via
 * `session_replication_role`. True on local dev (superuser); on hosted
 * Supabase it depends on the grants of the connecting role.
 */
export async function canSetReplicationRole(
  db: Kysely<KyselyDatabase>
): Promise<boolean> {
  try {
    await db.transaction().execute(async (trx) => {
      await sql`SET LOCAL session_replication_role = 'replica'`.execute(trx);
      throw new Error("__rollback__");
    });
    return true;
  } catch (err) {
    return err instanceof Error && err.message === "__rollback__";
  }
}
