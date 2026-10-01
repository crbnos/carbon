// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  ProviderID,
  qboSyncerRegistry,
  REQUIRED_SYNC_SUBSCRIPTIONS,
  rilletSyncerRegistry,
  SpendProviderID,
  type SyncerRegistry,
  type SyncProviderID,
  xeroSyncerRegistry
} from "@carbon/ee/accounting";
import { rampSyncerRegistry } from "@carbon/ee/ramp/entities";
import { describe, expect, it } from "vitest";
import { getEntityTypesForTable } from "./sync-tables";

/**
 * Pillar A invariant (v4 spec): every table a provider subscribes to must
 * route somewhere real — a TABLE_TO_ENTITY_MAP entry AND a registered
 * syncer for the mapped entity type. Without this, a subscription is a
 * dead letter: `dispatch_event_batch()` enqueues events the SYNC handler
 * silently drops, which reads as "sync is on" while nothing ever pushes.
 *
 * If this test fails you either added a table to
 * REQUIRED_SYNC_SUBSCRIPTIONS without wiring the handler/syncer, or
 * removed a mapping a subscription still relies on.
 */

const SYNCER_REGISTRIES: Record<SyncProviderID, SyncerRegistry> = {
  [ProviderID.XERO]: xeroSyncerRegistry,
  [ProviderID.QUICKBOOKS]: qboSyncerRegistry,
  [ProviderID.RILLET]: rilletSyncerRegistry,
  // A spend provider is held to the same invariant — its subscriptions run on
  // the same handler, registry and drain.
  [SpendProviderID.RAMP]: rampSyncerRegistry
};

const SYNC_PROVIDER_IDS: SyncProviderID[] = [
  ...Object.values(ProviderID),
  ...Object.values(SpendProviderID)
];

/** The check itself, so the negative fixture below exercises the real rule. */
function findDeadLetters(
  registry: SyncerRegistry,
  tables: ReadonlyArray<{ table: string }>
): string[] {
  const dead: string[] = [];
  for (const { table } of tables) {
    const entityTypes = getEntityTypesForTable(table);
    if (entityTypes.length === 0) {
      dead.push(`${table} → no entity type`);
      continue;
    }
    for (const entityType of entityTypes) {
      if (!registry[entityType]) dead.push(`${table} → ${entityType}`);
    }
  }
  return dead;
}

describe("REQUIRED_SYNC_SUBSCRIPTIONS ↔ TABLE_TO_ENTITY_MAP ↔ syncer registries", () => {
  for (const providerId of SYNC_PROVIDER_IDS) {
    describe(providerId, () => {
      const registry = SYNCER_REGISTRIES[providerId];

      for (const subscription of REQUIRED_SYNC_SUBSCRIPTIONS[providerId]) {
        it(`routes '${subscription.table}' to a registered syncer`, () => {
          // A table may route to several entity types (memo → creditMemo +
          // supplierCredit, resolved per row by party). EVERY one must be
          // registered, or that side is a dead letter.
          const entityTypes = getEntityTypesForTable(subscription.table);
          expect(
            entityTypes.length,
            `table '${subscription.table}' routes to no entity type`
          ).toBeGreaterThan(0);

          for (const entityType of entityTypes) {
            expect(
              registry[entityType],
              `${providerId} registers no syncer for '${entityType}'`
            ).toBeDefined();
          }
        });
      }
    });
  }

  it("fails a provider that subscribes to a table it registers no syncer for", () => {
    // The negative fixture: without this, a bug that made `findDeadLetters`
    // always return [] would leave every assertion above passing vacuously.
    expect(
      findDeadLetters(rampSyncerRegistry, [{ table: "purchaseOrder" }])
    ).toEqual([]);

    expect(
      findDeadLetters(rampSyncerRegistry, [{ table: "salesInvoice" }])
    ).toEqual(["salesInvoice → invoice"]);

    expect(
      findDeadLetters(rampSyncerRegistry, [{ table: "notATable" }])
    ).toEqual(["notATable → no entity type"]);
  });
});
