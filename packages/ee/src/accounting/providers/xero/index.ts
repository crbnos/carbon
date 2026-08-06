import { ProviderID } from "../../core/models";
import { type SyncerRegistry, SyncFactory } from "../../core/sync";
import { BillSyncer } from "./entities/bill";
import { ContactSyncer } from "./entities/contact";
import { InventoryAdjustmentSyncer } from "./entities/inventory-adjustment";
import { SalesInvoiceSyncer } from "./entities/invoice";
import { ItemSyncer } from "./entities/item";
import { JournalEntrySyncer } from "./entities/journal-entry";
import { XeroPaymentSyncer } from "./entities/payment";
import { PurchaseOrderSyncer } from "./entities/purchase-order";
import { SalesOrderSyncer } from "./entities/sales-order";

export * from "./entities/bill";
export * from "./entities/contact";
export * from "./entities/invoice";
export * from "./entities/item";
// journal-entry exports mapJournalEntryToManualJournal + JournalEntrySyncer
// for the daily-consolidation cron (@carbon/jobs), per its doc contract
export * from "./entities/journal-entry";
// payment exports the composite entity-id helpers the inbound Invoice-update
// webhook accelerator uses to enqueue payment operations
export * from "./entities/payment";
export * from "./entities/purchase-order";
export * from "./models";
export * from "./provider";

/**
 * Every syncer Xero implements, keyed by entity type. The module-scope
 * SyncFactory.register call below runs whenever this barrel is imported —
 * every consumer path evaluates it before SyncFactory.getSyncer can be
 * called with a Xero context (`@carbon/ee/accounting` re-exports
 * ./providers, and building a SyncContext requires a provider class from
 * here).
 */
export const xeroSyncerRegistry: SyncerRegistry = {
  // Master Data
  customer: ContactSyncer,
  vendor: ContactSyncer,
  item: ItemSyncer,

  // Transaction Data
  bill: BillSyncer,
  invoice: SalesInvoiceSyncer,
  purchaseOrder: PurchaseOrderSyncer,
  salesOrder: SalesOrderSyncer,
  inventoryAdjustment: InventoryAdjustmentSyncer,

  // Posting sync (push-only journal entries -> Xero Manual Journals)
  journalEntry: JournalEntrySyncer,

  // Pull-only: Xero payments (ACCREC → AR, ACCPAY → AP) settle Carbon
  // sales/purchase invoices. Forced pull-only/enabled by buildXeroSyncConfig.
  payment: XeroPaymentSyncer

  // Not yet implemented:
  // - employee: Xero no longer supports the Employees API
};

SyncFactory.register(ProviderID.XERO, xeroSyncerRegistry);
