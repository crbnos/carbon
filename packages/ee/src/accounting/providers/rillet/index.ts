import { ProviderID } from "../../core/models";
import { type SyncerRegistry, SyncFactory } from "../../core/sync";
import { RilletBillSyncer } from "./entities/bill";
import { RilletCustomerSyncer } from "./entities/customer";
import { RilletSalesInvoiceSyncer } from "./entities/invoice";
import { RilletItemSyncer } from "./entities/item";
import { RilletJournalEntrySyncer } from "./entities/journal-entry";
import { RilletPaymentSyncer } from "./entities/payment";
import { RilletVendorSyncer } from "./entities/vendor";

export * from "./entities/bill";
export * from "./entities/customer";
export * from "./entities/invoice";
export * from "./entities/item";
// journal-entry exports mapJournalEntryToRilletJournalEntry + the syncer
// for a future Rillet daily-consolidation path, mirroring the Xero/QBO
// barrels' contract
export * from "./entities/journal-entry";
// payment exports the composite entity-id helpers the inbound
// invoice-payment-updated webhook route uses to enqueue operations
export * from "./entities/payment";
export * from "./entities/shared";
export * from "./entities/vendor";
export * from "./models";
export * from "./provider";
export * from "./webhook";

/**
 * Every syncer Rillet implements, keyed by entity type. The module-scope
 * SyncFactory.register call below runs whenever this barrel is imported —
 * same contract as the Xero/QBO barrels (every consumer path evaluates it
 * before SyncFactory.getSyncer can be called with a Rillet context).
 */
export const rilletSyncerRegistry: SyncerRegistry = {
  // Master Data — Rillet keeps Customer and Vendor as separate objects
  // (no Xero-style dual-flag Contact), so each has its own syncer
  customer: RilletCustomerSyncer,
  vendor: RilletVendorSyncer,
  item: RilletItemSyncer,

  // Transaction Data (push-only, create-only in v1)
  bill: RilletBillSyncer,
  invoice: RilletSalesInvoiceSyncer,

  // Posting sync (push-only journal entries -> Rillet journal entries)
  journalEntry: RilletJournalEntrySyncer,

  // Pull-only: Rillet invoice payments settle Carbon sales invoices
  payment: RilletPaymentSyncer

  // Not implemented (force-disabled by buildRilletSyncConfig):
  // - purchaseOrder (Rillet has no PO endpoint)
  // - salesOrder / inventoryAdjustment / employee
};

SyncFactory.register(ProviderID.RILLET, rilletSyncerRegistry);
