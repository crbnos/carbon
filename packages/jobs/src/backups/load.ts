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
import { buildIdMaps, buildRowTransforms } from "./remap";
import type { JobProgress } from "./runs";
import { buildScopeFilter, deleteDanglingRows } from "./scope";

const log = getLogger("jobs", "backup-load");

type ServiceRole = ReturnType<typeof getCarbonServiceRole>;

/**
 * Loading a backup into a company: the scoped wipe and the one transaction that
 * wipes and reloads it, used by restore, both reverts and the template revert.
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
 * `tables` is expected in catalog (referenced-first) order; this reverses it.
 * Each table is scoped by its own column — companyId-scoped by `companyId`,
 * companyGroupId-scoped by `companyGroupId`. Run inside the caller's
 * transaction, ideally with `session_replication_role = 'replica'` set.
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
    // buildScopeFilter scopes by parent FK for `via` tables; a null
    // companyGroupId yields `= NULL` (no match), so group data is left untouched
    // when the company has no group.
    await sql`
      DELETE FROM ${sql.id(table.name)}
      WHERE ${buildScopeFilter(table, byName, scope.companyId, scope.companyGroupId)}
    `.execute(trx);
    await onProgress?.(i + 1, ordered.length);
  }
}

const INSERT_CHUNK_SIZE = 200;

/**
 * Wipe the company's restorable tables and reload them from `backup`. Two modes:
 * - `remap=false` (own backup / snapshot): ids and scope already belong to this
 *   company, so rows load verbatim.
 * - `remap=true` (foreign backup): the data belongs to another company, so every
 *   id is remapped and companyId/group/FKs are re-stamped onto this company —
 *   including the chart of accounts (group-scoped), which is why `includeGroup`
 *   is set for foreign restores.
 * Runs in one transaction with FK enforcement relaxed when possible.
 *
 * Exported: `company-template.ts` is a second caller — a demo template's revert
 * reloads its pre-apply snapshot through exactly this path.
 */
export async function wipeAndLoad(
  db: JobDatabase,
  catalog: Catalog,
  backup: CompanyBackup,
  opts: {
    companyId: string;
    userId: string;
    remap: boolean;
    includeGroup: boolean;
    targetGroupId: string | null;
    /** Target substrate ids (global rows the backup omits); only consulted on a
     *  remap (foreign/template) load so a FK into a seeded global row is kept
     *  verbatim instead of treated as a dangling gap. */
    substrateIds?: Map<string, Set<unknown>>;
    /** Live phase progress (`wipe` then `load`). Throttled by the caller. */
    onProgress?: (p: JobProgress) => Promise<void>;
  }
): Promise<{ rows: number; idRewrite: Map<string, string> }> {
  const {
    companyId,
    userId,
    remap,
    includeGroup,
    targetGroupId,
    substrateIds,
    onProgress
  } = opts;

  // Refuse if the schema would let a kept row dangle once we wipe (drift guard).
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
  const backupColumns = new Map(
    backup.manifest.tables.map((t) => [t.name, new Set(t.columns)])
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
  const idRewrite = new Map<string, string>();
  if (remap) {
    for (const map of idMaps.values()) {
      for (const [oldId, newId] of map) idRewrite.set(oldId, newId);
    }
  }

  const replicaMode = await canSetReplicationRole(db);
  let inserted = 0;

  await db.transaction().execute(async (trx) => {
    if (replicaMode) {
      await sql`SET LOCAL session_replication_role = 'replica'`.execute(trx);
    }

    // The company's groups before the wipe: memberships survive an own
    // restore, and any left pointing at a group that doesn't come back go.
    const wipedGroups = await trx
      .selectFrom("group")
      .select("id")
      .where("companyId", "=", companyId)
      .execute();

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

    for (let t = 0; t < loadTables.length; t++) {
      const table = loadTables[t]!;
      const backupCols =
        backupColumns.get(table.name) ??
        new Set(Object.keys(backup.data[table.name]![0] ?? {}));
      const columns = table.columns.filter(
        (c) => !c.isGenerated && backupCols.has(c.name)
      );
      if (columns.length === 0) continue;

      // Hot path. Plain indexed loops (no per-row `forEach` closure), packed
      // output array, and `out` keys assigned in a fixed column order so every
      // row of a table shares one hidden class. Own restore skips transforms
      // entirely (verbatim copy) — that call site would otherwise be megamorphic
      // across the per-column closures.
      const sourceRows = backup.data[table.name]!;
      const colCount = columns.length;
      const rows: Record<string, unknown>[] = [];
      if (remap) {
        const transforms = buildRowTransforms(table, columns, {
          remap,
          companyId,
          userId,
          targetGroupId,
          sourceCompanyId: backup.manifest.sourceCompanyId,
          idMaps,
          idRewrite,
          substrateIds
        });
        for (let r = 0; r < sourceRows.length; r++) {
          const row = sourceRows[r]!;
          const out: Record<string, unknown> = {};
          for (let c = 0; c < colCount; c++) {
            out[columns[c]!.name] = transforms[c]!(row[columns[c]!.name]);
          }
          rows.push(out);
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
      inserted += rows.length;
      await onProgress?.({
        phase: "load",
        done: t + 1,
        total: loadTables.length
      });
    }

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

    await rebuildDerivedGroups(
      trx,
      companyId,
      wipedGroups.map((g) => g.id)
    );

    // Every list an open client keeps a copy of has just been replaced. With
    // triggers off nothing logged that, so say it here: a null row id tells
    // the client to read the whole table again.
    await trx
      .insertInto("tableChange")
      .values(
        CHANGE_LOGGED_TABLES.map((table) => ({ companyId, table, rowId: null }))
      )
      .execute();

    // The log only answers a client that asks, and an open tab asks when a
    // broadcast tells it to. With triggers off none was sent: after a template
    // was reverted, a tab kept the reverted parts in its pickers for up to an
    // hour, and creating a job with one of them failed. Say on every table's
    // topic that it changed in bulk (null ids): a list reads the log again and
    // a page reloads. Sent with the transaction, so nothing hears of a restore
    // that rolled back.
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
  });

  return { rows: inserted, idRewrite };
}

/** Exported: also used by `company-template.ts` when reverting a demo template. */
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
 *
 * Exported: shared by the restore path and the demo-template path so the two can
 * never disagree about what a revert is allowed to touch.
 */
export async function resolveRestoreScope(
  client: ServiceRole,
  companyId: string
): Promise<{ targetGroupId: string | null; includeGroup: boolean }> {
  const targetGroupId = await getCompanyGroupId(client, companyId);
  const groupCompanyCount = targetGroupId
    ? ((
        await client
          .from("company")
          .select("id", { count: "exact", head: true })
          .eq("companyGroupId", targetGroupId)
      ).count ?? 1)
    : 0;
  return { targetGroupId, includeGroup: groupCompanyCount === 1 };
}
