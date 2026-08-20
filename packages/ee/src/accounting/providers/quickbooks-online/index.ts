import { ProviderID } from "../../core/models";
import { type SyncerRegistry, SyncFactory } from "../../core/sync";
import { QboBillSyncer } from "./entities/bill";
import { QboCustomerSyncer } from "./entities/customer";
import { QboSalesInvoiceSyncer } from "./entities/invoice";
import { QboItemSyncer } from "./entities/item";
import { QboJournalEntrySyncer } from "./entities/journal-entry";
import { QboPaymentSyncer } from "./entities/payment";
import { QboPurchaseOrderSyncer } from "./entities/purchase-order";
import { QboVendorSyncer } from "./entities/vendor";

export * from "./entities/bill";
export * from "./entities/customer";
export * from "./entities/invoice";
export * from "./entities/item";
// journal-entry exports mapJournalEntryToQboJournalEntry + the syncer for a
// future QBO daily-consolidation path, mirroring the Xero barrel's contract
export * from "./entities/journal-entry";
// payment exports the composite entity-id helpers + buildQboPaymentSyncChange
// the inbound QBO webhook route uses to enqueue operations
export * from "./entities/payment";
export * from "./entities/purchase-order";
export * from "./entities/shared";
export * from "./entities/vendor";
export * from "./models";
export * from "./provider";

/**
 * Every syncer QuickBooks Online implements, keyed by entity type. The
 * module-scope SyncFactory.register call below runs whenever this barrel
 * is imported — same contract as the Xero barrel (every consumer path
 * evaluates it before SyncFactory.getSyncer can be called with a QBO
 * context).
 */
export const qboSyncerRegistry: SyncerRegistry = {
  // Master Data — QBO keeps Customer and Vendor as separate objects
  // (no Xero-style dual-flag Contact), so each has its own syncer
  customer: QboCustomerSyncer,
  vendor: QboVendorSyncer,
  item: QboItemSyncer,

  // Transaction Data
  bill: QboBillSyncer,
  invoice: QboSalesInvoiceSyncer,
  purchaseOrder: QboPurchaseOrderSyncer,

  // Posting sync (push-only journal entries -> QBO JournalEntry objects)
  journalEntry: QboJournalEntrySyncer,

  // Pull-only (forced by buildQboSyncConfig): QBO Payment (AR) / BillPayment
  // (AP) settlements flow back onto Carbon sales/purchase invoices
  payment: QboPaymentSyncer

  // Not yet implemented:
  // - salesOrder / inventoryAdjustment / employee
};

SyncFactory.register(ProviderID.QUICKBOOKS, qboSyncerRegistry);
