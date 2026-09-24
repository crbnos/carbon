import { ProviderID } from "../../core/models";
import { type SyncerRegistry, SyncFactory } from "../../core/sync";
import { BillSyncer } from "./entities/bill";
import { XeroChargeSyncer } from "./entities/charge";
import { ContactSyncer } from "./entities/contact";
import { CreditMemoSyncer } from "./entities/credit-memo";
import { InventoryAdjustmentSyncer } from "./entities/inventory-adjustment";
import { SalesInvoiceSyncer } from "./entities/invoice";
import { ItemSyncer } from "./entities/item";
import { JournalEntrySyncer } from "./entities/journal-entry";
import { XeroPaymentSyncer } from "./entities/payment";
import { PurchaseOrderSyncer } from "./entities/purchase-order";
import { XeroReimbursementSyncer } from "./entities/reimbursement";
import { SalesOrderSyncer } from "./entities/sales-order";
import { VendorCreditSyncer } from "./entities/vendor-credit";

export * from "./entities/bill";
export * from "./entities/charge";
export * from "./entities/contact";
// credit-memo hosts the shared Xero credit-note base (XeroCreditNoteSyncerBase,
// buildXeroCreditNoteLineItem, XERO_MEMO_INCREASER_SKIP_REASON) and the AR syncer
export * from "./entities/credit-memo";
export * from "./entities/invoice";
export * from "./entities/item";
// journal-entry exports mapJournalEntryToManualJournal + JournalEntrySyncer
// for the daily-consolidation cron (@carbon/jobs), per its doc contract
export * from "./entities/journal-entry";
// payment exports the composite entity-id helpers the inbound Invoice-update
// webhook accelerator uses to enqueue payment operations
export * from "./entities/payment";
export * from "./entities/purchase-order";
export * from "./entities/reimbursement";
export * from "./entities/vendor-credit";
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
  // Card charges (Ramp card spend) as Xero spend/receive-money bank
  // transactions on the card account; their journals are DOC_BACKED-excluded
  charge: XeroChargeSyncer,

  // Memos as Xero credit notes: a customer Credit memo (AR down) is an
  // ACCRECCREDIT, a supplier Debit memo (AP down) an ACCPAYCREDIT. Their own
  // journals are DOC_BACKED-excluded. Balance-INCREASING memos skip with a
  // reason (XERO_MEMO_INCREASER_SKIP_REASON) — they are not credit documents.
  creditMemo: CreditMemoSyncer,
  vendorCredit: VendorCreditSyncer,

  // Employee reimbursements as an ACCPAY invoice against an employee Contact
  // — Xero has no reimbursement object, and no way to name the AP control
  // account on a document, so the segregation holds on the Carbon side only.
  reimbursement: XeroReimbursementSyncer,

  // Posting sync (push-only journal entries -> Xero Manual Journals)
  journalEntry: JournalEntrySyncer,

  // Pull-only: Xero payments (ACCREC → AR, ACCPAY → AP) settle Carbon
  // sales/purchase invoices. Forced pull-only/enabled by buildXeroSyncConfig.
  payment: XeroPaymentSyncer

  // Not yet implemented:
  // - employee: Xero no longer supports the Employees API
};

SyncFactory.register(ProviderID.XERO, xeroSyncerRegistry);
