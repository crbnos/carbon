// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { randomUUID } from "node:crypto";
import type { KyselyDatabase } from "@carbon/database/client";
import {
  groups as companyGroups,
  getGroupId
} from "@carbon/database/seed-data";
import {
  rewriteValueEditRowKeys,
  type ValueEdits
} from "@carbon/documents/template";
import { async } from "@carbon/utils";
import { type Kysely, sql } from "kysely";
import { customAlphabet } from "nanoid";
import {
  type Catalog,
  type ColumnInfo,
  idForeignKeyByColumn,
  type TableInfo
} from "./catalog";
import { TABLE_CONCURRENCY } from "./concurrency";
import { type CompanyBackup, type Row, tableRows } from "./format";
import { ID_REF_COLUMNS, ROW_ID_REF_COLUMNS } from "./id-refs";
import {
  isCrossTenantEdge,
  isSecretTable,
  READABLE_ID_TABLES,
  RETAINED_REF_TABLES,
  USER_REF_TABLES
} from "./policy";
import { anyOf, parentExistence } from "./scope";

/**
 * Re-stamping a backup's rows onto another company: fresh ids, FKs and FK-less
 * id refs following them, user refs collapsed onto the importing user,
 * storage paths rewritten, and the referential-closure check that refuses a
 * backup that would dangle.
 */

type DanglingRef = {
  table: string;
  column: string;
  refTable: string;
  /** false → restore nulls it (warning); true → NOT NULL, restore cannot resolve. */
  fatal: boolean;
  sampleValue: string;
  count: number;
};

/**
 * What the preflight and the id maps need from a backup, without its rows: the
 * ids of each table, the distinct values of every id foreign key with how many
 * rows hold each, and the small `group` table. Built while the rows stream.
 */
export type BackupScan = {
  /** Tables the backup has rows for. */
  tables: Set<string>;
  ids: Map<string, Set<unknown>>;
  /** `table.column` → value → rows holding it. */
  refs: Map<string, Map<unknown, number>>;
  groupRows: Row[];
};

/**
 * Collects a scan from batches. Keeps the ids of every table a foreign key
 * points at, or of every id-bearing table with `allIds` (a foreign load gives
 * each row a new id). Secret tables are never loaded, so they are skipped.
 */
function scanCollector(tables: TableInfo[], opts: { allIds: boolean }) {
  const referenced = new Set(
    tables.flatMap((t) =>
      t.foreignKeys.filter((f) => f.refColumn === "id").map((f) => f.refTable)
    )
  );
  const scan: BackupScan = {
    tables: new Set(),
    ids: new Map(),
    refs: new Map(),
    groupRows: []
  };
  const add = (table: TableInfo, rows: Row[]) => {
    if (rows.length === 0 || isSecretTable(table.name)) return;
    scan.tables.add(table.name);
    if (table.name === "group") scan.groupRows.push(...rows);
    if (
      (opts.allIds || referenced.has(table.name)) &&
      table.columns.some((c) => c.name === "id")
    ) {
      const ids = scan.ids.get(table.name) ?? new Set<unknown>();
      for (const row of rows) ids.add(row.id);
      scan.ids.set(table.name, ids);
    }
    for (const fk of table.foreignKeys) {
      if (fk.refColumn !== "id") continue;
      const key = `${table.name}.${fk.column}`;
      const counts = scan.refs.get(key) ?? new Map<unknown, number>();
      for (const row of rows) {
        const v = row[fk.column];
        if (v != null) counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      scan.refs.set(key, counts);
    }
  };
  return { scan, add };
}

/** Scan a backup, one table at a time. */
export async function scanBackup(
  catalog: Catalog,
  backup: CompanyBackup,
  opts: { allIds: boolean }
): Promise<BackupScan> {
  const { scan, add } = scanCollector(catalog.tables, opts);
  await async.map(
    catalog.tables.filter((t) => tableRows(backup, t.name) > 0),
    async (table) => {
      for await (const batch of backup.rows(table.name)) add(table, batch);
    },
    { concurrency: TABLE_CONCURRENCY }
  );
  return scan;
}

/** Scan rows already in memory. */
export function scanRows(
  tables: TableInfo[],
  dataByTable: Record<string, Row[]>,
  opts: { allIds: boolean } = { allIds: true }
): BackupScan {
  const { scan, add } = scanCollector(tables, opts);
  for (const table of tables) add(table, dataByTable[table.name] ?? []);
  return scan;
}

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
 *
 * `groupLoaded: false` (an own restore into a group shared with other
 * companies): the group's tables are not loaded, so the backup's chart of
 * accounts proves nothing — a ref into it resolves only against the live
 * group's rows, which `loadSubstrateIds` with `liveGroup` puts in
 * `knownSubstrateIds`.
 */
export function findDanglingReferences(
  catalog: Catalog,
  scan: BackupScan,
  knownSubstrateIds?: Map<string, Set<unknown>>,
  opts: { groupLoaded?: boolean } = {}
): DanglingRef[] {
  const byName = new Map(catalog.tables.map((t) => [t.name, t]));
  const notLoaded = (name: string) =>
    opts.groupLoaded === false &&
    byName.get(name)?.scopeColumn === "companyGroupId";
  const found = new Map<string, DanglingRef>();
  for (const t of catalog.tables) {
    if (!scan.tables.has(t.name) || notLoaded(t.name)) continue;
    const colByName = new Map(t.columns.map((c) => [c.name, c]));
    for (const fk of t.foreignKeys) {
      if (fk.refColumn !== "id") continue;
      if (isSecretTable(fk.refTable)) continue; // parent never present in any backup
      if (RETAINED_REF_TABLES.has(fk.refTable)) continue;
      if (!byName.has(fk.refTable)) continue; // non-scoped global → stable ids
      if (isCrossTenantEdge(t.name, fk.column)) continue;
      const col = colByName.get(fk.column);
      const values = scan.refs.get(`${t.name}.${fk.column}`);
      if (!col || !values) continue;
      const refIds = notLoaded(fk.refTable)
        ? new Set()
        : (scan.ids.get(fk.refTable) ?? new Set());
      const substrateIds = knownSubstrateIds?.get(fk.refTable);
      for (const [v, count] of values) {
        if (refIds.has(v)) continue;
        if (substrateIds?.has(v)) continue;
        const key = `${t.name}.${fk.column}->${fk.refTable}`;
        const existing = found.get(key);
        if (existing) {
          existing.count += count;
        } else {
          found.set(key, {
            table: t.name,
            column: fk.column,
            refTable: fk.refTable,
            fatal: !col.isNullable,
            sampleValue: String(v),
            count
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
  scan: BackupScan,
  knownSubstrateIds?: Map<string, Set<unknown>>,
  opts: { groupLoaded?: boolean } = {}
): { ok: true } | { ok: false; reason: string } {
  const fatal = findDanglingReferences(
    catalog,
    scan,
    knownSubstrateIds,
    opts
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
 * `id` set for every catalog table that (a) is the target of an FK from data the
 * backup carries — nullable too, or a foreign load would clear a valid optional
 * ref like `material.gradeId` — and (b) has a direct scope column that could
 * hold a global row. A company row's FK into one of these resolves against the target's
 * own seed, not the backup — so feeding this to {@link assertReferentiallyClosed}
 * stops it flagging that legitimate cross-boundary ref, while still catching a
 * ref to a row that exists in neither the backup nor the target.
 *
 * List-free and data-driven: it probes the actual target, so it can't drift from
 * a hand-maintained set of "reference tables". Tables with no global rows simply
 * return an empty set. One query per referenced table.
 *
 * `liveGroup`: the group's tables are NOT loaded (an own restore into a group
 * other companies share), so a ref into one resolves against the live group's
 * rows, nullable or not — those ids are returned as present too.
 */
export async function loadSubstrateIds(
  db: Kysely<KyselyDatabase>,
  catalog: Catalog,
  scan: BackupScan,
  opts: {
    liveGroup?: { companyId: string; companyGroupId: string | null };
  } = {}
): Promise<Map<string, Set<unknown>>> {
  const byName = new Map(catalog.tables.map((t) => [t.name, t]));
  const { liveGroup } = opts;
  const isLive = (table: TableInfo) =>
    liveGroup !== undefined && table.scopeColumn === "companyGroupId";
  const wanted = new Map<string, Set<unknown>>();
  for (const t of catalog.tables) {
    if (!scan.tables.has(t.name) || isLive(t)) continue;
    const colByName = new Map(t.columns.map((c) => [c.name, c]));
    for (const fk of t.foreignKeys) {
      if (fk.refColumn !== "id") continue;
      const ref = byName.get(fk.refTable);
      const col = colByName.get(fk.column);
      if (!ref || !col) continue;
      if (!isLive(ref)) {
        if (ref.scope.kind !== "direct") continue; // only directly-scoped tables hold global rows
        // A NOT-NULL scope column can't contain a `companyId IS NULL` row, so the
        // probe would always be empty.
        const refScopeCol = ref.columns.find(
          (c) => c.name === ref.scope.column
        );
        if (!refScopeCol?.isNullable) continue;
      }
      const ids = wanted.get(fk.refTable) ?? new Set<unknown>();
      for (const v of scan.refs.get(`${t.name}.${fk.column}`)?.keys() ?? []) {
        ids.add(v);
      }
      wanted.set(fk.refTable, ids);
    }
  }

  const result = new Map<string, Set<unknown>>();
  await async.map(
    [...wanted.keys()],
    async (refTable) => {
      const ref = byName.get(refTable)!;
      const idList = [...wanted.get(refTable)!];
      if (idList.length === 0) return;
      const where =
        liveGroup && isLive(ref)
          ? parentExistence(
              ref,
              byName,
              liveGroup.companyId,
              liveGroup.companyGroupId
            )
          : sql`${sql.id(ref.scope.column)} IS NULL`;
      const present = await sql<{ id: unknown }>`
      SELECT ${sql.id("id")} AS id
      FROM ${sql.id(refTable)}
      WHERE (${where})
        AND ${anyOf(
          "id",
          idList,
          ref.columns.find((c) => c.name === "id")?.udtName
        )}
    `.execute(db);
      result.set(refTable, new Set(present.rows.map((r) => r.id)));
    },
    { concurrency: TABLE_CONCURRENCY }
  );
  return result;
}

/**
 * Assign a fresh id to every row of every id-bearing table, so a foreign load can
 * rewrite ids and the FKs pointing at them in one pass. Shared by the restore and
 * the reseed/import so the two can't drift.
 *
 * Keyed on having a text/uuid `id` COLUMN, not on `hasId` (PK exactly `id`): ~25
 * Carbon tables key on `("id", "companyId")` yet still carry a global `UNIQUE (id)`
 * so children can FK to them, and gating on `hasId` left their source ids in place —
 * which collides with the source company's own live rows on a cross-company restore.
 * Int/serial ids are still skipped (a generated id doesn't fit, and the table is wiped
 * first so the original values are free to reuse verbatim).
 *
 * A 1:1 extension table keys itself BY its parent (`purchaseOrderDelivery.id ->
 * purchaseOrder.id`, `partner.id -> supplierLocation.id`), so it SHARES the parent's
 * map rather than minting its own — two independent ids would split the pair and
 * `session_replication_role='replica'` would let the break commit. `tables` must be
 * topologically sorted (parents first); both call sites derive from the sorted catalog.
 */
export function buildIdMaps(
  tables: TableInfo[],
  scan: BackupScan,
  companies?: GroupRemap
): Map<string, Map<string, string>> {
  const idMaps = new Map<string, Map<string, string>>();
  let groupTable: TableInfo | undefined;
  for (const table of tables) {
    // Mapped last: a derived group takes the new id of the row it mirrors.
    if (table.name === "group") {
      groupTable = table;
      continue;
    }
    // A readable-id table's `id` is a part number other rows match by value
    // (`item."readableId"`), not an identifier — minting a fresh one orphans
    // every row from its item. Skipped in BOTH the restore and the reseed/import
    // path: the restore wipes the target first so the original values are free,
    // and on an additive reseed a genuine duplicate hits the composite PK and
    // fails loudly rather than silently corrupting the readable key.
    if (READABLE_ID_TABLES.has(table.name)) continue;
    const idType = table.columns.find((c) => c.name === "id")?.udtName;
    if (idType !== "uuid" && idType !== "text") continue;
    const idFk = table.foreignKeys.find(
      (f) => f.column === "id" && f.refColumn === "id"
    );
    if (idFk) {
      // No parent map (`terms.id -> company`, `employeeJob.id -> user`) means the
      // id follows a column transform instead, so leave it unmapped.
      const parent = idMaps.get(idFk.refTable);
      if (parent) idMaps.set(table.name, parent);
      continue;
    }
    const map = new Map<string, string>();
    for (const id of scan.ids.get(table.name) ?? []) {
      if (typeof id === "string") map.set(id, newIdForTable(table));
    }
    idMaps.set(table.name, map);
  }
  if (groupTable) {
    idMaps.set(
      "group",
      mapGroupIds(groupTable, scan.groupRows, idMaps, companies)
    );
  }
  return idMaps;
}

/**
 * Groups the database derives from another row (`sync_create_*_group`): the
 * group's id IS that row's id, which is how a membership, an approver group or
 * a notification group reaches the customer, supplier or type behind it.
 */
const MIRRORED_GROUPS = [
  ["isCustomerOrgGroup", "customer"],
  ["isSupplierOrgGroup", "supplier"],
  ["isCustomerTypeGroup", "customerType"],
  ["isSupplierTypeGroup", "supplierType"],
  ["isEmployeeTypeGroup", "employeeType"]
] as const;

/** What a foreign load needs to give a backup's groups their target ids. */
type GroupRemap = {
  source: string;
  target: string;
  /** The target's own employee types by name: a restore keeps them, so the
   *  backup's employee type groups map onto the same-named kept type. */
  employeeTypeIdsByName?: ReadonlyMap<string, string>;
};

/**
 * New ids for a foreign backup's groups. A derived group follows the row it
 * mirrors, an employee type group the same-named kept type, and a company-wide
 * group the target company, so the ids stay equal to what the database derives
 * and approver or notification groups naming them stay connected; a group of
 * the person's own gets a fresh id. One with nothing to follow gets a fresh id
 * too, and `rebuildDerivedGroups` removes it after the load.
 */
function mapGroupIds(
  table: TableInfo,
  rows: Array<{ [col: string]: unknown }>,
  idMaps: Map<string, Map<string, string>>,
  companies?: GroupRemap
): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    if (typeof row.id !== "string") continue;
    const id = row.id;
    const companyWide = companies
      ? companyGroups.find(
          (g) => id === getGroupId(g.idPrefix, companies.source)
        )
      : undefined;
    const mirrored =
      MIRRORED_GROUPS.map(([flag, entity]) =>
        row[flag] === true ? idMaps.get(entity)?.get(id) : undefined
      ).find(Boolean) ??
      (row.isEmployeeTypeGroup === true && typeof row.name === "string"
        ? companies?.employeeTypeIdsByName?.get(row.name)
        : undefined);
    map.set(
      id,
      companyWide && companies
        ? getGroupId(companyWide.idPrefix, companies.target)
        : (mirrored ?? newIdForTable(table))
    );
  }
  return map;
}

/** Old id → new id across every remapped table, for ids held outside a FK
 *  (storage paths, generic refs). */
export function flattenIdMaps(
  idMaps: Map<string, Map<string, string>>
): Map<string, string> {
  const idRewrite = new Map<string, string>();
  for (const map of idMaps.values()) {
    for (const [oldId, newId] of map) idRewrite.set(oldId, newId);
  }
  return idRewrite;
}

type RowTransform = (value: unknown) => unknown;

/**
 * Per-column transforms for re-stamping a FOREIGN backup onto this company —
 * shared by the in-place restore (wipe + reload) and the reseed/template import
 * (additive). Every id is remapped, companyId/companyGroupId point at the target,
 * FKs follow the id remap, user refs collapse to the importing user, and storage
 * paths are rewritten. An own backup needs none of this: it loads verbatim.
 * The optional `ctx` fields are the import-only policies; omit them and the
 * behavior is the restore path's.
 */
export function buildRowTransforms(
  table: TableInfo,
  columns: ColumnInfo[],
  ctx: {
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
  const fkByColumn = idForeignKeyByColumn(table);
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
    // verbatim — see `buildIdMaps`). Gate on the map's presence, not `hasId`, or an
    // int-id table dereferences an undefined map.
    const idMap = ctx.idMaps.get(table.name);
    if (col.name === "id" && idMap) {
      return (v) => idMap.get(v as string) ?? v;
    }
    if (col.name === "companyId") return () => ctx.companyId;
    if (col.name === "companyGroupId") return () => ctx.targetGroupId;
    if (table.name === "documentEdit" && col.name === "settings") {
      return (v) => rewriteDocumentEditRowKeys(v, ctx.idRewrite);
    }
    if (table.name === "trackedEntity" && col.name === "attributes") {
      return (v) => rewriteTrackedEntityReceiptRefs(v, ctx.idRewrite);
    }
    if (!fk && ID_REF_COLUMNS[table.name]?.includes(col.name)) {
      const { idRewrite } = ctx;
      const unmapped =
        col.isNullable && ROW_ID_REF_COLUMNS[table.name]?.includes(col.name)
          ? () => null
          : (id: string) => id;
      const rewrite = (id: unknown) =>
        typeof id === "string" ? (idRewrite.get(id) ?? unmapped(id)) : id;
      return (v) => (Array.isArray(v) ? v.map(rewrite) : rewrite(v));
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
          if (!isTenantRef) return v;
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
    // A storage path is any text value under the source company's folder,
    // whatever the column is called (`document.path`, `supplier.logo`,
    // `supplierQuote.sharedFilePaths`, …), or a link to one inside rich text.
    // The files are copied with the same rewrite, so path and file stay together.
    const paths = (v: string) =>
      rewriteEmbeddedPaths(
        v,
        ctx.sourceCompanyId,
        ctx.companyId,
        ctx.idRewrite
      );
    if (col.udtName === "text" || col.udtName === "_text") {
      const rewrite = (v: unknown) => (typeof v === "string" ? paths(v) : v);
      return (v) => (Array.isArray(v) ? v.map(rewrite) : rewrite(v));
    }
    // JSON holds ids no FK can see (`methodMaterial.storageUnitIds` maps a
    // location id to a storage unit id; a baseline snapshot names elements) and
    // rich text linking stored files. A remapped id is a random token, so any
    // key or string equal to one is that row.
    if (col.udtName === "jsonb" || col.udtName === "json") {
      const { idRewrite } = ctx;
      const rewrite = (v: unknown): unknown => {
        if (typeof v === "string") return idRewrite.get(v) ?? paths(v);
        if (Array.isArray(v)) return v.map(rewrite);
        if (v && typeof v === "object") {
          const out: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(v)) {
            out[idRewrite.get(key) ?? key] = rewrite(value);
          }
          return out;
        }
        return v;
      };
      return rewrite;
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

/** A received unit names its receipt and line in `attributes`, which no FK can remap. */
export function rewriteTrackedEntityReceiptRefs(
  attributes: unknown,
  idRewrite: ReadonlyMap<string, string>
): unknown {
  const parsed =
    typeof attributes === "string" ? JSON.parse(attributes) : attributes;
  if (!parsed || typeof parsed !== "object") return attributes;
  const next = { ...(parsed as Record<string, unknown>) };
  let changed = false;
  for (const key of ["Receipt", "Receipt Line"]) {
    const remapped =
      typeof next[key] === "string" ? idRewrite.get(next[key]) : undefined;
    if (remapped) {
      next[key] = remapped;
      changed = true;
    }
  }
  if (!changed) return attributes;
  return typeof attributes === "string" ? JSON.stringify(next) : next;
}

/** A document's changed row values are keyed by record ids that a restore changes. */
export function rewriteDocumentEditRowKeys(
  settings: unknown,
  idRewrite: ReadonlyMap<string, string>
): unknown {
  const parsed = typeof settings === "string" ? JSON.parse(settings) : settings;
  const edits = (parsed as { valueEdits?: ValueEdits } | null)?.valueEdits;
  if (!edits?.rows) return settings;
  const next = {
    ...(parsed as object),
    valueEdits: rewriteValueEditRowKeys(edits, (id) => idRewrite.get(id) ?? id)
  };
  return typeof settings === "string" ? JSON.stringify(next) : next;
}

/**
 * Rewrite a storage path for the target company. Swaps the leading
 * `{sourceCompanyId}/` and any path segment whose id was remapped
 * (e.g. `{co}/models/{modelId}.stl`, `{co}/thumbnails/{itemId}/{file}`). A
 * no-op for an own load (same company, empty `idRewrite`). The same function
 * is applied to both the copied file path and the DB path columns so they
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
 * Rewrite every storage path under the source company's folder inside a text
 * value: the whole value when it IS a path (a file name may hold spaces), else
 * each one embedded in a URL, such as `/file/preview/private/{company}/…` in
 * rich text, up to the next character a URL can't hold unescaped.
 */
export function rewriteEmbeddedPaths(
  value: string,
  sourceCompanyId: string,
  targetCompanyId: string,
  idRewrite: Map<string, string>
): string {
  const prefix = `${sourceCompanyId}/`;
  if (value.startsWith(prefix)) {
    return rewriteStoragePath(
      value,
      sourceCompanyId,
      targetCompanyId,
      idRewrite
    );
  }
  if (!value.includes(prefix)) return value;
  const embedded = new RegExp(
    `(?<=/)${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\s"'<>()\\[\\]{}?#,;]*`,
    "g"
  );
  return value.replace(embedded, (path) =>
    rewriteStoragePath(path, sourceCompanyId, targetCompanyId, idRewrite)
  );
}

/** Base58, as the SQL `id()` default writes ids (`projects.service.ts` copies do the same). */
const base58Id = customAlphabet(
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz",
  22
);

/**
 * A fresh primary-key value shaped like the one the schema's default writes: a
 * UUID for a `uuid` column, `item_<base58>` for one defaulting to `id('item')`.
 */
function newIdForTable(table: TableInfo): string {
  const idCol = table.columns.find((c) => c.name === "id");
  if (idCol?.udtName === "uuid") return randomUUID();
  return idCol?.idPrefix ? `${idCol.idPrefix}_${base58Id()}` : base58Id();
}
