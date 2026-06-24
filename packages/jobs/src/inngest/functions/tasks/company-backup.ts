import { randomUUID } from "node:crypto";
import {
  getPostgresClient,
  getPostgresConnectionPool,
  type KyselyDatabase
} from "@carbon/database/client";
import { type Kysely, PostgresDriver, sql } from "kysely";
import { nanoid } from "nanoid";

/**
 * Shared core for company backup export/import.
 *
 * The table catalog is derived from the live database schema
 * (information_schema + pg_constraint) rather than a hand-maintained list,
 * so new company-scoped tables are picked up automatically.
 */

export const BACKUP_KIND = "carbon-company-backup";
export const BACKUP_VERSION = 1;
export const BACKUP_INTEGRATION = "company-backup";
export const EXPORTS_PREFIX = "exports";
/** Shared, env-agnostic bucket holding the onboarding backup templates. */
export const TEMPLATE_BUCKET = "company-templates";

/**
 * The bucket the app stores per-company assets in (3D models, item thumbnails,
 * document attachments), all under a `{companyId}/` prefix. A self-contained
 * backup must embed these — they are NOT in the per-company bucket.
 */
export const STORAGE_BUCKET = "private";

/**
 * TEXT columns that hold a storage path (`{companyId}/…/{id}.ext`). On reseed
 * the companyId and the embedded ids both change, so these must be rewritten in
 * lock-step with the files they point at (see `rewriteStoragePath`).
 */
export const STORAGE_PATH_COLUMNS = new Set(["modelPath", "thumbnailPath"]);

/**
 * Prefix in the `private` bucket where onboarding demo-template assets live ONCE
 * per workspace (3D models, etc.), uploaded at deploy from the committed
 * template gz. A template import references these instead of copying the files
 * into every onboarded company's `{companyId}/` prefix.
 *
 * NOTE: `ci/src/upload-backup-templates.ts` (a plain Node script that can't
 * import this Deno/Inngest module cheaply) hardcodes the same literal — keep
 * the two in sync.
 */
export const TEMPLATE_ASSET_PREFIX = "_templates";

/**
 * Rewrite a `{sourceCompanyId}/…` storage path to its shared template location
 * `_templates/{industryId}/…`, keeping the trailing segments (and their ids)
 * intact — the canonical asset is shared across every company onboarded from
 * the template, so ids are NOT remapped. Used both when fanning a template's
 * assets into the shared prefix at deploy and when pointing a referenced
 * import's path columns at them. A no-op if the path isn't under the source
 * company prefix.
 */
export function rewriteToTemplateAssetPath(
  path: string,
  sourceCompanyId: string,
  industryId: string
): string {
  if (path.startsWith(`${sourceCompanyId}/`)) {
    return `${TEMPLATE_ASSET_PREFIX}/${industryId}/${path.slice(
      sourceCompanyId.length + 1
    )}`;
  }
  return path;
}

/**
 * Rewrite a storage path for the target company. Swaps the leading
 * `{sourceCompanyId}/` and any path segment whose id was remapped on reseed
 * (e.g. `{co}/models/{modelId}.stl`, `{co}/thumbnails/{itemId}/{file}`). A
 * no-op for preserve-mode (same company, empty `idRewrite`). The same function
 * is applied to both the uploaded file path and the DB path columns so they
 * stay consistent.
 */
export function rewriteStoragePath(
  path: string,
  sourceCompanyId: string,
  targetCompanyId: string,
  idRewrite: Map<string, string>
): string {
  let p = path;
  if (
    sourceCompanyId !== targetCompanyId &&
    p.startsWith(`${sourceCompanyId}/`)
  ) {
    p = `${targetCompanyId}/${p.slice(sourceCompanyId.length + 1)}`;
  }
  if (idRewrite.size === 0) return p;
  return p
    .split("/")
    .map((seg) => {
      const dot = seg.indexOf(".");
      const idPart = dot >= 0 ? seg.slice(0, dot) : seg;
      const rest = dot >= 0 ? seg.slice(dot) : "";
      const mapped = idRewrite.get(idPart);
      return mapped ? mapped + rest : seg;
    })
    .join("/");
}

/**
 * Tables whose contents must never travel in a backup — credentials,
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

/**
 * Tables an in-place restore must NOT wipe or reload — the caller's own access
 * and identity. Wiping these mid-restore would lock the user out of the company
 * they're restoring. The backup still carries them; they're simply left as-is.
 */
export const IN_PLACE_SKIPPED_TABLES = new Set([
  "userToCompany",
  "employee",
  "employeeType",
  "employeeTypePermission",
  "invite",
  "externalIntegrationMapping"
]);

/** Integration key for the in-place restore marker (holds the snapshot path). */
export const RESTORE_INTEGRATION = "company-restore";

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

export type CompanyBackup = {
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
  backup: CompanyBackup
): { ok: true } | { ok: false; reason: string } {
  const { manifest } = backup;

  if (manifest.version !== BACKUP_VERSION) {
    return {
      ok: false,
      reason: `its format (generation ${manifest.version}) is no longer supported (current is ${BACKUP_VERSION})`
    };
  }

  // Account defaults reference the chart of accounts, so the two must travel
  // together; defaults without accounts came from a groupless company and would
  // leave a dangling FK (the export-side guard now prevents producing these).
  if (
    (backup.data.accountDefault?.length ?? 0) > 0 &&
    (backup.data.account?.length ?? 0) === 0
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

/**
 * A fresh primary-key value for a table, matching its `id` column's type as the
 * schema defines it — a real UUID for `uuid` columns, otherwise a nanoid (what
 * the `id()` default produces). Used wherever reseed/restore remaps ids, so we
 * never feed a nanoid into a uuid column.
 */
export function newIdForTable(table: TableInfo): string {
  const idCol = table.columns.find((c) => c.name === "id");
  return idCol?.udtName === "uuid" ? randomUUID() : nanoid();
}

/** Convert a pg-returned value into a JSON-safe backup value. */
export function encodeValue(value: unknown, col: ColumnInfo): unknown {
  if (value === null || value === undefined) return null;
  if (col.udtName === "bytea" && Buffer.isBuffer(value)) {
    return value.toString("base64");
  }
  if (value instanceof Date) return value.toISOString();
  return value;
}

/**
 * Convert a backup value into a parameter node-pg can bind for this
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

/**
 * The companyId-scoped tables an in-place restore may clear and reload: minus
 * the access/identity tables (kept, so the user isn't locked out) and secrets
 * (never travel). companyGroupId-scoped tables (chart of accounts, currencies)
 * are excluded — shared across the group, so a single company's restore must
 * not touch them. Returned in catalog (topological) order.
 *
 * The full set is WIPED (so a table empty in the backup ends up empty, matching
 * the snapshot exactly); only the subset with rows in the backup is reloaded.
 */
export function selectWipeableTables(
  catalog: Catalog,
  opts: { includeGroup?: boolean } = {}
): TableInfo[] {
  const skip = new Set([...SECRET_TABLES, ...IN_PLACE_SKIPPED_TABLES]);
  return catalog.tables.filter(
    (t) =>
      !skip.has(t.name) &&
      (t.scopeColumn === "companyId" ||
        (opts.includeGroup === true && t.scopeColumn === "companyGroupId"))
  );
}

/**
 * Guard the in-place restore invariant: a KEPT table (access/secret tables that
 * survive a wipe) must not hold a NOT-NULL foreign key into a WIPED table. If it
 * did, wiping the referenced table would dangle the kept row (own restore could
 * leave it pointing at an emptied table; foreign restore remaps to new ids).
 * Currently holds — this catches future schema drift before it corrupts data.
 */
export function assertWipeSafe(
  catalog: Catalog
): { ok: true } | { ok: false; reason: string } {
  const wipeable = new Set(
    selectWipeableTables(catalog, { includeGroup: true }).map((t) => t.name)
  );
  const kept = new Set([...IN_PLACE_SKIPPED_TABLES, ...SECRET_TABLES]);
  for (const table of catalog.tables) {
    if (!kept.has(table.name)) continue;
    const colByName = new Map(table.columns.map((c) => [c.name, c]));
    for (const fk of table.foreignKeys) {
      const col = colByName.get(fk.column);
      if (col && !col.isNullable && wipeable.has(fk.refTable)) {
        return {
          ok: false,
          reason: `"${table.name}.${fk.column}" requires "${fk.refTable}", which a restore wipes — it would be left dangling`
        };
      }
    }
  }
  return { ok: true };
}

/**
 * Delete every row of the given tables for one company, in REVERSE topological
 * order (children before parents) so FK constraints hold by construction.
 * `tables` is expected in catalog (referenced-first) order; this reverses it.
 * Each table is scoped by its own column — companyId-scoped by `companyId`,
 * companyGroupId-scoped by `companyGroupId`. Run inside the caller's
 * transaction, ideally with `session_replication_role = 'replica'` set.
 */
export async function wipeScopedData(
  trx: Kysely<KyselyDatabase>,
  tables: TableInfo[],
  scope: { companyId: string; companyGroupId: string | null }
): Promise<void> {
  for (const table of [...tables].reverse()) {
    const value =
      table.scopeColumn === "companyGroupId"
        ? scope.companyGroupId
        : scope.companyId;
    if (value == null) continue;
    await sql`
      DELETE FROM ${sql.id(table.name)}
      WHERE ${sql.id(table.scopeColumn)} = ${value}
    `.execute(trx);
  }
}
