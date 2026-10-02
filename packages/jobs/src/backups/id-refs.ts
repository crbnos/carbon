// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";

type PublicTables = Database["public"]["Tables"];
// Typed against the generated row types, so a renamed or dropped column fails to
// compile instead of silently never being rewritten.
type IdRefColumns = {
  [T in keyof PublicTables]?: readonly Extract<
    keyof PublicTables[T]["Row"],
    string
  >[];
};

/**
 * TEXT (or TEXT[]) columns that hold another row's id WITHOUT a foreign key —
 * mostly generic refs that point at one of several tables (`inspection.
 * sourceDocumentLineId` is a receipt line OR a job operation), so no FK can
 * express them. A foreign restore re-ids every row, and the FK-driven remap
 * can't see these, so they are rewritten through the combined `idRewrite` map
 * instead. Left alone they keep the SOURCE company's ids: a dangling ref at
 * best, and a cross-company unique-index collision when the source rows still
 * exist (`inspection_sourceDocumentLineId_key`).
 *
 * Lookup-only: a value that isn't a remapped id (a readable number, an external
 * id, a global row) passes through untouched, so listing a column that only
 * sometimes holds an id is harmless. Readable ids (`quote.quoteId`), external
 * ids and user refs are NOT listed — they are not row ids.
 *
 * A migration that adds a TEXT/TEXT[] column holding a tenant row's id with no
 * FK (a generic `sourceDocumentId`, an `...Ids` array) MUST add it here in the
 * same commit. Nothing infers it: without an FK the column reads as plain text.
 */
export const ID_REF_COLUMNS: Partial<Record<string, readonly string[]>> = {
  accountingSyncOperation: ["entityId"],
  approvalRequest: ["documentId"],
  approvalRule: ["approverGroupIds"],
  changeOrder: ["requiredActionIds", "sourceId"],
  costLedger: ["appliesToCostLedgerId", "documentId"],
  document: ["sourceDocumentId"],
  documentExtraction: ["sourceDocumentId"],
  documentTemplate: ["footerSectionId", "headerSectionId"],
  enforcementRule: ["filteredItemGroupIds"],
  enforcementRuleAcknowledgment: [
    "documentId",
    "documentLineId",
    "itemId",
    "ruleId"
  ],
  externalIntegrationMapping: ["entityId"],
  externalLink: ["documentId"],
  inspection: ["sourceDocumentId", "sourceDocumentLineId"],
  intercompanyEliminationLine: ["accountId", "itemId", "journalLineId"],
  intercompanyTransaction: ["documentId"],
  inventoryCountLine: [
    "locationId",
    "postedItemLedgerId",
    "storageUnitId",
    "trackedEntityId"
  ],
  itemLedger: ["correctionOfItemLedgerId", "documentId", "documentLineId"],
  itemStockQuantities: ["itemId", "locationId"],
  job: ["modelUploadId", "quoteLineId"],
  jobMaterial: ["substitutedFromItemId"],
  jobOperation: ["operationSupplierProcessId"],
  jobOperationNote: ["jobOperationId"],
  jobOperationStep: ["nonConformanceInvestigationId"],
  journalLine: ["documentId"],
  journalLineDimension: ["valueId"],
  nonConformance: ["requiredActionIds"],
  nonConformancePurchaseReturnOrderLine: ["purchaseReturnOrderId"],
  nonConformanceSalesReturnOrderLine: ["salesReturnOrderId"],
  nonConformanceWorkflow: ["requiredActionIds"],
  note: ["documentId"],
  notification: ["documentId"],
  notificationDelivery: ["documentId"],
  periodCloseTask: ["evidenceJournalId"],
  pricingRule: ["customerIds", "customerTypeIds", "itemIds"],
  printJob: ["sourceDocumentId"],
  printerRoute: ["templateId"],
  purchaseInvoiceLine: ["assetId", "serviceId"],
  purchaseOrderLine: ["locationId"],
  receipt: ["sourceDocumentId"],
  receiptLine: ["lineId"],
  reimbursementLineDimension: ["valueId"],
  riskRegister: ["sourceId"],
  salesInvoiceShipment: ["locationId", "shippingMethodId", "shippingTermId"],
  salesOrderLine: ["locationId", "modelUploadId"],
  salesOrderShipment: ["supplierId", "supplierLocationId"],
  shipment: ["sourceDocumentId"],
  shipmentLine: ["lineId"],
  slackDocumentThread: ["documentId"],
  storageUnit: ["storageTypeIds"],
  supplierLedger: ["documentId"],
  supplierPartPrice: ["sourceDocumentId"],
  trackedActivity: ["sourceDocumentId"],
  trackedEntity: ["sourceDocumentId"],
  trainingAssignment: ["groupIds"],
  workflowRun: ["causedByRunId", "rootRunId", "triggerRecordId"]
} satisfies IdRefColumns;
