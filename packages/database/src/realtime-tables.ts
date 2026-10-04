// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "./types";

type TableName = keyof Database["public"]["Tables"];

// Tables with the `broadcast_table_changes` statement trigger. A route may only
// name one of these in `handle.realtime` (the `realtime-table-has-trigger`
// check): a table without the trigger sends nothing, and nothing errors.
export const REALTIME_TABLES = [
  "assemblyPlanJob",
  "changeOrder",
  "customField",
  "customer",
  "documentExtraction",
  "documentTemplate",
  "employee",
  "implementationCheckState",
  "implementationFieldValue",
  "implementationHub",
  "implementationRow",
  "inspection",
  "inventoryCount",
  "item",
  "itemLedger",
  "itemStockQuantities",
  "itemSupersession",
  "job",
  "jobMakeMethod",
  "jobMaterial",
  "jobOperation",
  "jobOperationNote",
  "jobOperationStep",
  "jobOperationStepRecord",
  "journal",
  "maintenanceDispatch",
  "material",
  "materialForm",
  "materialSubstance",
  "modelUpload",
  "nonConformance",
  "nonConformanceActionTask",
  "part",
  "pickingList",
  "pickingListLine",
  "printJob",
  "productionEvent",
  "productionQuantity",
  "purchaseInvoice",
  "purchaseInvoiceLine",
  "purchaseOrder",
  "purchaseOrderLine",
  "purchaseReturnOrder",
  "purchasingRfq",
  "quote",
  "quoteLine",
  "quoteMaterial",
  "quoteOperation",
  "receipt",
  "receiptLine",
  "salesInvoice",
  "salesInvoiceLine",
  "salesOrder",
  "salesOrderLine",
  "salesReturnOrder",
  "salesRfq",
  "salesRfqLine",
  "shipment",
  "shipmentLine",
  "stockTransfer",
  "supplier",
  "supplierQuote",
  "trackedEntity",
  "warehouseTransfer",
  "workflowRun",
  "workflowStepRun"
] as const satisfies readonly TableName[];

// Tables behind the cached `api+` reference lists. They share one topic,
// `company:<companyId>:reference`, through `broadcast_reference_changes`.
export const REALTIME_REFERENCE_TABLES = [
  "ability",
  "customerContact",
  "customerLocation",
  "customerType",
  "itemPostingGroup",
  "location",
  "materialType",
  "nonConformanceType",
  "paymentTerm",
  "procedure",
  "process",
  "qualityDocument",
  "shippingMethod",
  "storageUnit",
  "supplierContact",
  "supplierLocation",
  "supplierProcess",
  "supplierType",
  "unitOfMeasure",
  "workCenter"
] as const satisfies readonly TableName[];

// Per-user topics, `user:<userId>:<table>`, through `broadcast_user_changes`.
export const REALTIME_USER_TABLES = [
  "notification"
] as const satisfies readonly TableName[];

export type RealtimeTable = (typeof REALTIME_TABLES)[number];
