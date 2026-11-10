// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { KyselyDatabase } from "@carbon/database/client";
import {
  CHANGE_LOGGED_TABLES,
  REALTIME_TABLES
} from "@carbon/database/realtime-tables";
import { getLogger } from "@carbon/logger";
import { chunkArray } from "@carbon/utils";
import { type Kysely, sql } from "kysely";
import type { JobDatabase } from "../db";
import type { Catalog, TableInfo } from "./catalog";
import { groupConflictClause, rebuildDerivedGroups } from "./derived-groups";
import { bindValue, type CompanyBackup } from "./format";
import {
  assertWipeSafe,
  isUserScopedIdentityTable,
  selectWipeableTables
} from "./policy";
import { buildIdMaps, buildRowTransforms, flattenIdMaps } from "./remap";
import { applyTableRenames } from "./renames";
import type { JobProgress } from "./runs";
import { buildScopeFilter, deleteDanglingRows } from "./scope";
import { readBackup } from "./storage";

const log = getLogger("jobs", "backup-load");

type ServiceRole = ReturnType<typeof getCarbonServiceRole>;

/**
 * Loading a backup into a company: the scoped wipe, the insert loop and the one
 * load transaction. Restore, import and revert load through here; the company
 * purge reuses the wipe.
 */

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
 * Delete every row of the given tables for one company, in REVERSE topological
 * order (children before parents) so FK constraints hold by construction.
 * `tables` is expected in catalog (referenced-first) order. Run inside the
 * caller's transaction, ideally with `session_replication_role = 'replica'` set.
 */
export async function wipeScopedData(
  trx: Kysely<KyselyDatabase>,
  tables: TableInfo[],
  byName: Map<string, TableInfo>,
  scope: { companyId: string; companyGroupId: string | null },
  onProgress?: (done: number, total: number) => Promise<void>
): Promise<void> {
  const ordered = [...tables].reverse();
  for (let i = 0; i < ordered.length; i++) {
    const table = ordered[i]!;
    // A null companyGroupId yields `= NULL` (no match), so group data is left
    // untouched when the company has no group.
    await sql`
      DELETE FROM ${sql.id(table.name)}
      WHERE ${buildScopeFilter(table, byName, scope.companyId, scope.companyGroupId)}
    `.execute(trx);
    await onProgress?.(i + 1, ordered.length);
  }
}

const INSERT_CHUNK_SIZE = 200;

type RemapContext = Omit<Parameters<typeof buildRowTransforms>[2], "remap">;

/**
 * Insert a backup's rows, table by table in the given (catalog) order. With no
 * `remap` the rows go in verbatim; with one, every value passes its column's
 * transform, and a table keyed by a user keeps the first of the rows that the
 * transform collapsed onto one user. Returns the rows inserted per table.
 */
export async function insertTables(
  trx: Kysely<KyselyDatabase>,
  tables: TableInfo[],
  backup: CompanyBackup,
  remap: RemapContext | null,
  onProgress?: (done: number, total: number) => Promise<void>
): Promise<Record<string, number>> {
  const backupColumns = new Map(
    backup.manifest.tables.map((t) => [t.name, new Set(t.columns)])
  );
  const counts: Record<string, number> = {};
  for (let t = 0; t < tables.length; t++) {
    const table = tables[t]!;
    const sourceRows = backup.data[table.name] ?? [];
    const backupCols =
      backupColumns.get(table.name) ??
      new Set(Object.keys(sourceRows[0] ?? {}));
    const columns = table.columns.filter(
      (c) => !c.isGenerated && backupCols.has(c.name)
    );
    if (columns.length === 0 || sourceRows.length === 0) continue;

    // Hot path: indexed loops, and `out` keys in a fixed column order so every
    // row of a table shares one hidden class.
    const colCount = columns.length;
    let rows: Record<string, unknown>[] = [];
    if (remap) {
      const transforms = buildRowTransforms(table, columns, remap);
      for (let r = 0; r < sourceRows.length; r++) {
        const row = sourceRows[r]!;
        const out: Record<string, unknown> = {};
        for (let c = 0; c < colCount; c++) {
          out[columns[c]!.name] = transforms[c]!(row[columns[c]!.name]);
        }
        rows.push(out);
      }
      if (!table.hasId && table.pkColumns.length > 0) {
        const seen = new Set<string>();
        rows = rows.filter((row) => {
          const key = JSON.stringify(table.pkColumns.map((c) => row[c]));
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }
    } else {
      for (let r = 0; r < sourceRows.length; r++) {
        const row = sourceRows[r]!;
        const out: Record<string, unknown> = {};
        for (let c = 0; c < colCount; c++) {
          const name = columns[c]!.name;
          out[name] = row[name];
        }
        rows.push(out);
      }
    }

    for (const batch of chunkArray(rows, INSERT_CHUNK_SIZE)) {
      await sql`
        INSERT INTO ${sql.id(table.name)}
          (${sql.join(columns.map((c) => sql.id(c.name)))})
        VALUES ${sql.join(
          batch.map(
            (row) =>
              sql`(${sql.join(
                columns.map((c) => sql`${bindValue(row[c.name], c)}`)
              )})`
          )
        )}${groupConflictClause(table.name)}
      `.execute(trx);
    }
    counts[table.name] = rows.length;
    await onProgress?.(t + 1, tables.length);
  }
  return counts;
}

/**
 * Run a bulk load of one company's data in a single transaction, with triggers
 * and FK checks off where this connection may turn them off. Then do what the
 * triggers would have done: rebuild the derived groups, and tell open clients
 * that every list changed.
 */
export async function bulkLoad<T>(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  load: (trx: Kysely<KyselyDatabase>) => Promise<T>
): Promise<T> {
  const replicaMode = await canSetReplicationRole(db);
  if (!replicaMode) {
    log.warn(
      "session_replication_role unavailable: loading with triggers and FK " +
        "enforcement on, relying on topological order",
      { companyId }
    );
  }

  return db.transaction().execute(async (trx) => {
    if (replicaMode) {
      await sql`SET LOCAL session_replication_role = 'replica'`.execute(trx);
    }

    // The company's groups before the load: memberships survive an own
    // restore, and any left pointing at a group that doesn't come back go.
    const groupsBefore = await trx
      .selectFrom("group")
      .select("id")
      .where("companyId", "=", companyId)
      .execute();

    const result = await load(trx);

    await rebuildDerivedGroups(
      trx,
      companyId,
      groupsBefore.map((g) => g.id)
    );

    // With triggers off nothing logged the change: a null row id tells a client
    // to read the whole table again.
    await trx
      .insertInto("tableChange")
      .values(
        CHANGE_LOGGED_TABLES.map((table) => ({ companyId, table, rowId: null }))
      )
      .execute();

    // The log only answers a client that asks, and an open tab asks when a
    // broadcast tells it to. With triggers off none was sent: after a template
    // was reverted, a tab kept the reverted parts in its pickers for up to an
    // hour, and creating a job with one of them failed. Sent with the
    // transaction, so nothing hears of a load that rolled back.
    const realtime = await sql<{ present: boolean }>`
      SELECT to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL AS present
    `.execute(trx);
    if (realtime.rows[0]?.present) {
      await sql`
        SELECT realtime.send(
          jsonb_build_object('table', t, 'op', 'UPDATE', 'ids', NULL, 'parents', NULL),
          'UPDATE',
          'company:' || ${companyId} || ':' || t,
          true
        )
        FROM unnest(${[...REALTIME_TABLES]}::text[]) AS t
      `.execute(trx);
    }
    return result;
  });
}

/**
 * Wipe the company's restorable tables and reload them from `backup`. Two modes:
 * - no `remap` (own backup / snapshot): ids and scope already belong to this
 *   company, so rows load verbatim.
 * - `remap` (foreign backup): the data belongs to another company, so every
 *   id is remapped and companyId/group/FKs are re-stamped onto this company —
 *   including the chart of accounts (group-scoped), which is why `includeGroup`
 *   is set for foreign restores.
 */
export async function wipeAndLoad(
  db: JobDatabase,
  catalog: Catalog,
  backup: CompanyBackup,
  opts: {
    companyId: string;
    includeGroup: boolean;
    targetGroupId: string | null;
    /** A foreign backup: the importing user, and the target's substrate ids
     *  (global rows the backup omits), so a FK into a seeded global row is kept
     *  verbatim instead of treated as a dangling gap. */
    remap: { userId: string; substrateIds: Map<string, Set<unknown>> } | null;
    /** Live phase progress (`wipe` then `load`). Throttled by the caller. */
    onProgress?: (p: JobProgress) => Promise<void>;
  }
): Promise<{ rows: number; idRewrite: Map<string, string> }> {
  const { companyId, remap, includeGroup, targetGroupId, onProgress } = opts;

  const safe = assertWipeSafe(catalog);
  if (!safe.ok) {
    throw new Error(`Restore is unsafe for this schema: ${safe.reason}.`);
  }

  // Wipe every restorable table (so tables empty in the backup end up empty);
  // reload only those the backup actually has rows for. On a foreign restore the
  // wipe set also includes user-scoped identity tables (so their stale rows can't
  // dangle at remapped parents — cascade won't clear them under replica mode), but
  // they are NEVER reloaded: their source rows belong to the source's users.
  const byName = new Map(catalog.tables.map((t) => [t.name, t]));
  const wipeTables = selectWipeableTables(catalog, { includeGroup });
  const loadTables = wipeTables.filter(
    (t) =>
      !(remap && isUserScopedIdentityTable(t)) &&
      (backup.data[t.name]?.length ?? 0) > 0
  );

  // Foreign: assign a fresh id to every id-bearing row up front so FKs (and the
  // ids embedded in storage paths) can be rewritten in a single pass. See
  // `buildIdMaps` for what qualifies and why.
  const keptEmployeeTypes = remap
    ? await db
        .selectFrom("employeeType")
        .select(["id", "name"])
        .where("companyId", "=", companyId)
        .execute()
    : [];
  const idMaps = remap
    ? buildIdMaps(loadTables, backup.data, {
        source: backup.manifest.sourceCompanyId,
        target: companyId,
        employeeTypeIdsByName: new Map(
          keptEmployeeTypes.map((t) => [t.name, t.id])
        )
      })
    : new Map<string, Map<string, string>>();
  const idRewrite = flattenIdMaps(idMaps);

  const counts = await bulkLoad(db, companyId, async (trx) => {
    await onProgress?.({ phase: "wipe", done: 0, total: wipeTables.length });
    await wipeScopedData(
      trx,
      wipeTables,
      byName,
      { companyId, companyGroupId: targetGroupId },
      onProgress
        ? (done, total) => onProgress({ phase: "wipe", done, total })
        : undefined
    );

    const counts = await insertTables(
      trx,
      loadTables,
      backup,
      remap
        ? {
            ...remap,
            companyId,
            targetGroupId,
            sourceCompanyId: backup.manifest.sourceCompanyId,
            idMaps,
            idRewrite
          }
        : null,
      onProgress
        ? (done, total) => onProgress({ phase: "load", done, total })
        : undefined
    );

    // Kept identity rows whose parent the wipe removed (replica mode skipped the
    // cascade) would fail every later export. A foreign restore already wiped them.
    if (!remap) {
      const dangling = await deleteDanglingRows(
        trx,
        catalog.tables.filter(
          (t) => isUserScopedIdentityTable(t) && t.scopeColumn === "companyId"
        ),
        byName,
        companyId,
        targetGroupId
      );
      if (dangling.length > 0) {
        log.warn("Restore: removed identity rows left dangling by the wipe", {
          companyId,
          deleted: dangling
        });
      }
    }
    return counts;
  });

  const rows = Object.values(counts).reduce((sum, n) => sum + n, 0);
  return { rows, idRewrite };
}

/**
 * Read a backup folder under today's table names. A backup — a snapshot too —
 * can predate a migration that renamed a table, so every load reads through here.
 */
export async function readBackupForLoad(
  client: ServiceRole,
  companyId: string,
  name: string,
  catalog: Catalog
): Promise<CompanyBackup> {
  return applyTableRenames(catalog, await readBackup(client, companyId, name));
}

export async function getCompanyGroupId(
  client: ServiceRole,
  companyId: string
): Promise<string | null> {
  const company = await client
    .from("company")
    .select("companyGroupId")
    .eq("id", companyId)
    .single();
  if (company.error) throw new Error(company.error.message);
  return company.data?.companyGroupId ?? null;
}

/**
 * Which scope a wipe-and-load should cover for this company. Group-scoped data
 * (chart of accounts, currencies, dimensions) is shared by every company in the
 * group, so we only wipe/reload it when this company is the group's SOLE member —
 * then the group is effectively this company's. In a multi-company group it is
 * left untouched and managed at the group level.
 */
export async function resolveRestoreScope(
  client: ServiceRole,
  companyId: string
): Promise<{ targetGroupId: string | null; includeGroup: boolean }> {
  const targetGroupId = await getCompanyGroupId(client, companyId);
  if (!targetGroupId) return { targetGroupId, includeGroup: false };
  const members = await client
    .from("company")
    .select("id", { count: "exact", head: true })
    .eq("companyGroupId", targetGroupId);
  if (members.error) throw new Error(members.error.message);
  return { targetGroupId, includeGroup: members.count === 1 };
}
