import type { KyselyDatabase } from "@carbon/database/client";
import { type Kysely, sql } from "kysely";
import {
  type Catalog,
  type ColumnInfo,
  type CompanyBackup,
  mapWithConcurrency,
  RETAINED_REF_TABLES,
  rewriteStoragePath,
  rewriteToTemplateAssetPath,
  SECRET_TABLES,
  STORAGE_PATH_COLUMNS,
  type TableInfo
} from "./company-backup";

// Referential-closure checks and row-remap transforms for company backup/restore.
// Extracted from company-backup.ts (which keeps catalog introspection, serialization
// and storage). Pure except loadSubstrateIds (a single target probe); unit-tested in
// company-backup.closure.test.ts. Imports one-directionally from company-backup.ts.

/** FKs to these collapse to the importing user when re-stamping a foreign backup. */
export const USER_REF_TABLES = new Set(["user", "employee"]);

export type DanglingRef = {
  table: string;
  column: string;
  refTable: string;
  /** false → restore nulls it (warning); true → NOT NULL, restore cannot resolve. */
  fatal: boolean;
  sampleValue: string;
  count: number;
};

/**
 * Find FK values that point at a scoped row the backup does NOT contain — the exact
 * gap that makes a restore dangle. A backup is "referentially closed" when this
 * returns no `fatal` entries. Pure, so the SAME check runs as a unit test AND as
 * the pre-wipe restore guard — one definition of closure, not two that can drift.
 * Skips refs to `RETAINED_REF_TABLES` (resolved by collapse/identity) and to
 * non-scoped global tables (`currency`, `country`, … — stable ids present in every
 * target), since neither is a gap.
 *
 * `knownSubstrateIds` (per table) are ids that exist in the TARGET as substrate
 * (`companyId IS NULL` global rows the backup deliberately omits — e.g. the
 * seeded `material*` reference rows). A ref resolving to one of those is NOT a
 * gap. The restore passes these from a live probe of the target; tests omit them.
 */
export function findDanglingReferences(
  catalog: Catalog,
  dataByTable: Record<string, Array<{ [col: string]: unknown }>>,
  knownSubstrateIds?: Map<string, Set<unknown>>
): DanglingRef[] {
  const catalogNames = new Set(catalog.tables.map((t) => t.name));
  // Secret tables (credentials/tokens) are never written to a backup and never
  // loaded on restore, so they can be neither a row source nor a resolvable ref
  // target here. An OLDER backup made before a table joined SECRET_TABLES may
  // still carry its rows (e.g. `apiKeyRateLimit` → the stripped `apiKey`) — those
  // are ignored on load, so the preflight must ignore them too rather than report
  // a gap that can't exist for the restore.
  const secret = new Set<string>(SECRET_TABLES);
  const idsByTable = new Map<string, Set<unknown>>();
  for (const t of catalog.tables) {
    // FKs are only ever checked against `refColumn === "id"` below, so any table
    // with an `id` column can be a referenced parent — NOT only those whose PK is
    // exactly `id` (`hasId`). Most Carbon tables key on `id` alone, but ~25 use a
    // composite `("id", "companyId")` PK (stockTransfer, supplierPart, …); gating
    // on `hasId` left those untracked, so every child row pointing at them was
    // falsely reported as dangling and refused the restore.
    if (!t.columns.some((c) => c.name === "id")) continue;
    const ids = new Set<unknown>();
    for (const row of dataByTable[t.name] ?? []) ids.add(row.id);
    idsByTable.set(t.name, ids);
  }

  const found = new Map<string, DanglingRef>();
  for (const t of catalog.tables) {
    const rows = dataByTable[t.name];
    if (!rows?.length) continue;
    if (secret.has(t.name)) continue; // not loaded → its refs are moot
    const colByName = new Map(t.columns.map((c) => [c.name, c]));
    for (const fk of t.foreignKeys) {
      if (fk.refColumn !== "id") continue;
      if (secret.has(fk.refTable)) continue; // parent never present in any backup
      if (RETAINED_REF_TABLES.has(fk.refTable)) continue;
      if (!catalogNames.has(fk.refTable)) continue; // non-scoped global → stable ids
      const col = colByName.get(fk.column);
      if (!col) continue;
      const refIds = idsByTable.get(fk.refTable) ?? new Set();
      const substrateIds = knownSubstrateIds?.get(fk.refTable);
      for (const row of rows) {
        const v = row[fk.column];
        if (v == null) continue;
        if (refIds.has(v)) continue;
        if (substrateIds?.has(v)) continue;
        const key = `${t.name}.${fk.column}->${fk.refTable}`;
        const existing = found.get(key);
        if (existing) {
          existing.count++;
        } else {
          found.set(key, {
            table: t.name,
            column: fk.column,
            refTable: fk.refTable,
            fatal: !col.isNullable,
            sampleValue: String(v),
            count: 1
          });
        }
      }
    }
  }
  return [...found.values()];
}

/**
 * Pre-wipe restore guard: refuse a backup that isn't referentially closed. A
 * NOT-NULL FK pointing at a missing row would commit under relaxed FK checks and
 * corrupt the restore, so this reports EVERY fatal gap at once — the whole list is
 * surfaced before any data is touched, instead of one throw at a time mid-load.
 */
export function assertReferentiallyClosed(
  catalog: Catalog,
  backup: CompanyBackup,
  knownSubstrateIds?: Map<string, Set<unknown>>
): { ok: true } | { ok: false; reason: string } {
  const fatal = findDanglingReferences(
    catalog,
    backup.data,
    knownSubstrateIds
  ).filter((d) => d.fatal);
  if (fatal.length === 0) return { ok: true };
  const lines = fatal
    .map(
      (d) =>
        `  ${d.table}.${d.column} → ${d.refTable} (${d.count} row${
          d.count === 1 ? "" : "s"
        }, e.g. ${d.sampleValue})`
    )
    .join("\n");
  return {
    ok: false,
    reason: `the backup is not self-contained — ${fatal.length} reference${
      fatal.length === 1 ? "" : "s"
    } point at rows it doesn't include:\n${lines}`
  };
}

/**
 * Load the TARGET's substrate ids — the `companyId IS NULL` (global) rows that a
 * company backup deliberately omits because they're seeded into every
 * environment (e.g. the global `material*` reference rows). Returns a per-table
 * `id` set for every catalog table that (a) is the target of a NOT-NULL FK from
 * data the backup carries and (b) has a direct scope column that could hold a
 * global row. A company row's FK into one of these resolves against the target's
 * own seed, not the backup — so feeding this to {@link assertReferentiallyClosed}
 * stops it flagging that legitimate cross-boundary ref, while still catching a
 * ref to a row that exists in neither the backup nor the target.
 *
 * List-free and data-driven: it probes the actual target, so it can't drift from
 * a hand-maintained set of "reference tables". Tables with no global rows simply
 * return an empty set. One query per referenced table.
 */
export async function loadSubstrateIds(
  db: Kysely<KyselyDatabase>,
  catalog: Catalog,
  dataByTable: Record<string, Array<{ [col: string]: unknown }>>
): Promise<Map<string, Set<unknown>>> {
  const byName = new Map(catalog.tables.map((t) => [t.name, t]));
  // Per ref table pointed at by a NOT-NULL FK from carried data: its scope column
  // and the distinct ids referenced (so the probe only loads ids we actually need).
  const wanted = new Map<string, { scopeColumn: string; ids: Set<unknown> }>();
  for (const t of catalog.tables) {
    const rows = dataByTable[t.name];
    if (!rows?.length) continue;
    const colByName = new Map(t.columns.map((c) => [c.name, c]));
    for (const fk of t.foreignKeys) {
      if (fk.refColumn !== "id") continue;
      const ref = byName.get(fk.refTable);
      if (!ref || ref.scope.kind !== "direct") continue; // only directly-scoped tables hold global rows
      // A NOT-NULL scope column can't contain a `companyId IS NULL` row, so the
      // probe would always be empty — skip it. (This is a sound optimization from
      // the DB constraint, NOT a guess: a non-nullable column literally cannot
      // hold the global rows we'd be looking for.)
      const refScopeCol = ref.columns.find((c) => c.name === ref.scope.column);
      if (!refScopeCol?.isNullable) continue;
      const col = colByName.get(fk.column);
      if (!col || col.isNullable) continue; // nullable → restore nulls a missing ref
      const entry = wanted.get(fk.refTable) ?? {
        scopeColumn: ref.scope.column,
        ids: new Set<unknown>()
      };
      for (const row of rows) {
        const v = row[fk.column];
        if (v != null) entry.ids.add(v);
      }
      wanted.set(fk.refTable, entry);
    }
  }

  const result = new Map<string, Set<unknown>>();
  await mapWithConcurrency([...wanted.keys()], 6, async (refTable) => {
    const { scopeColumn, ids } = wanted.get(refTable)!;
    const idList = [...ids];
    if (idList.length === 0) return;
    const present = await sql<{ id: unknown }>`
      SELECT ${sql.id("id")} AS id
      FROM ${sql.id(refTable)}
      WHERE ${sql.id(scopeColumn)} IS NULL
        AND ${sql.id("id")} IN (${sql.join(idList.map((v) => sql`${v}`))})
    `.execute(db);
    result.set(refTable, new Set(present.rows.map((r) => r.id)));
  });
  return result;
}

export type RowTransform = (value: unknown) => unknown;

/**
 * Per-column transforms for re-stamping a FOREIGN backup onto this company —
 * shared by the in-place restore (wipe + reload) and the reseed/template import
 * (additive). Every id is remapped, companyId/companyGroupId point at the target,
 * FKs follow the id remap, user refs collapse to the importing user, and storage
 * paths are rewritten. For an OWN backup (remap=false) every column is identity.
 * Pure (no DB), so it lives here with the other catalog helpers and is
 * unit-tested directly. The optional `ctx` fields are the import/reseed-only
 * policies; omit them and the behavior is the restore path's, unchanged.
 */
export function buildRowTransforms(
  table: TableInfo,
  columns: ColumnInfo[],
  ctx: {
    remap: boolean;
    companyId: string;
    userId: string;
    targetGroupId: string | null;
    sourceCompanyId: string;
    idMaps: Map<string, Map<string, string>>;
    idRewrite: Map<string, string>;
    /** Per-table ids that exist in the TARGET as shared substrate (global
     *  `companyId IS NULL` rows the backup omits). A remapped FK whose value is
     *  one of these is kept verbatim — the stable id resolves against the
     *  target's own seed. From the same probe the closure guard uses. */
    substrateIds?: Map<string, Set<unknown>>;
    /** Reseed only: an onboarding demo template references shared assets at
     *  `_templates/<industryId>/` instead of per-company files — rewrite storage
     *  paths there (ids kept) rather than to `{companyId}/`. */
    templateIndustryId?: string;
    /** Reseed only: tenant tables NOT imported (skipped/secret). A nullable FK
     *  into one is nulled — its source id has no row in the target. */
    skippedRefTables?: ReadonlySet<string>;
    /** Reseed only: names of all catalog (tenant) tables, so a FK into a tenant
     *  table that wasn't imported is distinguished from one into a global
     *  reference table (whose ids are stable and kept verbatim). */
    catalogTableNames?: ReadonlySet<string>;
    /** Reseed only: called for a NON-nullable FK whose target row is in neither
     *  the backup nor the target (a soft warning instead of the restore-path
     *  throw — the reseed surfaces the whole list afterward). */
    onUnresolvedRef?: (desc: string) => void;
    /** Reseed only: rewrite an email value (a copied template's emails never
     *  belong to the target's people). */
    scrubEmail?: (value: string) => string;
  }
): RowTransform[] {
  const identity: RowTransform = (v) => v;
  if (!ctx.remap) return columns.map(() => identity);

  const fkByColumn = new Map(table.foreignKeys.map((fk) => [fk.column, fk]));
  // A company-singleton (one row per company) keys itself by `id -> company`, so
  // its `id` IS the company id. On remap it must follow the company, not mint a
  // fresh id (which would orphan the row and dangle the id->company FK).
  const isCompanySingleton = fkByColumn.get("id")?.refTable === "company";

  const build = (col: ColumnInfo): RowTransform => {
    const fk = fkByColumn.get(col.name);
    if (col.name === "id" && isCompanySingleton) {
      return (v) => (v === ctx.sourceCompanyId ? ctx.companyId : v);
    }
    // Only id-keyed tables with a text/uuid id get an idMap (int/serial ids reuse
    // verbatim — see idMaps build). Gate on the map's presence, not `hasId`, or an
    // int-id table dereferences an undefined map.
    const idMap = ctx.idMaps.get(table.name);
    if (col.name === "id" && idMap) {
      return (v) => idMap.get(v as string) ?? v;
    }
    if (col.name === "companyId") return () => ctx.companyId;
    if (col.name === "companyGroupId") return () => ctx.targetGroupId;
    if (STORAGE_PATH_COLUMNS.has(col.name)) {
      const { sourceCompanyId, companyId, idRewrite, templateIndustryId } = ctx;
      return (v) => {
        if (typeof v !== "string") return v;
        return templateIndustryId
          ? rewriteToTemplateAssetPath(v, sourceCompanyId, templateIndustryId)
          : rewriteStoragePath(v, sourceCompanyId, companyId, idRewrite);
      };
    }
    if (fk) {
      if (USER_REF_TABLES.has(fk.refTable)) {
        return (v) => (v == null ? v : ctx.userId);
      }
      if (fk.refTable === "company") {
        return (v) => (v === ctx.sourceCompanyId ? ctx.companyId : v);
      }
      if (fk.refTable === "companyGroup") {
        return (v) => (v == null ? v : ctx.targetGroupId);
      }
      if (ctx.skippedRefTables?.has(fk.refTable) && col.isNullable) {
        return () => null;
      }
      if (fk.refColumn === "id") {
        const map = ctx.idMaps.get(fk.refTable);
        const substrate = ctx.substrateIds?.get(fk.refTable);
        // A "tenant" ref needs a row in the target (its id was/should-be
        // remapped); a global-reference ref (country, currency, …) has stable
        // ids kept verbatim. Map presence proves tenant; catalogTableNames
        // (reseed) also flags a tenant table that simply wasn't imported here.
        const isTenantRef =
          map !== undefined ||
          (ctx.catalogTableNames?.has(fk.refTable) ?? false);
        if (!map && !substrate && !isTenantRef) return identity;
        const refTable = fk.refTable;
        const colName = col.name;
        const nullable = col.isNullable;
        const onUnresolvedRef = ctx.onUnresolvedRef;
        return (v) => {
          if (v == null) return v;
          const mapped = map?.get(v as string);
          if (mapped) return mapped;
          if (substrate?.has(v)) return v;
          if (!isTenantRef) return v; // global-reference id, stable across envs
          // A tenant row in neither the backup nor the target.
          if (nullable) return null;
          if (onUnresolvedRef) {
            onUnresolvedRef(`${table.name}.${colName} -> ${refTable}`);
            return v;
          }
          throw new Error(
            `Backup is inconsistent: ${table.name}.${colName} references a ` +
              `${refTable} (${String(v)}) that isn't in the backup or the target.`
          );
        };
      }
    }
    return identity;
  };

  return columns.map((col) => {
    const base = build(col);
    if (ctx.scrubEmail && /email/i.test(col.name)) {
      const scrub = ctx.scrubEmail;
      return (v) => {
        const value = base(v);
        return typeof value === "string" && value.includes("@")
          ? scrub(value)
          : value;
      };
    }
    return base;
  });
}
