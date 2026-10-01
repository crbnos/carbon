// Document-lock rules for the operation dispatch path.
//
// The ERP route actions refuse writes to locked documents (a confirmed sales
// order, a closed issue, a released make method, a posted receipt…) with
// `requireUnlocked` / `requireUnlockedBulk`, `checkRevisionLock`, the change
// notice guards and a handful of inline checks. Those guards live in the
// routes, and the dispatch path (HTTP v1, MCP call_tool, the in-app agent,
// workflows) calls the same service functions by name — so without a gate of
// its own it writes locked documents freely.
//
// A lock is a property of the ROUTE ACTION, not of the table: the UI keeps
// writing locked headers and lines through unguarded routes (status
// transitions and reopen, favorites, line reorder, job creation from a line,
// deleteSalesOrder). So every entry below is keyed by TOOL NAME and names the
// route(s) whose guard it mirrors, with the same predicate and the same
// message. Tools not listed pass untouched.
// `apps/erp/test/mcp-document-lock-coverage.test.ts` scans the routes and
// fails when a guarded route calls a registry write that is neither gated here
// nor exempted with a reason, and when an entry here names a route that
// carries no guard (which would be an invented lock).
//
// This file is pure: the database reads go through the `LockReader` the
// server module (`document-lock-gate.server.ts`) builds, so the rules are
// testable without a database.

import type { ManifestEntry } from "@carbon/api";
import {
  isStockTransferLocked,
  isWarehouseTransferLocked
} from "~/modules/inventory/inventory.models";
import {
  isPurchaseInvoiceLocked,
  isSalesInvoiceLocked
} from "~/modules/invoicing/invoicing.models";
import {
  canEditChangeNoticeEngineering,
  canEditChangeNoticeWorkflow,
  changeNoticeLockedMessage,
  isChangeNoticeLocked
} from "~/modules/items/items.models";
import type { LockCheck, LockKind } from "~/modules/items/items.server";
import { isJobLocked } from "~/modules/production/production.models";
import {
  isPurchaseOrderLocked,
  isPurchaseReturnOrderLocked,
  isRfqLocked,
  isSupplierQuoteLocked
} from "~/modules/purchasing/purchasing.models";
import { isIssueLocked } from "~/modules/quality/quality.models";
import { isMaintenanceDispatchLocked } from "~/modules/resources/resources.models";
import {
  isQuoteLocked,
  isSalesOrderLocked,
  isSalesReturnOrderLocked,
  isSalesRfqLocked
} from "~/modules/sales/sales.models";

// ---------------------------------------------------------------------------
// Reader: the only I/O the rules perform.
// ---------------------------------------------------------------------------

export type Row = Record<string, unknown>;

export interface LockReader {
  /** Rows of `table` whose `column` is one of `values`, scoped to the caller's
   *  company. `column` defaults to `id`. */
  select(
    table: string,
    columns: string[],
    values: string[],
    column?: string
  ): Promise<Row[]>;
  /** `checkRevisionLock` from items.server — the make-method release lock plus
   *  the owning change notice's engineering lock. */
  revisionLock(kind: LockKind, id: string): Promise<LockCheck>;
  /** `assertMethodOperationIsDraft` from items.service, as a message (null when
   *  the operation's method version is Draft). */
  methodOperationDraftError(operationId: string): Promise<string | null>;
  /** The pending approval request on a purchase order and the caller's role on
   *  it, as the purchase-order delete route reads them. Null when there is no
   *  pending request with a requester. */
  purchaseOrderApproval(
    purchaseOrderId: string
  ): Promise<{ isRequester: boolean; isApprover: boolean } | null>;
}

/** Service params by name → the resolved positional value dispatch will pass. */
export type ResolvedArgs = Record<string, unknown>;

export function resolveArgs(
  meta: Pick<ManifestEntry, "serviceParams">,
  functionArgs: unknown[]
): ResolvedArgs {
  const args: ResolvedArgs = {};
  meta.serviceParams.forEach((name, index) => {
    args[name] = functionArgs[index];
  });
  return args;
}

// ---------------------------------------------------------------------------
// Locating the document a write touches.
// ---------------------------------------------------------------------------

/** One FK step from a child row up towards its header. */
type Hop = {
  table: string | ((args: ResolvedArgs) => string | null);
  fk: string;
};

/**
 * Where a tool's payload names the row a lock hangs off. `key` reads a field
 * of the resolved param (omitted: the param itself is the id). Arrays — the id
 * lists of bulk tools and reorder tools — contribute every element. `via`
 * walks FK steps from the named row up to the locked row, so an id-only write
 * (delete a line by its id) resolves its header the way the route's URL did.
 */
export type Ref = { param: string; key?: string; via?: Hop[] };

const ref = (param: string, key?: string, ...via: Hop[]): Ref => ({
  param,
  key,
  via
});
const hop = (table: Hop["table"], fk: string): Hop => ({ table, fk });

function idsAt(args: ResolvedArgs, r: Ref): string[] {
  const value = args[r.param];
  const pick = (v: unknown): unknown =>
    r.key === undefined
      ? v
      : v && typeof v === "object" && !Array.isArray(v)
        ? (v as Row)[r.key]
        : undefined;
  const values = Array.isArray(value) ? value.map(pick) : [pick(value)];
  return values.filter((v): v is string => typeof v === "string" && v !== "");
}

/** The ids of the rows `refs` point at, after walking each ref's FK steps. */
export async function resolveRefIds(
  args: ResolvedArgs,
  refs: Ref[],
  reader: LockReader
): Promise<string[]> {
  const out = new Set<string>();
  for (const r of refs) {
    let ids = idsAt(args, r);
    for (const step of r.via ?? []) {
      if (ids.length === 0) break;
      const table =
        typeof step.table === "function" ? step.table(args) : step.table;
      if (!table) {
        ids = [];
        break;
      }
      const rows = await reader.select(table, ["id", step.fk], ids);
      ids = rows
        .map((row) => row[step.fk])
        .filter((v): v is string => typeof v === "string" && v !== "");
    }
    for (const id of ids) out.add(id);
  }
  return [...out];
}

// ---------------------------------------------------------------------------
// Create vs update: the service's own test, never the gate's guess.
// ---------------------------------------------------------------------------

/**
 * How an upsert service picks its insert branch, read off the payload it
 * receives. The gate sees the payload after `enrichWithAuthContext`, which
 * stamps or strips `createdBy` / `updatedBy` per `_operation`, so applying the
 * service's test to that payload lands on the branch the service will take —
 * a caller-supplied `id` next to `_operation: "create"` cannot make an insert
 * look like an edit.
 *
 * - `idFalsy`: `if (row.id)` updates.
 * - `idKeyAbsent`: `if ("id" in row)` updates.
 * - `createdByPresent`: `if ("createdBy" in row)` inserts.
 * - `updatedByAbsent`: `if ("updatedBy" in row)` updates.
 */
export type InsertTest =
  | "idFalsy"
  | "idKeyAbsent"
  | "createdByPresent"
  | "updatedByAbsent";

/**
 * Every tool whose rules differ between create and update (`on`, a
 * `{ create, update }` message, a create-aware inline guard), with its
 * service's test. `mcp-document-lock-coverage.test.ts` reads each service and
 * fails when an entry is missing or disagrees with the code.
 */
export const INSERT_TESTS: Record<string, InsertTest> = {
  sales_upsertSalesOrderLine: "idKeyAbsent",
  sales_upsertSalesOrder: "idKeyAbsent",
  sales_upsertQuote: "createdByPresent",
  sales_upsertSalesRFQ: "createdByPresent",
  sales_upsertSalesReturnOrderLine: "createdByPresent",
  invoicing_upsertSalesInvoice: "idKeyAbsent",
  invoicing_upsertPurchaseInvoice: "idKeyAbsent",
  invoicing_upsertPayment: "createdByPresent",
  purchasing_upsertPurchaseOrder: "idKeyAbsent",
  purchasing_upsertPurchaseReturnOrderLine: "createdByPresent",
  purchasing_upsertPurchasingRFQ: "idFalsy",
  purchasing_upsertSupplierQuote: "createdByPresent",
  production_upsertProductionQuantity: "updatedByAbsent",
  production_upsertProductionEvent: "createdByPresent",
  production_upsertJob: "updatedByAbsent",
  quality_upsertIssue: "createdByPresent",
  inventory_upsertWarehouseTransfer: "createdByPresent",
  resources_upsertMaintenanceDispatch: "createdByPresent",
  production_upsertMaintenanceDispatch: "createdByPresent"
};

/** Whether the service will take its insert branch for this payload. */
export function isCreate(
  tool: string,
  args: ResolvedArgs,
  param: string
): boolean {
  const value = args[param];
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Row;
  switch (INSERT_TESTS[tool] ?? "idFalsy") {
    case "idKeyAbsent":
      return !("id" in row);
    case "createdByPresent":
      return "createdBy" in row;
    case "updatedByAbsent":
      return !("updatedBy" in row);
    default:
      return typeof row.id !== "string" || row.id === "";
  }
}

// ---------------------------------------------------------------------------
// Table 1 — header status locks (requireUnlocked / requireUnlockedBulk).
// ---------------------------------------------------------------------------

type DocumentSpec = {
  table: string;
  isLocked: (status: string | null | undefined) => boolean;
  /** Message derived from the status, for guards whose wording depends on it. */
  message?: (status: string | null | undefined) => string;
};

export const LOCKABLE_DOCUMENTS = {
  salesOrder: { table: "salesOrder", isLocked: isSalesOrderLocked },
  quote: { table: "quote", isLocked: isQuoteLocked },
  salesRfq: { table: "salesRfq", isLocked: isSalesRfqLocked },
  salesReturnOrder: {
    table: "salesReturnOrder",
    isLocked: isSalesReturnOrderLocked
  },
  salesInvoice: { table: "salesInvoice", isLocked: isSalesInvoiceLocked },
  purchaseInvoice: {
    table: "purchaseInvoice",
    isLocked: isPurchaseInvoiceLocked
  },
  purchaseOrder: { table: "purchaseOrder", isLocked: isPurchaseOrderLocked },
  purchaseReturnOrder: {
    table: "purchaseReturnOrder",
    isLocked: isPurchaseReturnOrderLocked
  },
  purchasingRfq: { table: "purchasingRfq", isLocked: isRfqLocked },
  supplierQuote: { table: "supplierQuote", isLocked: isSupplierQuoteLocked },
  job: { table: "job", isLocked: isJobLocked },
  maintenanceDispatch: {
    table: "maintenanceDispatch",
    isLocked: isMaintenanceDispatchLocked
  },
  issue: { table: "nonConformance", isLocked: isIssueLocked },
  stockTransfer: { table: "stockTransfer", isLocked: isStockTransferLocked },
  warehouseTransfer: {
    table: "warehouseTransfer",
    isLocked: isWarehouseTransferLocked
  },
  // payments+/$paymentId.tsx refuses unless status is exactly "Draft"
  // (stricter than isPaymentLocked, which lets a null status through).
  payment: { table: "payment", isLocked: (status) => status !== "Draft" },
  // Header fields (items+/change-notice+/update.tsx): Done / Cancelled.
  changeNotice: { table: "changeOrder", isLocked: isChangeNoticeLocked },
  // requireChangeNoticeEditable(scope: "engineering") — frozen from
  // Implementation onward.
  changeNoticeEngineering: {
    table: "changeOrder",
    isLocked: (status) => !canEditChangeNoticeEngineering(status),
    message: changeNoticeLockedMessage
  },
  // requireChangeNoticeEditable(scope: "workflow") — editable until closed.
  changeNoticeWorkflow: {
    table: "changeOrder",
    isLocked: (status) => !canEditChangeNoticeWorkflow(status),
    message: changeNoticeLockedMessage
  }
} as const satisfies Record<string, DocumentSpec>;

export type LockableDocument = keyof typeof LOCKABLE_DOCUMENTS;

export type LockRule = {
  document: LockableDocument;
  /** Every way the payload can name the document; a write is refused when ANY
   *  resolved document is locked (requireUnlockedBulk semantics). */
  refs: Ref[];
  /** The route's flash text. A `{ create, update }` pair when the add-line and
   *  edit-line routes word it differently. Omitted for documents whose message
   *  is derived from the status. */
  message?: string | { create: string; update: string };
  /** Apply only to inserts or only to updates, when the UI guards one and not
   *  the other. */
  on?: "create" | "update";
  /** Which param's `id` decides create vs update (default: the first ref's). */
  writeParam?: string;
  /** Payload keys the UI still edits on a locked document (the inline bulk
   *  editors exempt them). A write touching only these passes. */
  unlockedFields?: string[];
  /** Extra applicability test on the payload. */
  when?: (args: ResolvedArgs) => boolean;
  /** Route files (relative to routes/x+) whose guard this rule mirrors. */
  routes: string[];
};

// Sales ---------------------------------------------------------------------

const SALES_ORDER_LOCKED =
  "Cannot modify a locked sales order. Reopen it first.";
const QUOTE_LOCKED = "Cannot modify a locked quote. Reopen it first.";
const RFQ_LOCKED = "Cannot modify a locked RFQ. Reopen it first.";
const SALES_INVOICE_LOCKED =
  "Cannot modify a locked sales invoice. Reopen it first.";
const RETURN_ORDER_LOCKED =
  "Cannot modify a completed or cancelled return order.";
const RETURN_ORDER_ADD_LOCKED =
  "Cannot add lines to a completed or cancelled return order.";
const RETURN_ORDER_DELETE_LOCKED =
  "Cannot delete lines on a completed or cancelled return order.";

// Purchasing / invoicing -----------------------------------------------------

const PURCHASE_ORDER_LOCKED = "Cannot modify a confirmed purchase order.";
const PURCHASE_INVOICE_LOCKED = "Cannot modify a confirmed purchase invoice.";
const SUPPLIER_QUOTE_LOCKED =
  "Cannot modify a locked supplier quote. Reopen it first.";

// Operations ------------------------------------------------------------------

const JOB_LOCKED = "Cannot modify a locked job. Reopen it first.";
const DISPATCH_LOCKED = "Cannot modify a locked dispatch. Reopen it first.";
const ISSUE_LOCKED = "Cannot modify a closed issue. Reopen it first.";
const STOCK_TRANSFER_LOCKED =
  "Cannot modify a locked stock transfer. Reopen it first.";
const WAREHOUSE_TRANSFER_LOCKED =
  "Cannot modify a locked warehouse transfer. Reopen it first.";

/** Header + line refs for an upsert whose payload carries the header key and,
 *  on update, its own line id. */
function lineUpsertRefs(
  param: string,
  headerKey: string,
  lineTable: string
): Ref[] {
  return [ref(param, headerKey), ref(param, "id", hop(lineTable, headerKey))];
}

const ISSUE_ASSOCIATION_TABLES: Record<string, string> = {
  items: "nonConformanceItem",
  customers: "nonConformanceCustomer",
  suppliers: "nonConformanceSupplier",
  jobOperations: "nonConformanceJobOperation",
  purchaseOrderLines: "nonConformancePurchaseOrderLine",
  salesOrderLines: "nonConformanceSalesOrderLine",
  shipmentLines: "nonConformanceShipmentLine",
  receiptLines: "nonConformanceReceiptLine",
  salesReturnOrderLines: "nonConformanceSalesReturnOrderLine",
  purchaseReturnOrderLines: "nonConformancePurchaseReturnOrderLine",
  trackedEntities: "nonConformanceTrackedEntity",
  inspections: "nonConformanceInspection"
};

/** The change-notice header fields whose edit is engineering content. */
const CHANGE_NOTICE_CONTENT_FIELDS = ["reasonForChange", "description"];

function touchesContentField(args: ResolvedArgs): boolean {
  const input = args.input;
  return (
    !!input &&
    typeof input === "object" &&
    CHANGE_NOTICE_CONTENT_FIELDS.some((f) => f in (input as Row))
  );
}

/** One maintenance-dispatch child upsert, registered under both modules that
 *  export it (resources and the production re-export). */
function dispatchChildUpsert(param: string, table: string, routes: string[]) {
  return {
    document: "maintenanceDispatch",
    refs: lineUpsertRefs(param, "maintenanceDispatchId", table),
    message: DISPATCH_LOCKED,
    routes
  } satisfies LockRule;
}

function dispatchChildDelete(param: string, table: string, route: string) {
  return {
    document: "maintenanceDispatch",
    refs: [ref(param, undefined, hop(table, "maintenanceDispatchId"))],
    message: DISPATCH_LOCKED,
    routes: [route]
  } satisfies LockRule;
}

const DISPATCH_COMMENT = dispatchChildUpsert(
  "comment",
  "maintenanceDispatchComment",
  ["maintenance+/$dispatchId.comments.tsx"]
);
const DISPATCH_EVENT = dispatchChildUpsert(
  "event",
  "maintenanceDispatchEvent",
  [
    "maintenance+/$dispatchId.event.new.tsx",
    "maintenance+/$dispatchId.event.$eventId.tsx",
    "maintenance+/$dispatchId.events.tsx"
  ]
);
const DISPATCH_ITEM = dispatchChildUpsert("item", "maintenanceDispatchItem", [
  "maintenance+/$dispatchId.items.tsx",
  "maintenance+/$dispatchId.item.new.tsx",
  "maintenance+/$dispatchId.add-and-issue.tsx"
]);
const DISPATCH_EVENT_DELETE = dispatchChildDelete(
  "eventId",
  "maintenanceDispatchEvent",
  "maintenance+/$dispatchId.event.$eventId.delete.tsx"
);
const DISPATCH_ITEM_DELETE = dispatchChildDelete(
  "itemId",
  "maintenanceDispatchItem",
  "maintenance+/$dispatchId.item.$itemId.delete.tsx"
);

const DISPATCH_HEADER_UPSERT = {
  document: "maintenanceDispatch",
  refs: [ref("dispatch", "id")],
  message: DISPATCH_LOCKED,
  on: "update",
  unlockedFields: ["status"],
  routes: ["maintenance+/update.tsx"]
} satisfies LockRule;

export const LOCK_OPERATIONS: Record<string, LockRule | LockRule[]> = {
  // ---- Sales orders
  sales_upsertSalesOrderLine: {
    document: "salesOrder",
    refs: lineUpsertRefs("salesOrderLine", "salesOrderId", "salesOrderLine"),
    message: {
      create: "Cannot add lines to a locked sales order. Reopen it first.",
      update: SALES_ORDER_LOCKED
    },
    routes: [
      "sales-order+/$orderId.new.tsx",
      "sales-order+/$orderId.$lineId.details.tsx"
    ]
  },
  sales_deleteSalesOrderLine: {
    document: "salesOrder",
    refs: [
      ref("salesOrderLineId", undefined, hop("salesOrderLine", "salesOrderId"))
    ],
    message: "Cannot delete lines on a locked sales order. Reopen it first.",
    routes: ["sales-order+/$orderId.$lineId.delete.tsx"]
  },
  sales_updateSalesOrder: {
    document: "salesOrder",
    refs: [ref("input", "id")],
    message: SALES_ORDER_LOCKED,
    routes: ["sales-order+/$orderId.details.tsx", "sales-order+/update.tsx"]
  },
  sales_updateSalesOrderExchangeRate: {
    document: "salesOrder",
    refs: [ref("data", "id")],
    message: SALES_ORDER_LOCKED,
    routes: ["sales-order+/$orderId.exchange-rate.tsx"]
  },
  sales_upsertSalesOrderPayment: {
    document: "salesOrder",
    refs: [ref("salesOrderPayment", "id")],
    message: SALES_ORDER_LOCKED,
    routes: ["sales-order+/$orderId.payment.tsx"]
  },
  sales_upsertSalesOrderShipment: {
    document: "salesOrder",
    refs: [ref("salesOrderShipment", "id")],
    message: SALES_ORDER_LOCKED,
    routes: ["sales-order+/$orderId.shipment.tsx"]
  },

  // The update branch of the header upsert edits the same fields the details
  // route does.
  sales_upsertSalesOrder: {
    document: "salesOrder",
    refs: [ref("salesOrder", "id")],
    message: SALES_ORDER_LOCKED,
    on: "update",
    routes: ["sales-order+/$orderId.details.tsx"]
  },

  // ---- Quotes
  sales_upsertQuoteLine: {
    document: "quote",
    refs: lineUpsertRefs("quotationLine", "quoteId", "quoteLine"),
    message: QUOTE_LOCKED,
    routes: ["quote+/$quoteId.new.tsx", "quote+/$quoteId.$lineId.details.tsx"]
  },
  sales_deleteQuoteLine: {
    document: "quote",
    refs: [ref("quoteLineId", undefined, hop("quoteLine", "quoteId"))],
    message: QUOTE_LOCKED,
    routes: ["quote+/$quoteId.$lineId.delete.tsx"]
  },
  sales_updateQuote: {
    document: "quote",
    refs: [ref("input", "id")],
    message: QUOTE_LOCKED,
    routes: ["quote+/$quoteId.details.tsx", "quote+/update.tsx"]
  },
  sales_updateQuoteExchangeRate: {
    document: "quote",
    refs: [ref("data", "id")],
    message: QUOTE_LOCKED,
    routes: ["quote+/$quoteId.exchange-rate.tsx"]
  },
  sales_upsertQuotePayment: {
    document: "quote",
    refs: [ref("quotePayment", "id")],
    message: QUOTE_LOCKED,
    routes: ["quote+/$quoteId.payment.tsx"]
  },
  sales_upsertQuoteShipment: {
    document: "quote",
    refs: [ref("quoteShipment", "id")],
    message: QUOTE_LOCKED,
    routes: ["quote+/$quoteId.shipment.tsx"]
  },

  sales_upsertQuote: {
    document: "quote",
    refs: [ref("quote", "id")],
    message: QUOTE_LOCKED,
    on: "update",
    routes: ["quote+/$quoteId.details.tsx"]
  },
  // Price resolution writes quoteLinePrice rows for a line.
  sales_resolveQuoteLinePrices: {
    document: "quote",
    refs: [
      ref("quoteId"),
      ref("quoteLineId", undefined, hop("quoteLine", "quoteId"))
    ],
    message: QUOTE_LOCKED,
    routes: ["quote+/$quoteId.new.tsx"]
  },
  sales_resolvePurchaseToOrderPrices: {
    document: "quote",
    refs: [
      ref("quoteId"),
      ref("quoteLineId", undefined, hop("quoteLine", "quoteId"))
    ],
    message: QUOTE_LOCKED,
    routes: ["quote+/$quoteId.new.tsx"]
  },

  // ---- Sales RFQs
  sales_upsertSalesRFQLine: {
    document: "salesRfq",
    refs: lineUpsertRefs("salesRfqLine", "salesRfqId", "salesRfqLine"),
    message: RFQ_LOCKED,
    routes: [
      "sales-rfq+/$rfqId.new.tsx",
      "sales-rfq+/$rfqId.$lineId.details.tsx"
    ]
  },
  sales_deleteSalesRFQLine: {
    document: "salesRfq",
    refs: [ref("salesRFQLineId", undefined, hop("salesRfqLine", "salesRfqId"))],
    message: RFQ_LOCKED,
    routes: ["sales-rfq+/$rfqId.$lineId.delete.tsx"]
  },
  sales_upsertSalesRFQ: {
    document: "salesRfq",
    refs: [ref("rfq", "id")],
    message: RFQ_LOCKED,
    on: "update",
    routes: ["sales-rfq+/$rfqId.details.tsx", "sales-rfq+/update.tsx"]
  },

  sales_updateSalesRFQ: {
    document: "salesRfq",
    refs: [ref("input", "id")],
    message: RFQ_LOCKED,
    routes: ["sales-rfq+/$rfqId.details.tsx", "sales-rfq+/update.tsx"]
  },

  // ---- Sales return orders
  sales_upsertSalesReturnOrderLine: {
    document: "salesReturnOrder",
    refs: lineUpsertRefs("line", "salesReturnOrderId", "salesReturnOrderLine"),
    message: { create: RETURN_ORDER_ADD_LOCKED, update: RETURN_ORDER_LOCKED },
    routes: [
      "sales-return-order+/$id.new.tsx",
      "sales-return-order+/$id.$lineId.details.tsx"
    ]
  },
  sales_deleteSalesReturnOrderLine: {
    document: "salesReturnOrder",
    refs: [
      ref(
        "lineId",
        undefined,
        hop("salesReturnOrderLine", "salesReturnOrderId")
      )
    ],
    message: RETURN_ORDER_DELETE_LOCKED,
    routes: ["sales-return-order+/$id.$lineId.delete.tsx"]
  },
  sales_updateSalesReturnOrder: {
    document: "salesReturnOrder",
    refs: [ref("salesReturnOrder", "id")],
    message: RETURN_ORDER_LOCKED,
    routes: ["sales-return-order+/update.tsx"]
  },

  // ---- Sales invoices
  invoicing_upsertSalesInvoiceLine: {
    document: "salesInvoice",
    refs: lineUpsertRefs("salesInvoiceLine", "invoiceId", "salesInvoiceLine"),
    message: SALES_INVOICE_LOCKED,
    routes: [
      "sales-invoice+/$invoiceId.new.tsx",
      "sales-invoice+/$invoiceId.$lineId.details.tsx"
    ]
  },
  invoicing_deleteSalesInvoiceLine: {
    document: "salesInvoice",
    refs: [
      ref("salesInvoiceLineId", undefined, hop("salesInvoiceLine", "invoiceId"))
    ],
    message: "Cannot delete lines on a locked sales invoice.",
    routes: ["sales-invoice+/$invoiceId.$lineId.delete.tsx"]
  },
  invoicing_updateSalesInvoice: {
    document: "salesInvoice",
    refs: [ref("input", "id")],
    message: SALES_INVOICE_LOCKED,
    // sales-invoice+/update.tsx edits the dates on a locked invoice.
    unlockedFields: ["dateIssued", "dateDue", "datePaid"],
    routes: [
      "sales-invoice+/$invoiceId.details.tsx",
      "sales-invoice+/update.tsx"
    ]
  },
  invoicing_updateSalesInvoiceExchangeRate: {
    document: "salesInvoice",
    refs: [ref("data", "id")],
    message: SALES_INVOICE_LOCKED,
    routes: ["sales-invoice+/$invoiceId.exchange-rate.tsx"]
  },
  invoicing_upsertSalesInvoiceShipment: {
    document: "salesInvoice",
    refs: [ref("salesInvoiceShipment", "id")],
    message: SALES_INVOICE_LOCKED,
    routes: ["sales-invoice+/$invoiceId.shipment.tsx"]
  },

  invoicing_upsertSalesInvoice: {
    document: "salesInvoice",
    refs: [ref("salesInvoice", "id")],
    message: SALES_INVOICE_LOCKED,
    on: "update",
    unlockedFields: ["dateIssued", "dateDue", "datePaid"],
    routes: [
      "sales-invoice+/$invoiceId.details.tsx",
      "sales-invoice+/update.tsx"
    ]
  },

  // ---- Purchase invoices
  invoicing_upsertPurchaseInvoiceLine: {
    document: "purchaseInvoice",
    refs: lineUpsertRefs(
      "purchaseInvoiceLine",
      "invoiceId",
      "purchaseInvoiceLine"
    ),
    message: PURCHASE_INVOICE_LOCKED,
    routes: [
      "purchase-invoice+/$invoiceId.new.tsx",
      "purchase-invoice+/$invoiceId.$lineId.details.tsx"
    ]
  },
  invoicing_deletePurchaseInvoiceLine: {
    document: "purchaseInvoice",
    refs: [
      ref(
        "purchaseInvoiceLineId",
        undefined,
        hop("purchaseInvoiceLine", "invoiceId")
      )
    ],
    message: "Cannot delete lines on a confirmed purchase invoice.",
    routes: ["purchase-invoice+/$invoiceId.$lineId.delete.tsx"]
  },
  invoicing_updatePurchaseInvoice: {
    document: "purchaseInvoice",
    refs: [ref("input", "id")],
    message: PURCHASE_INVOICE_LOCKED,
    // purchase-invoice+/update.tsx edits the dates on a locked invoice.
    unlockedFields: ["dateIssued", "dateDue", "datePaid"],
    routes: [
      "purchase-invoice+/$invoiceId.details.tsx",
      "purchase-invoice+/update.tsx"
    ]
  },
  invoicing_updatePurchaseInvoiceExchangeRate: {
    document: "purchaseInvoice",
    refs: [ref("data", "id")],
    message: PURCHASE_INVOICE_LOCKED,
    routes: ["purchase-invoice+/$invoiceId.exchange-rate.tsx"]
  },
  invoicing_upsertPurchaseInvoiceDelivery: {
    document: "purchaseInvoice",
    refs: [ref("purchaseInvoiceDelivery", "id")],
    message: PURCHASE_INVOICE_LOCKED,
    routes: ["purchase-invoice+/$invoiceId.delivery.tsx"]
  },

  invoicing_upsertPurchaseInvoice: {
    document: "purchaseInvoice",
    refs: [ref("purchaseInvoice", "id")],
    message: PURCHASE_INVOICE_LOCKED,
    on: "update",
    unlockedFields: ["dateIssued", "dateDue", "datePaid"],
    routes: [
      "purchase-invoice+/$invoiceId.details.tsx",
      "purchase-invoice+/update.tsx"
    ]
  },

  // ---- Purchase orders
  purchasing_upsertPurchaseOrderLine: {
    document: "purchaseOrder",
    refs: lineUpsertRefs(
      "purchaseOrderLine",
      "purchaseOrderId",
      "purchaseOrderLine"
    ),
    message: PURCHASE_ORDER_LOCKED,
    routes: [
      "purchase-order+/$orderId.new.tsx",
      "purchase-order+/$orderId.$lineId.details.tsx"
    ]
  },
  purchasing_deletePurchaseOrderLine: {
    document: "purchaseOrder",
    refs: [
      ref(
        "purchaseOrderLineId",
        undefined,
        hop("purchaseOrderLine", "purchaseOrderId")
      )
    ],
    message: "Cannot delete lines on a confirmed purchase order.",
    routes: ["purchase-order+/$orderId.$lineId.delete.tsx"]
  },
  purchasing_updatePurchaseOrder: {
    document: "purchaseOrder",
    refs: [ref("input", "id")],
    message:
      "Cannot modify a finalized purchase order. To make changes, please cancel this PO and create a new one.",
    routes: [
      "purchase-order+/$orderId.details.tsx",
      "purchase-order+/update.tsx"
    ]
  },
  purchasing_updatePurchaseOrderExchangeRate: {
    document: "purchaseOrder",
    refs: [ref("data", "id")],
    message: PURCHASE_ORDER_LOCKED,
    routes: ["purchase-order+/$orderId.exchange-rate.tsx"]
  },
  purchasing_upsertPurchaseOrderDelivery: {
    document: "purchaseOrder",
    refs: [ref("purchaseOrderDelivery", "id")],
    message: PURCHASE_ORDER_LOCKED,
    // purchase-order+/update.tsx edits deliveryDate on a locked order.
    unlockedFields: ["deliveryDate"],
    routes: [
      "purchase-order+/$orderId.delivery.tsx",
      "purchase-order+/update.tsx"
    ]
  },
  purchasing_upsertPurchaseOrderPayment: {
    document: "purchaseOrder",
    refs: [ref("purchaseOrderPayment", "id")],
    message: PURCHASE_ORDER_LOCKED,
    routes: ["purchase-order+/$orderId.payment.tsx"]
  },

  purchasing_upsertPurchaseOrder: {
    document: "purchaseOrder",
    refs: [ref("purchaseOrder", "id")],
    message:
      "Cannot modify a finalized purchase order. To make changes, please cancel this PO and create a new one.",
    on: "update",
    routes: ["purchase-order+/$orderId.details.tsx"]
  },

  // ---- Purchase return orders
  purchasing_upsertPurchaseReturnOrderLine: {
    document: "purchaseReturnOrder",
    refs: lineUpsertRefs(
      "line",
      "purchaseReturnOrderId",
      "purchaseReturnOrderLine"
    ),
    message: { create: RETURN_ORDER_ADD_LOCKED, update: RETURN_ORDER_LOCKED },
    routes: [
      "purchase-return-order+/$id.new.tsx",
      "purchase-return-order+/$id.$lineId.details.tsx"
    ]
  },
  purchasing_setPurchaseReturnOrderLineTrackedEntities: {
    document: "purchaseReturnOrder",
    refs: [
      ref(
        "lineId",
        undefined,
        hop("purchaseReturnOrderLine", "purchaseReturnOrderId")
      )
    ],
    message: RETURN_ORDER_LOCKED,
    routes: [
      "purchase-return-order+/$id.new.tsx",
      "purchase-return-order+/$id.$lineId.details.tsx"
    ]
  },
  purchasing_deletePurchaseReturnOrderLine: {
    document: "purchaseReturnOrder",
    refs: [
      ref(
        "lineId",
        undefined,
        hop("purchaseReturnOrderLine", "purchaseReturnOrderId")
      )
    ],
    message: RETURN_ORDER_DELETE_LOCKED,
    routes: ["purchase-return-order+/$id.$lineId.delete.tsx"]
  },
  purchasing_updatePurchaseReturnOrder: {
    document: "purchaseReturnOrder",
    refs: [ref("purchaseReturnOrder", "id")],
    message: RETURN_ORDER_LOCKED,
    routes: ["purchase-return-order+/update.tsx"]
  },

  // ---- Purchasing RFQs
  purchasing_upsertPurchasingRFQLine: {
    document: "purchasingRfq",
    refs: lineUpsertRefs(
      "purchasingRfqLine",
      "purchasingRfqId",
      "purchasingRfqLine"
    ),
    message: RFQ_LOCKED,
    routes: [
      "purchasing-rfq+/$rfqId.new.tsx",
      "purchasing-rfq+/$rfqId.$lineId.details.tsx"
    ]
  },
  purchasing_deletePurchasingRFQLine: {
    document: "purchasingRfq",
    refs: [
      ref(
        "purchasingRfqLineId",
        undefined,
        hop("purchasingRfqLine", "purchasingRfqId")
      )
    ],
    message: RFQ_LOCKED,
    routes: ["purchasing-rfq+/$rfqId.$lineId.delete.tsx"]
  },
  purchasing_upsertPurchasingRFQ: {
    document: "purchasingRfq",
    refs: [ref("purchasingRfq", "id")],
    message: RFQ_LOCKED,
    on: "update",
    routes: ["purchasing-rfq+/$rfqId.details.tsx", "purchasing-rfq+/update.tsx"]
  },

  purchasing_updatePurchasingRFQ: {
    document: "purchasingRfq",
    refs: [ref("input", "id")],
    message: RFQ_LOCKED,
    routes: ["purchasing-rfq+/$rfqId.details.tsx", "purchasing-rfq+/update.tsx"]
  },

  // ---- Supplier quotes
  purchasing_upsertSupplierQuoteLine: {
    document: "supplierQuote",
    refs: lineUpsertRefs(
      "supplierQuoteLine",
      "supplierQuoteId",
      "supplierQuoteLine"
    ),
    message: SUPPLIER_QUOTE_LOCKED,
    routes: [
      "supplier-quote+/$id.new.tsx",
      "supplier-quote+/$id.$lineId.details.tsx"
    ]
  },
  purchasing_deleteSupplierQuoteLine: {
    document: "supplierQuote",
    refs: [ref("id", undefined, hop("supplierQuoteLine", "supplierQuoteId"))],
    message: SUPPLIER_QUOTE_LOCKED,
    routes: ["supplier-quote+/$id.$lineId.delete.tsx"]
  },
  purchasing_updateSupplierQuote: {
    document: "supplierQuote",
    refs: [ref("input", "id")],
    message: SUPPLIER_QUOTE_LOCKED,
    routes: ["supplier-quote+/$id.details.tsx", "supplier-quote+/update.tsx"]
  },
  purchasing_updateSupplierQuoteExchangeRate: {
    document: "supplierQuote",
    refs: [ref("data", "id")],
    message: SUPPLIER_QUOTE_LOCKED,
    routes: ["supplier-quote+/$id.exchange-rate.tsx"]
  },

  purchasing_upsertSupplierQuote: {
    document: "supplierQuote",
    refs: [ref("supplierQuote", "id")],
    message: SUPPLIER_QUOTE_LOCKED,
    on: "update",
    routes: ["supplier-quote+/$id.details.tsx"]
  },

  // ---- Jobs. Only the create routes guard production quantities and events;
  // the edit routes ($jobId.quantities.$id, $jobId.events.$id) do not.
  production_updateJob: {
    document: "job",
    refs: [ref("input", "id")],
    message: JOB_LOCKED,
    routes: ["job+/$jobId.details.tsx", "job+/update.tsx"]
  },
  production_upsertProductionQuantity: {
    document: "job",
    refs: [
      ref("productionQuantity", "jobOperationId", hop("jobOperation", "jobId"))
    ],
    message: JOB_LOCKED,
    on: "create",
    routes: ["job+/$jobId.quantities.new.tsx"]
  },
  production_upsertProductionEvent: {
    document: "job",
    refs: [
      ref("productionEvent", "jobOperationId", hop("jobOperation", "jobId"))
    ],
    message: JOB_LOCKED,
    on: "create",
    routes: ["job+/$jobId.events.new.tsx"]
  },
  // The operation-completion tool records a production quantity, the action
  // the quantity-create route guards.
  production_completeOperation: {
    document: "job",
    refs: [ref("args", "operationId", hop("jobOperation", "jobId"))],
    message: JOB_LOCKED,
    routes: ["job+/$jobId.quantities.new.tsx"]
  },
  production_upsertJob: {
    document: "job",
    refs: [ref("job", "id")],
    message: JOB_LOCKED,
    on: "update",
    routes: ["job+/$jobId.details.tsx"]
  },

  // ---- Maintenance dispatches (resources and its production re-export)
  resources_upsertMaintenanceDispatchComment: DISPATCH_COMMENT,
  production_upsertMaintenanceDispatchComment: DISPATCH_COMMENT,
  resources_upsertMaintenanceDispatchEvent: DISPATCH_EVENT,
  production_upsertMaintenanceDispatchEvent: DISPATCH_EVENT,
  resources_upsertMaintenanceDispatchItem: DISPATCH_ITEM,
  production_upsertMaintenanceDispatchItem: DISPATCH_ITEM,
  resources_deleteMaintenanceDispatchEvent: DISPATCH_EVENT_DELETE,
  production_deleteMaintenanceDispatchEvent: DISPATCH_EVENT_DELETE,
  resources_deleteMaintenanceDispatchItem: DISPATCH_ITEM_DELETE,
  production_deleteMaintenanceDispatchItem: DISPATCH_ITEM_DELETE,
  resources_updateMaintenanceDispatch: {
    document: "maintenanceDispatch",
    refs: [ref("input", "id")],
    message: DISPATCH_LOCKED,
    // maintenance+/$dispatchId.status.tsx changes the status of a locked
    // dispatch (reopen) with no guard, and there is no separate status tool.
    unlockedFields: ["status"],
    routes: ["maintenance+/update.tsx"]
  },

  resources_upsertMaintenanceDispatch: DISPATCH_HEADER_UPSERT,
  production_upsertMaintenanceDispatch: DISPATCH_HEADER_UPSERT,

  // ---- Issues
  quality_updateIssue: {
    document: "issue",
    refs: [ref("input", "id")],
    message: ISSUE_LOCKED,
    routes: ["issue+/$id.details.tsx", "issue+/update.tsx"]
  },
  quality_upsertIssue: {
    document: "issue",
    refs: [ref("nonConformance", "id")],
    message: ISSUE_LOCKED,
    on: "update",
    routes: ["issue+/$id.details.tsx"]
  },
  quality_insertIssueReviewer: {
    document: "issue",
    refs: [ref("reviewer", "nonConformanceId")],
    message: ISSUE_LOCKED,
    routes: ["issue+/$id.review.tsx"]
  },
  quality_deleteIssueAssociation: {
    document: "issue",
    refs: [
      ref(
        "associationId",
        undefined,
        hop(
          (args) =>
            typeof args.type === "string"
              ? (ISSUE_ASSOCIATION_TABLES[args.type] ?? null)
              : null,
          "nonConformanceId"
        )
      )
    ],
    message: ISSUE_LOCKED,
    routes: ["issue+/$id.association.delete.$type.$associationId.tsx"]
  },

  // ---- Stock transfers
  inventory_upsertStockTransferLine: {
    document: "stockTransfer",
    refs: lineUpsertRefs(
      "stockTransferLine",
      "stockTransferId",
      "stockTransferLine"
    ),
    message: STOCK_TRANSFER_LOCKED,
    routes: [
      "stock-transfer+/$id.line.new.tsx",
      "stock-transfer+/$id.line.$lineId.tsx",
      "stock-transfer+/lines.update.tsx"
    ]
  },
  inventory_upsertStockTransferLines: {
    document: "stockTransfer",
    refs: [ref("args", "stockTransferId")],
    message: STOCK_TRANSFER_LOCKED,
    routes: ["stock-transfer+/$id.line.new.tsx"]
  },
  inventory_deleteStockTransferLine: {
    document: "stockTransfer",
    refs: [
      ref(
        "stockTransferLineId",
        undefined,
        hop("stockTransferLine", "stockTransferId")
      )
    ],
    message: STOCK_TRANSFER_LOCKED,
    routes: ["stock-transfer+/$id.line.$lineId.delete.tsx"]
  },
  inventory_deleteStockTransfer: {
    document: "stockTransfer",
    refs: [ref("stockTransferId")],
    message: STOCK_TRANSFER_LOCKED,
    routes: ["stock-transfer+/delete.$id.tsx"]
  },

  // ---- Warehouse transfers
  inventory_upsertWarehouseTransferLine: {
    document: "warehouseTransfer",
    refs: lineUpsertRefs("line", "transferId", "warehouseTransferLine"),
    message: WAREHOUSE_TRANSFER_LOCKED,
    routes: [
      "warehouse-transfer+/$transferId.details.new.tsx",
      "warehouse-transfer+/$transferId.details.$id.tsx"
    ]
  },
  inventory_deleteWarehouseTransferLine: {
    document: "warehouseTransfer",
    refs: [
      ref(
        "transferLineId",
        undefined,
        hop("warehouseTransferLine", "transferId")
      )
    ],
    message: WAREHOUSE_TRANSFER_LOCKED,
    routes: ["warehouse-transfer+/$transferId.details.$id.tsx"]
  },
  inventory_updateWarehouseTransfer: {
    document: "warehouseTransfer",
    refs: [ref("input", "id")],
    message: WAREHOUSE_TRANSFER_LOCKED,
    routes: ["warehouse-transfer+/$transferId.details.tsx"]
  },

  inventory_upsertWarehouseTransfer: {
    document: "warehouseTransfer",
    refs: [ref("transfer", "id")],
    message: WAREHOUSE_TRANSFER_LOCKED,
    on: "update",
    routes: ["warehouse-transfer+/$transferId.details.tsx"]
  },

  // ---- Payments: only the edit route guards (a create is always Draft).
  invoicing_upsertPayment: {
    document: "payment",
    refs: [ref("payment", "id")],
    message: "Only draft payments can be edited",
    on: "update",
    routes: ["payments+/$paymentId.tsx"]
  },

  // ---- Change notices
  items_updateChangeNotice: [
    {
      // Rich-text content (items+/change-notice+/$id.content.tsx).
      document: "changeNoticeEngineering",
      refs: [ref("input", "id")],
      when: touchesContentField,
      routes: ["items+/change-notice+/$id.content.tsx"]
    },
    {
      // Header fields (items+/change-notice+/update.tsx).
      document: "changeNotice",
      refs: [ref("input", "id")],
      message: "Cannot modify a completed change notice.",
      when: (args) => !touchesContentField(args),
      routes: ["items+/change-notice+/update.tsx"]
    }
  ],
  items_addChangeNoticeAffectedItem: {
    document: "changeNoticeEngineering",
    refs: [ref("input", "changeNoticeId")],
    routes: ["items+/change-notice+/$id.affected.tsx"]
  },
  // Creates the change-notice-owned draft method for an affected item — the
  // write the affected-item route makes through addChangeNoticeAffectedItem.
  items_createChangeNoticeDraftMethod: {
    document: "changeNoticeEngineering",
    refs: [ref("input", "changeNoticeId")],
    routes: ["items+/change-notice+/$id.affected.tsx"]
  },
  items_removeChangeNoticeAffectedItem: {
    document: "changeNoticeEngineering",
    refs: [
      ref("id", undefined, hop("changeOrderAffectedItem", "changeOrderId"))
    ],
    routes: ["items+/change-notice+/$id.affected.delete.$affectedId.tsx"]
  },
  items_updateChangeNoticeAffectedItemChangeType: {
    document: "changeNoticeEngineering",
    refs: [ref("input", "id", hop("changeOrderAffectedItem", "changeOrderId"))],
    routes: ["items+/change-notice+/$id.affected.$affectedId.change-type.tsx"]
  },
  items_updateChangeNoticeAffectedItemCutover: {
    document: "changeNoticeEngineering",
    refs: [ref("input", "id", hop("changeOrderAffectedItem", "changeOrderId"))],
    routes: ["items+/change-notice+/$id.affected.$affectedId.cutover.tsx"]
  },
  items_setChangeNoticeActionTasks: {
    document: "changeNoticeWorkflow",
    refs: [ref("input", "changeNoticeId")],
    routes: ["items+/change-notice+/$id.action.tsx"]
  },
  items_updateChangeNoticeActionStatus: {
    document: "changeNoticeWorkflow",
    refs: [ref("input", "id", hop("changeOrderActionTask", "changeOrderId"))],
    routes: ["items+/change-notice+/$id.action.$actionId.status.tsx"]
  },
  items_deleteChangeNoticeAction: {
    document: "changeNoticeWorkflow",
    refs: [ref("id", undefined, hop("changeOrderActionTask", "changeOrderId"))],
    routes: ["items+/change-notice+/$id.action.delete.$actionId.tsx"]
  },
  items_updateChangeNoticeActionOrder: {
    document: "changeNoticeWorkflow",
    refs: [
      ref("changeNoticeId"),
      ref("updates", "id", hop("changeOrderActionTask", "changeOrderId"))
    ],
    routes: ["items+/change-notice+/$id.action.order.tsx"]
  }
};

// ---------------------------------------------------------------------------
// Table 2 — make-method locks (checkRevisionLock + assertMethodOperationIsDraft).
// ---------------------------------------------------------------------------

export type MethodLockRule = {
  /** checkRevisionLock(kind, id) for every id the refs resolve to. The refs
   *  resolve to the entity of that kind (a material id for "material", …). */
  revision?: { kind: LockKind; refs: Ref[] }[];
  /** assertMethodOperationIsDraft for every method operation id resolved. */
  draftOperation?: Ref[];
  routes: string[];
};

const stepToOperation = hop("methodOperationStep", "operationId");
const slideToStep = hop("methodOperationStepSlide", "stepId");

export const METHOD_LOCK_OPERATIONS: Record<string, MethodLockRule> = {
  items_upsertMethodMaterial: {
    revision: [
      { kind: "makeMethod", refs: [ref("methodMaterial", "makeMethodId")] },
      { kind: "material", refs: [ref("methodMaterial", "id")] }
    ],
    routes: [
      "items+/methods+/material.new.tsx",
      "items+/methods+/material.$id.tsx"
    ]
  },
  items_deleteMethodMaterial: {
    revision: [{ kind: "material", refs: [ref("id")] }],
    routes: ["items+/methods+/material.delete.$id.tsx"]
  },
  items_updateMaterialOrder: {
    revision: [{ kind: "material", refs: [ref("updates", "id")] }],
    routes: ["items+/methods+/material.order.tsx"]
  },
  items_upsertMethodOperation: {
    revision: [
      { kind: "makeMethod", refs: [ref("methodOperation", "makeMethodId")] },
      { kind: "operation", refs: [ref("methodOperation", "id")] }
    ],
    routes: [
      "items+/methods+/operation.new.tsx",
      "items+/methods+/operation.$id.tsx"
    ]
  },
  items_deleteMethodOperation: {
    // The route deletes with the client directly; this is its service twin.
    revision: [{ kind: "operation", refs: [ref("methodOperationId")] }],
    routes: ["items+/methods+/operation.delete.tsx"]
  },
  items_updateOperationOrder: {
    revision: [{ kind: "operation", refs: [ref("updates", "id")] }],
    routes: ["items+/methods+/operation.order.tsx"]
  },
  production_updateMethodOperationStepOrder: {
    revision: [
      { kind: "operation", refs: [ref("updates", "id", stepToOperation)] }
    ],
    draftOperation: [ref("updates", "id", stepToOperation)],
    routes: ["items+/methods+/operation.$operationId.step.order.tsx"]
  },
  items_upsertMethodOperationParameter: {
    revision: [
      {
        kind: "operation",
        refs: [ref("methodOperationParameter", "operationId")]
      },
      { kind: "parameter", refs: [ref("methodOperationParameter", "id")] }
    ],
    routes: [
      "items+/methods+/operation.parameter.new.tsx",
      "items+/methods+/operation.parameter.$id.tsx"
    ]
  },
  items_deleteMethodOperationParameter: {
    revision: [{ kind: "parameter", refs: [ref("id")] }],
    routes: ["items+/methods+/operation.parameter.delete.$id.tsx"]
  },
  items_upsertMethodOperationTool: {
    revision: [
      { kind: "operation", refs: [ref("methodOperationTool", "operationId")] },
      { kind: "tool", refs: [ref("methodOperationTool", "id")] }
    ],
    routes: [
      "items+/methods+/operation.tool.new.tsx",
      "items+/methods+/operation.tool.$id.tsx"
    ]
  },
  items_deleteMethodOperationTool: {
    revision: [{ kind: "tool", refs: [ref("id")] }],
    routes: ["items+/methods+/operation.tool.delete.$id.tsx"]
  },
  items_upsertMethodOperationStep: {
    revision: [
      {
        kind: "operation",
        refs: [
          ref("methodOperationStep", "operationId"),
          ref("methodOperationStep", "id", stepToOperation)
        ]
      }
    ],
    draftOperation: [
      ref("methodOperationStep", "operationId"),
      ref("methodOperationStep", "id", stepToOperation)
    ],
    routes: [
      "items+/methods+/operation.step.new.tsx",
      "items+/methods+/operation.step.$id.tsx"
    ]
  },
  items_deleteMethodOperationStep: {
    revision: [
      { kind: "operation", refs: [ref("id", undefined, stepToOperation)] }
    ],
    draftOperation: [ref("id", undefined, stepToOperation)],
    routes: ["items+/methods+/operation.step.delete.$id.tsx"]
  },
  // The step-detail routes below check only the Draft version rule.
  items_duplicateMethodOperationStep: {
    draftOperation: [ref("args", "id", stepToOperation)],
    routes: ["items+/methods+/operation.step.duplicate.$id.tsx"]
  },
  items_upsertMethodOperationStepSlide: {
    draftOperation: [
      ref("slide", "stepId", stepToOperation),
      ref("slide", "id", slideToStep, stepToOperation)
    ],
    routes: ["items+/methods+/operation.step.slide.new.tsx"]
  },
  items_deleteMethodOperationStepSlide: {
    draftOperation: [ref("id", undefined, slideToStep, stepToOperation)],
    routes: ["items+/methods+/operation.step.slide.delete.$id.tsx"]
  },
  items_setMethodMaterialStepLink: {
    draftOperation: [ref("args", "methodOperationStepId", stepToOperation)],
    routes: ["items+/methods+/operation.step.material.tsx"]
  },
  // The BOM-side rewrite of a material's step links; the UI edits the same
  // links from the step side (operation.step.material.tsx).
  items_replaceMethodMaterialSteps: {
    draftOperation: [ref("methodOperationStepIds", undefined, stepToOperation)],
    routes: ["items+/methods+/operation.step.material.tsx"]
  },
  items_setMethodOperationToolStepLink: {
    draftOperation: [
      ref("args", "operationId"),
      ref("args", "methodOperationStepId", stepToOperation)
    ],
    routes: ["items+/methods+/operation.step.tool.tsx"]
  },
  // items+/methods+/get.tsx and save.tsx gate the copy on the TARGET item.
  items_copyItem: {
    revision: [{ kind: "item", refs: [ref("args", "targetId")] }],
    routes: ["items+/methods+/get.tsx", "items+/methods+/save.tsx"]
  },
  items_activateMethodVersion: {
    revision: [{ kind: "makeMethod", refs: [ref("payload", "id")] }],
    routes: ["items+/methods+/versions.activate.$id.tsx"]
  }
};

// ---------------------------------------------------------------------------
// Table 3 — inline route guards (delete of posted / non-draft documents, the
// return-order line rules). Each mirrors the imperative check in its route.
// ---------------------------------------------------------------------------

export type InlineGuard = {
  routes: string[];
  /** The check branches on `create` (decided by `INSERT_TESTS`). */
  createAware?: true;
  check: (
    args: ResolvedArgs,
    reader: LockReader,
    create: boolean
  ) => Promise<string | null>;
};

function scalar(args: ResolvedArgs, param: string): string | null {
  const v = args[param];
  return typeof v === "string" && v !== "" ? v : null;
}

async function postedDeleteGuard(
  table: "receipt" | "shipment",
  id: string | null,
  reader: LockReader,
  message: string
): Promise<string | null> {
  if (!id) return null;
  const [row] = await reader.select(table, ["id", "postingDate"], [id]);
  return row?.postingDate ? message : null;
}

/** sales-return-order+/$id.delete.tsx and purchase-return-order+/$id.delete.tsx */
async function returnOrderDeleteGuard(
  id: string | null,
  reader: LockReader,
  spec: {
    table: "salesReturnOrder" | "purchaseReturnOrder";
    lineTable: "salesReturnOrderLine" | "purchaseReturnOrderLine";
    lineFk: string;
    quantityColumn: "quantityReceived" | "quantityShipped";
    quantityMessage: string;
  }
): Promise<string | null> {
  if (!id) return null;
  const [order] = await reader.select(spec.table, ["id", "status"], [id]);
  if (!order) return null;
  if (!["Draft", "Cancelled"].includes((order.status as string) ?? "")) {
    return "Only draft or cancelled return orders can be deleted. Cancel the order first.";
  }
  const lines = await reader.select(
    spec.lineTable,
    ["id", spec.quantityColumn],
    [id],
    spec.lineFk
  );
  return lines.some((line) => Number(line[spec.quantityColumn]) > 0)
    ? spec.quantityMessage
    : null;
}

async function returnLineDeleteGuard(
  lineId: string | null,
  reader: LockReader,
  lineTable: "salesReturnOrderLine" | "purchaseReturnOrderLine",
  quantityColumn: "quantityReceived" | "quantityShipped",
  message: string
): Promise<string | null> {
  if (!lineId) return null;
  const [line] = await reader.select(
    lineTable,
    ["id", quantityColumn],
    [lineId]
  );
  return line && Number(line[quantityColumn]) > 0 ? message : null;
}

type FrozenField = { label: string; key: string; numeric?: boolean };

/**
 * The fields a confirmed return-order line may not change (validated against
 * source-line caps at Confirm). Mirrors the route: a field counts as changed
 * only when it was provided AND differs.
 */
export function changedFrozenField(
  payload: Row,
  existing: Row,
  fields: FrozenField[]
): string | null {
  for (const field of fields) {
    const raw = payload[field.key];
    if (raw === undefined) continue;
    const next = field.numeric ? Number(raw) : raw;
    const current = field.numeric
      ? Number(existing[field.key])
      : (existing[field.key] ?? undefined);
    if (next !== current) return field.label;
  }
  return null;
}

const RETURN_LINE_FROZEN_COMMON: FrozenField[] = [
  { label: "Quantity", key: "quantity", numeric: true },
  { label: "Item", key: "itemId" },
  { label: "Unit price", key: "unitPrice", numeric: true },
  { label: "Restocking fee", key: "restockFeePercent", numeric: true },
  { label: "Unit of measure", key: "unitOfMeasureCode" }
];

function returnLineUpsertGuard(spec: {
  headerTable: "salesReturnOrder" | "purchaseReturnOrder";
  lineTable: "salesReturnOrderLine" | "purchaseReturnOrderLine";
  headerKey: "salesReturnOrderId" | "purchaseReturnOrderId";
  links: FrozenField[];
}): InlineGuard["check"] {
  const frozen = [...RETURN_LINE_FROZEN_COMMON, ...spec.links];
  return async (args, reader, create) => {
    const payload = args.line;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return null;
    }
    const line = payload as Row;

    if (create) {
      const orderId =
        typeof line[spec.headerKey] === "string"
          ? (line[spec.headerKey] as string)
          : null;
      if (!orderId) return null;
      const [order] = await reader.select(
        spec.headerTable,
        ["id", "status"],
        [orderId]
      );
      if (order && order.status !== "Draft") {
        return "Lines can only be added while the return order is Draft";
      }
      return null;
    }

    const lineId = line.id as string;
    const [existing] = await reader.select(
      spec.lineTable,
      ["id", spec.headerKey, ...frozen.map((f) => f.key)],
      [lineId]
    );
    if (!existing) return null;
    // The route never re-parents a line to another order.
    const target = line[spec.headerKey];
    if (typeof target === "string" && target !== existing[spec.headerKey]) {
      return "This line does not belong to this return order";
    }
    const [order] = await reader.select(
      spec.headerTable,
      ["id", "status"],
      [existing[spec.headerKey] as string]
    );
    if (!order || order.status === "Draft") return null;
    const changed = changedFrozenField(line, existing, frozen);
    return changed ? `${changed} is locked after confirmation` : null;
  };
}

/** purchase-order+/$orderId.delete.tsx — pure verdict over what it reads. */
export function purchaseOrderDeleteVerdict(
  status: string | null | undefined,
  approval: { isRequester: boolean; isApprover: boolean } | null
): string | null {
  if (status === "Needs Approval" && approval && !approval.isRequester) {
    return approval.isApprover
      ? "Approvers cannot delete purchase orders. Please reject the approval request instead."
      : "Only the requester can delete a purchase order that needs approval";
  }
  if (!status || !["Draft", "Planned", "Needs Approval"].includes(status)) {
    return `Cannot delete purchase order with status "${status ?? "unknown"}". Only Draft, Planned, or Needs Approval (if you're the requester) purchase orders can be deleted.`;
  }
  return null;
}

export const INLINE_GUARDS: Record<string, InlineGuard> = {
  inventory_deleteReceipt: {
    routes: ["receipt+/$receiptId.delete.tsx"],
    check: (args, reader) =>
      postedDeleteGuard(
        "receipt",
        scalar(args, "receiptId"),
        reader,
        "Cannot delete a posted receipt"
      )
  },
  inventory_deleteShipment: {
    routes: ["shipment+/$shipmentId.delete.tsx"],
    check: (args, reader) =>
      postedDeleteGuard(
        "shipment",
        scalar(args, "shipmentId"),
        reader,
        "Cannot delete a posted shipment"
      )
  },
  inventory_deleteInventoryCount: {
    routes: ["inventory-count+/$id.delete.tsx"],
    check: async (args, reader) => {
      const id = scalar(args, "id");
      if (!id) return null;
      const [row] = await reader.select(
        "inventoryCount",
        ["id", "status"],
        [id]
      );
      return row?.status === "Posted"
        ? "Cannot delete a posted count. Roll it back instead."
        : null;
    }
  },
  purchasing_deletePurchaseOrder: {
    routes: ["purchase-order+/$orderId.delete.tsx"],
    check: async (args, reader) => {
      const id = scalar(args, "purchaseOrderId");
      if (!id) return null;
      const [row] = await reader.select(
        "purchaseOrder",
        ["id", "status"],
        [id]
      );
      // Not found in the caller's company: the service deletes nothing.
      if (!row) return null;
      const status = row.status as string | null;
      const approval =
        status === "Needs Approval"
          ? await reader.purchaseOrderApproval(id)
          : null;
      return purchaseOrderDeleteVerdict(status, approval);
    }
  },
  sales_deleteSalesReturnOrder: {
    routes: ["sales-return-order+/$id.delete.tsx"],
    check: (args, reader) =>
      returnOrderDeleteGuard(scalar(args, "salesReturnOrderId"), reader, {
        table: "salesReturnOrder",
        lineTable: "salesReturnOrderLine",
        lineFk: "salesReturnOrderId",
        quantityColumn: "quantityReceived",
        quantityMessage: "Cannot delete a return order with received quantity"
      })
  },
  purchasing_deletePurchaseReturnOrder: {
    routes: ["purchase-return-order+/$id.delete.tsx"],
    check: (args, reader) =>
      returnOrderDeleteGuard(scalar(args, "purchaseReturnOrderId"), reader, {
        table: "purchaseReturnOrder",
        lineTable: "purchaseReturnOrderLine",
        lineFk: "purchaseReturnOrderId",
        quantityColumn: "quantityShipped",
        quantityMessage: "Cannot delete a return order with shipped quantity"
      })
  },
  sales_deleteSalesReturnOrderLine: {
    routes: ["sales-return-order+/$id.$lineId.delete.tsx"],
    check: (args, reader) =>
      returnLineDeleteGuard(
        scalar(args, "lineId"),
        reader,
        "salesReturnOrderLine",
        "quantityReceived",
        "Cannot delete a line with received quantity"
      )
  },
  purchasing_deletePurchaseReturnOrderLine: {
    routes: ["purchase-return-order+/$id.$lineId.delete.tsx"],
    check: (args, reader) =>
      returnLineDeleteGuard(
        scalar(args, "lineId"),
        reader,
        "purchaseReturnOrderLine",
        "quantityShipped",
        "Cannot delete a line with shipped quantity"
      )
  },
  sales_upsertSalesReturnOrderLine: {
    createAware: true,
    routes: [
      "sales-return-order+/$id.new.tsx",
      "sales-return-order+/$id.$lineId.details.tsx"
    ],
    check: returnLineUpsertGuard({
      headerTable: "salesReturnOrder",
      lineTable: "salesReturnOrderLine",
      headerKey: "salesReturnOrderId",
      links: [
        { label: "Sales order line link", key: "salesOrderLineId" },
        { label: "Shipment line link", key: "shipmentLineId" },
        { label: "Invoice line link", key: "salesInvoiceLineId" }
      ]
    })
  },
  purchasing_upsertPurchaseReturnOrderLine: {
    createAware: true,
    routes: [
      "purchase-return-order+/$id.new.tsx",
      "purchase-return-order+/$id.$lineId.details.tsx"
    ],
    check: returnLineUpsertGuard({
      headerTable: "purchaseReturnOrder",
      lineTable: "purchaseReturnOrderLine",
      headerKey: "purchaseReturnOrderId",
      links: [
        { label: "Purchase order line link", key: "purchaseOrderLineId" },
        { label: "Receipt line link", key: "receiptLineId" },
        { label: "Invoice line link", key: "purchaseInvoiceLineId" }
      ]
    })
  }
};

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/** Keys every write payload may carry that say nothing about what it edits. */
const NEUTRAL_KEYS = new Set([
  "id",
  "updatedBy",
  "updatedAt",
  "createdBy",
  "companyId",
  "companyGroupId"
]);

function touchesOnly(
  args: ResolvedArgs,
  param: string,
  allowed: string[]
): boolean {
  const value = args[param];
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value as Row).filter(
    (k) => !NEUTRAL_KEYS.has(k) && (value as Row)[k] !== undefined
  );
  return keys.length > 0 && keys.every((k) => allowed.includes(k));
}

async function checkLockRule(
  tool: string,
  rule: LockRule,
  args: ResolvedArgs,
  reader: LockReader
): Promise<string | null> {
  const writeParam = rule.writeParam ?? rule.refs[0]?.param;
  const create = writeParam ? isCreate(tool, args, writeParam) : false;
  if (rule.on === "create" && !create) return null;
  if (rule.on === "update" && create) return null;
  if (rule.when && !rule.when(args)) return null;
  if (
    rule.unlockedFields &&
    writeParam &&
    touchesOnly(args, writeParam, rule.unlockedFields)
  ) {
    return null;
  }

  const ids = await resolveRefIds(args, rule.refs, reader);
  if (ids.length === 0) return null;

  const spec: DocumentSpec = LOCKABLE_DOCUMENTS[rule.document];
  const rows = await reader.select(spec.table, ["id", "status"], ids);
  const locked = rows.find((row) => spec.isLocked(row.status as string | null));
  if (!locked) return null;

  if (spec.message) return spec.message(locked.status as string | null);
  if (typeof rule.message === "string") return rule.message;
  if (rule.message) return create ? rule.message.create : rule.message.update;
  return "Cannot modify a locked document. Reopen it first.";
}

async function checkMethodRule(
  rule: MethodLockRule,
  args: ResolvedArgs,
  reader: LockReader
): Promise<string | null> {
  for (const revision of rule.revision ?? []) {
    const ids = await resolveRefIds(args, revision.refs, reader);
    for (const id of ids) {
      const lock = await reader.revisionLock(revision.kind, id);
      // `warn` proceeds, exactly as the routes proceed and flash.
      if (!lock.ok) return lock.message;
    }
  }
  if (rule.draftOperation) {
    const operationIds = await resolveRefIds(args, rule.draftOperation, reader);
    for (const operationId of operationIds) {
      const message = await reader.methodOperationDraftError(operationId);
      if (message) return message;
    }
  }
  return null;
}

/**
 * Evaluate every lock the routes enforce for this operation. Returns the
 * route's refusal message, or null when the write may proceed. Operations with
 * no entry return null without reading anything.
 */
export async function evaluateDocumentLocks(
  meta: Pick<ManifestEntry, "name" | "serviceParams">,
  functionArgs: unknown[],
  reader: LockReader
): Promise<string | null> {
  if (!hasDocumentLock(meta.name)) return null;
  const lockRules = LOCK_OPERATIONS[meta.name];
  const methodRule = METHOD_LOCK_OPERATIONS[meta.name];
  const inline = INLINE_GUARDS[meta.name];

  const args = resolveArgs(meta, functionArgs);

  for (const rule of lockRules
    ? Array.isArray(lockRules)
      ? lockRules
      : [lockRules]
    : []) {
    const message = await checkLockRule(meta.name, rule, args, reader);
    if (message) return message;
  }

  if (methodRule) {
    const message = await checkMethodRule(methodRule, args, reader);
    if (message) return message;
  }

  if (inline) {
    const rules = lockRules
      ? Array.isArray(lockRules)
        ? lockRules
        : [lockRules]
      : [];
    const writeParam = rules[0]?.writeParam ?? rules[0]?.refs[0]?.param;
    const create = writeParam ? isCreate(meta.name, args, writeParam) : false;
    const message = await inline.check(args, reader, create);
    if (message) return message;
  }

  return null;
}

/** Whether any table gates this operation. */
export function hasDocumentLock(name: string): boolean {
  return (
    Object.hasOwn(LOCK_OPERATIONS, name) ||
    Object.hasOwn(METHOD_LOCK_OPERATIONS, name) ||
    Object.hasOwn(INLINE_GUARDS, name)
  );
}

/** Every tool name any table gates — for the coverage test. */
export function gatedToolNames(): string[] {
  return [
    ...new Set([
      ...Object.keys(LOCK_OPERATIONS),
      ...Object.keys(METHOD_LOCK_OPERATIONS),
      ...Object.keys(INLINE_GUARDS)
    ])
  ];
}

/** Every tool whose verdict depends on create vs update — for the coverage
 *  test, which requires each to name its service's test in `INSERT_TESTS`. */
export function createSensitiveToolNames(): string[] {
  const out = new Set<string>();
  for (const [tool, rules] of Object.entries(LOCK_OPERATIONS)) {
    for (const rule of Array.isArray(rules) ? rules : [rules]) {
      if (rule.on || (rule.message && typeof rule.message === "object")) {
        out.add(tool);
      }
    }
  }
  for (const [tool, guard] of Object.entries(INLINE_GUARDS)) {
    if (guard.createAware) out.add(tool);
  }
  return [...out];
}

/** Every route a gate entry cites, keyed by tool — for the coverage test. */
export function gateRoutesByTool(): Record<string, string[]> {
  const out: Record<string, Set<string>> = {};
  const add = (tool: string, routes: string[]) => {
    out[tool] ??= new Set();
    for (const r of routes) out[tool].add(r);
  };
  for (const [tool, rules] of Object.entries(LOCK_OPERATIONS)) {
    for (const rule of Array.isArray(rules) ? rules : [rules]) {
      add(tool, rule.routes);
    }
  }
  for (const [tool, rule] of Object.entries(METHOD_LOCK_OPERATIONS)) {
    add(tool, rule.routes);
  }
  for (const [tool, guard] of Object.entries(INLINE_GUARDS)) {
    add(tool, guard.routes);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v]]));
}
