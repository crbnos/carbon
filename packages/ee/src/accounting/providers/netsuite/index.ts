// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { ProviderID } from "../../core/models";
import { type SyncerRegistry, SyncFactory } from "../../core/sync";
import { NetSuiteJournalEntrySyncer } from "./journal";

export * from "./auth";
export * from "./journal";
export * from "./provider";

export const netsuiteSyncerRegistry: SyncerRegistry = {
  journalEntry: NetSuiteJournalEntrySyncer
};

SyncFactory.register(ProviderID.NETSUITE, netsuiteSyncerRegistry);
