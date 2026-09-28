import type { ReconcileRef } from "./reconcile";

/**
 * The master-data entities the outbound sweep covers, and the table each reads.
 *
 * Import-light on purpose — the same constraint `events/sync-tables.ts` carries.
 * `accounting-outbound-sweep.ts` reaches `@carbon/auth/client.server`, which
 * validates the full server env at import time, so a test that only wants this
 * declaration cannot import it from there.
 */

/**
 * Master data is swept as two sets, never a full table scan: the rows with no
 * mapping yet, plus the rows changed since the window floor.
 * `reconcileMasterData` already short-circuits a mapped-and-unchanged record,
 * so steady state enqueues nothing.
 *
 * The two sets are bounded DIFFERENTLY, and the difference is the whole point.
 * The unmapped set is capped at this limit because it is self-advancing: a
 * swept row gains a mapping and leaves the set, so the next pass sees the next
 * batch and the set drains to zero. The CHANGED set is not self-advancing —
 * reconciling a row does not move its `updatedAt`, so it keeps matching the
 * window for days — and capping that one starved every row past the cap. It is
 * paged to exhaustion instead (`collectPagedIds`).
 */
export const MASTER_DATA_UNMAPPED_LIMIT = 200;

/**
 * An item master runs to six figures where a contact master runs to hundreds,
 * so items sweep once an hour (the :15 pass) rather than twice.
 */
export const MASTER_DATA_ITEM_UNMAPPED_LIMIT = 500;

export type MasterDataSweepTarget = {
  entityType: Extract<
    ReconcileRef["entityType"],
    "customer" | "vendor" | "item"
  >;
  /** NOTE: `vendor` reads `supplier` — the one pairing where the names differ. */
  table: "customer" | "supplier" | "item";
  limit: number;
  hourlyOnly: boolean;
};

export const MASTER_DATA_SWEEP_TARGETS: readonly MasterDataSweepTarget[] = [
  {
    entityType: "customer",
    table: "customer",
    limit: MASTER_DATA_UNMAPPED_LIMIT,
    hourlyOnly: false
  },
  {
    entityType: "vendor",
    table: "supplier",
    limit: MASTER_DATA_UNMAPPED_LIMIT,
    hourlyOnly: false
  },
  {
    entityType: "item",
    table: "item",
    limit: MASTER_DATA_ITEM_UNMAPPED_LIMIT,
    hourlyOnly: true
  }
];

/**
 * Walk an offset-paged reader to exhaustion, under a hard page ceiling.
 *
 * Extracted from `accounting-outbound-sweep.ts` for ONE reason: the starvation
 * bug this replaced lived in the loop, not the query, and the loop could not be
 * tested where it was. That module reaches `@carbon/auth/client.server` and
 * `@carbon/ee/accounting` (and through it the Lingui `msg` macro in
 * `@carbon/glossary`, which throws in plain Node), so vitest cannot import it at
 * all. Here it is a pure function over a callback, so the paging contract is
 * pinned without a Postgres or PostgREST stand-in.
 *
 * Stops on the first short page — a full page means "there may be more", and a
 * short one is proof there is not. `maxPages` is the ceiling that keeps one
 * company's runaway table from consuming the sweep.
 */
export async function collectPagedIds(args: {
  /** Reads one page. Called with an absolute row offset. */
  fetchPage: (offset: number, size: number) => Promise<string[]>;
  pageSize: number;
  maxPages: number;
}): Promise<string[]> {
  const ids: string[] = [];
  let offset = 0;
  for (let page = 0; page < args.maxPages; page++) {
    const rows = await args.fetchPage(offset, args.pageSize);
    ids.push(...rows);
    if (rows.length < args.pageSize) break;
    offset += args.pageSize;
  }
  return ids;
}
