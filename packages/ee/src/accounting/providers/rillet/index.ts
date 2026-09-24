import { ProviderID } from "../../core/models";
import { type SyncerRegistry, SyncFactory } from "../../core/sync";
import { RilletBillSyncer } from "./entities/bill";
import { RilletChargeSyncer } from "./entities/charge";
import { RilletCreditMemoSyncer } from "./entities/credit-memo";
import { RilletCustomerSyncer } from "./entities/customer";
import { RilletSalesInvoiceSyncer } from "./entities/invoice";
import { RilletItemSyncer } from "./entities/item";
import { RilletJournalEntrySyncer } from "./entities/journal-entry";
import { RilletPaymentSyncer } from "./entities/payment";
import { RilletReimbursementSyncer } from "./entities/reimbursement";
import { RilletVendorSyncer } from "./entities/vendor";
import { RilletVendorCreditSyncer } from "./entities/vendor-credit";

export * from "./entities/bill";
export * from "./entities/charge";
export * from "./entities/credit-memo";
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
export * from "./entities/reimbursement";
export * from "./entities/shared";
export * from "./entities/vendor";
export * from "./entities/vendor-credit";
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
  // Card charges (Ramp card spend) as Rillet charges; their journals are
  // DOC_BACKED-excluded per row while this is enabled
  charge: RilletChargeSyncer,
  // Memo credits as Rillet's native credit documents — NEVER journal
  // entries (a sandbox probe proved Rillet silently drops `related_entity`,
  // which would break AR/AP subledger-to-control reconciliation). Party, not
  // direction, decides which one: a customer memo is a credit memo, a
  // supplier memo a vendor credit.
  creditMemo: RilletCreditMemoSyncer,
  vendorCredit: RilletVendorCreditSyncer,

  // Employee reimbursements as Rillet's NATIVE reimbursement object — the
  // one provider that has one. It names its own payable account, so Carbon's
  // segregated employee-payable control account crosses the wire intact.
  reimbursement: RilletReimbursementSyncer,

  // Posting sync (push-only journal entries -> Rillet journal entries)
  journalEntry: RilletJournalEntrySyncer,

  // Pull-only: Rillet invoice payments settle Carbon sales invoices
  payment: RilletPaymentSyncer

  // Not implemented (force-disabled by buildRilletSyncConfig):
  // - purchaseOrder (Rillet has no PO endpoint)
  // - salesOrder / inventoryAdjustment / employee
};

SyncFactory.register(ProviderID.RILLET, rilletSyncerRegistry);
