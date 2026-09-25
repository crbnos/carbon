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
 * Master data is swept as two BOUNDED sets, never a full table scan: the rows
 * with no mapping yet (which drains to zero and stays there), plus the rows
 * changed since the window floor. `reconcileMasterData` already short-circuits
 * a mapped-and-unchanged record, so steady state enqueues nothing.
 */
export const MASTER_DATA_UNMAPPED_LIMIT = 200;

/**
 * An item master runs to six figures where a contact master runs to hundreds,
 * so items sweep once an hour (the :15 pass) rather than twice.
 */
export const MASTER_DATA_ITEM_UNMAPPED_LIMIT = 500;

/**
 * Master-data entity type → the table its rows live in.
 *
 * `vendor` reads `supplier` — the one pairing where the names differ, and the
 * single reason this map exists rather than each caller passing the entity type
 * twice. Shared by the outbound sweep and the one-shot master sync.
 */
export const MASTER_DATA_TABLES = {
  customer: "customer",
  vendor: "supplier",
  item: "item"
} as const;

export type MasterDataEntityType = keyof typeof MASTER_DATA_TABLES;

export type MasterDataSweepTarget = {
  entityType: Extract<ReconcileRef["entityType"], MasterDataEntityType>;
  table: (typeof MASTER_DATA_TABLES)[MasterDataEntityType];
  limit: number;
  hourlyOnly: boolean;
};

export const MASTER_DATA_SWEEP_TARGETS: readonly MasterDataSweepTarget[] = [
  {
    entityType: "customer",
    table: MASTER_DATA_TABLES.customer,
    limit: MASTER_DATA_UNMAPPED_LIMIT,
    hourlyOnly: false
  },
  {
    entityType: "vendor",
    table: MASTER_DATA_TABLES.vendor,
    limit: MASTER_DATA_UNMAPPED_LIMIT,
    hourlyOnly: false
  },
  {
    entityType: "item",
    table: MASTER_DATA_TABLES.item,
    limit: MASTER_DATA_ITEM_UNMAPPED_LIMIT,
    hourlyOnly: true
  }
];
