// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
 * Which of the outbound sweep's two cron slots (`15,45 * * * *`) a run is: the
 * :15 pass is the hourly one, so a `hourlyOnly` target sweeps once an hour
 * rather than twice.
 *
 * Takes the RUN's scheduled time rather than reading the wall clock, and the
 * caller must resolve it ONCE per run, before the per-company steps. Read
 * inside a per-company `step.run` it flips mid-run for a tenant list long
 * enough to cross :30 — every tenant after the boundary silently skips the
 * hourly targets — and it flips again on any step retry that lands in the
 * other half hour.
 *
 * Deliberately `getUTCMinutes`, NOT `getMinutes`: the cron is defined in UTC,
 * so this is not a business-calendar read and no company timezone applies —
 * which is also why it is outside `no-local-timezone`'s ban on process-zone
 * date parts.
 */
export function isHourlyMasterDataPass(scheduledAtMs: number): boolean {
  return new Date(scheduledAtMs).getUTCMinutes() < 30;
}

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
  /**
   * Sweep on the :15 pass only (see `isHourlyMasterDataPass`). No target sets
   * it today — the one that did was `item`, and it is gone — but the gate is a
   * per-target property the sweep honours, so a future master too large for
   * both passes stays expressible.
   */
  hourlyOnly: boolean;
};

/**
 * `item` is deliberately NOT a sweep target. Carbon's item master is a
 * manufacturing parts catalog — tens of thousands of parts, materials, tools
 * and consumables — and sweeping it mirrored every unmapped row into the
 * provider's Products & Services list, which is exactly the catalog dump that
 * removing the `item` event subscription
 * (`packages/ee/src/accounting/core/subscriptions.ts`) was meant to stop.
 *
 * Items still reach a provider the two ways that are scoped to what a synced
 * document actually references: JIT via `ensureDependencySynced("item")` from
 * sales/purchase orders and inventory adjustments, and the deliberate one-shot
 * "Push customers, vendors & items" action (`accounting-master-sync.ts`, which
 * is why `MASTER_DATA_TABLES` still carries the `item` pairing).
 */
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
  }
];
