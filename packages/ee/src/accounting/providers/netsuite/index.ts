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
