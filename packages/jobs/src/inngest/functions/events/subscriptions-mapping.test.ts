import {
  ProviderID,
  qboSyncerRegistry,
  REQUIRED_SYNC_SUBSCRIPTIONS,
  rilletSyncerRegistry,
  xeroSyncerRegistry
} from "@carbon/ee/accounting";
import { describe, expect, it } from "vitest";
import { TABLE_TO_ENTITY_MAP } from "./sync-tables";

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

const SYNCER_REGISTRIES = {
  [ProviderID.XERO]: xeroSyncerRegistry,
  [ProviderID.QUICKBOOKS]: qboSyncerRegistry,
  [ProviderID.RILLET]: rilletSyncerRegistry
} as const;

describe("REQUIRED_SYNC_SUBSCRIPTIONS ↔ TABLE_TO_ENTITY_MAP ↔ syncer registries", () => {
  for (const providerId of Object.values(ProviderID)) {
    describe(providerId, () => {
      const registry = SYNCER_REGISTRIES[providerId];

      for (const subscription of REQUIRED_SYNC_SUBSCRIPTIONS[providerId]) {
        it(`routes '${subscription.table}' to a registered syncer`, () => {
          const entityType = TABLE_TO_ENTITY_MAP[subscription.table];
          expect(
            entityType,
            `table '${subscription.table}' has no TABLE_TO_ENTITY_MAP entry`
          ).toBeDefined();

          expect(
            registry[entityType!],
            `${providerId} registers no syncer for '${entityType}'`
          ).toBeDefined();
        });
      }
    });
  }
});
