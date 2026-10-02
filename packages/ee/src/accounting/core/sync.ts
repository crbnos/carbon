// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { SyncProviderID } from "./models";
import type { AccountingEntityType, IEntitySyncer, SyncContext } from "./types";

/**
 * Constructor shape shared by every entity syncer: constructed with the
 * execution context only (see BaseEntitySyncer).
 */
export type SyncerConstructor = new (context: SyncContext) => IEntitySyncer;

/**
 * A provider's syncer classes, keyed by the entity types it supports.
 */
export type SyncerRegistry = Partial<
  Record<AccountingEntityType, SyncerConstructor>
>;

/**
 * Syncer registries keyed by provider. Populated at module scope by each
 * provider's barrel (e.g. providers/xero registers xeroSyncerRegistry), so
 * importing a provider is what makes its syncers resolvable.
 *
 * Keyed on `SyncProviderID`, not `ProviderID`: this is the one dispatch point
 * that is genuinely role-agnostic, so a spend platform registers here exactly
 * as an accounting provider does.
 */
const registries: Partial<Record<SyncProviderID, SyncerRegistry>> = {};

export const SyncFactory = {
  /**
   * Registers (or extends) a provider's syncer registry. Called at module
   * scope from the provider's barrel; registering the same provider twice
   * merges the registries.
   */
  register(providerId: SyncProviderID, registry: SyncerRegistry): void {
    registries[providerId] = { ...registries[providerId], ...registry };
  },

  /**
   * Instantiates the correct Syncer class based on the Provider and the
   * Entity Type from context.
   * @param context - The execution context (DB connection, Provider, Config, entityType)
   */
  getSyncer(context: SyncContext): IEntitySyncer {
    const registry = registries[context.provider.id];
    if (!registry) {
      throw new Error(
        `No Syncer registry found for provider: ${context.provider.id}`
      );
    }

    const Syncer = registry[context.entityType];
    if (!Syncer) {
      throw new Error(
        `No Syncer implementation found for entity type: ${context.entityType}`
      );
    }

    return new Syncer(context);
  }
};
