// The identifier contract for Carbon API / MCP operations.
//
// A document table carries two identifiers: the record id (`id`, what routes put
// in the URL and every service filters on) and a readable number people type
// (`job.jobId` = "J000123", `quote.quoteId`, `item.readableIdWithRevision`, …).
// Services name their key param after the entity (`jobId`, `quoteId`), which is
// ALSO the name of the readable column in every list row, so a caller reading a
// list and passing its `jobId` field handed a readable number to an `.eq("id")`
// filter: reads came back empty and deletes matched nothing.
//
// The contract: a param that keys an entity takes the record id, and the
// dispatcher (`api+/v1+/lib/identifier-resolver.server.ts`) also accepts the
// readable number and resolves it within the caller's company before the
// service runs — the same id-then-readable lookup the typed item upserts use
// (`resolveTypedItem` in items.service.ts). Routes always pass the id, so they
// are untouched.
//
// Pure data: read by the manifest generator (which marks keyed params and
// describes them) and by the dispatcher (which resolves them).

export interface IdentifierKey {
  /** Table whose `id` the param carries. Every table here has `companyId`. */
  table: string;
  /** Readable columns tried, in order, after `id`. Empty for an id-only key. */
  readable: string[];
  /** Why a readable-looking column is not accepted (id-only keys). */
  idOnlyReason?: string;
}

/** Entity name → key. The entity name is the table name. */
export const IDENTIFIER_KEYS: Record<string, IdentifierKey> = {
  cardTransaction: {
    table: "cardTransaction",
    readable: ["cardTransactionId"]
  },
  changeOrder: { table: "changeOrder", readable: ["changeOrderId"] },
  depreciationRun: {
    table: "depreciationRun",
    readable: ["depreciationRunId"]
  },
  fixedAsset: { table: "fixedAsset", readable: ["fixedAssetId"] },
  gauge: { table: "gauge", readable: ["gaugeId"] },
  inspection: { table: "inspection", readable: ["inspectionId"] },
  inventoryCount: { table: "inventoryCount", readable: ["inventoryCountId"] },
  // A readable id names every revision of an item; readableIdWithRevision
  // names one (and equals readableId for the first revision).
  item: { table: "item", readable: ["readableIdWithRevision", "readableId"] },
  job: { table: "job", readable: ["jobId"] },
  maintenanceDispatch: {
    table: "maintenanceDispatch",
    readable: ["maintenanceDispatchId"]
  },
  memo: { table: "memo", readable: ["memoId"] },
  nonConformance: { table: "nonConformance", readable: ["nonConformanceId"] },
  payment: { table: "payment", readable: ["paymentId"] },
  pickingList: { table: "pickingList", readable: ["pickingListId"] },
  purchaseInvoice: { table: "purchaseInvoice", readable: ["invoiceId"] },
  purchaseOrder: { table: "purchaseOrder", readable: ["purchaseOrderId"] },
  purchaseReturnOrder: {
    table: "purchaseReturnOrder",
    readable: ["purchaseReturnOrderId"]
  },
  purchasingRfq: { table: "purchasingRfq", readable: ["rfqId"] },
  quote: { table: "quote", readable: ["quoteId"] },
  receipt: { table: "receipt", readable: ["receiptId"] },
  salesInvoice: { table: "salesInvoice", readable: ["invoiceId"] },
  salesOrder: { table: "salesOrder", readable: ["salesOrderId"] },
  salesReturnOrder: {
    table: "salesReturnOrder",
    readable: ["salesReturnOrderId"]
  },
  salesRfq: { table: "salesRfq", readable: ["rfqId"] },
  shipment: { table: "shipment", readable: ["shipmentId"] },
  stockTransfer: { table: "stockTransfer", readable: ["stockTransferId"] },
  supplierPart: {
    table: "supplierPart",
    readable: [],
    idOnlyReason:
      "supplierPart.supplierPartId is the supplier's own part number, not unique within the company"
  },
  supplierQuote: { table: "supplierQuote", readable: ["supplierQuoteId"] },
  warehouseTransfer: { table: "warehouseTransfer", readable: ["transferId"] }
};

/**
 * Param name → entity, for names that are not simply `${entity}Id`. A name
 * shared by two entities (`invoiceId`, `rfqId`) is deliberately absent: the
 * tool has to say which one it means in `TOOL_IDENTIFIER_KEYS`.
 */
const PARAM_NAME_ALIASES: Record<string, string> = {
  transferId: "warehouseTransfer"
};

/**
 * Per-tool entity for a param whose name alone is ambiguous. `null` records a
 * reviewed param that is not an entity key.
 */
export const TOOL_IDENTIFIER_KEYS: Record<
  string,
  Record<string, string | null>
> = {
  invoicing_updatePurchaseInvoiceLineOrder: { invoiceId: "purchaseInvoice" },
  invoicing_updateSalesInvoiceLineOrder: { invoiceId: "salesInvoice" },
  // `side` picks the invoice table at run time.
  invoicing_getInvoiceSettlementsForInvoice: { invoiceId: null }
};

/** The entity a tool's scalar param keys, or null when it keys none. */
export function identifierEntityFor(
  toolName: string,
  paramName: string
): string | null {
  const perTool = TOOL_IDENTIFIER_KEYS[toolName];
  if (perTool && paramName in perTool) return perTool[paramName];
  const alias = PARAM_NAME_ALIASES[paramName];
  if (alias) return alias;
  const match = paramName.match(/^(\w+)Id$/);
  if (match && match[1] in IDENTIFIER_KEYS) return match[1];
  return null;
}

function humanize(entity: string): string {
  return entity
    .replace(/([A-Z])/g, " $1")
    .trim()
    .toLowerCase()
    .replace(/\brfq\b/, "RFQ");
}

/** The sentence the manifest publishes on a keyed param. */
export function describeIdentifierKey(entity: string): string {
  const key = IDENTIFIER_KEYS[entity];
  const label = humanize(entity);
  const id = `The ${label} record id (the \`id\` field of ${label} rows).`;
  if (key.readable.length === 0) {
    return key.idOnlyReason
      ? `${id} Only the id is accepted: ${key.idOnlyReason}.`
      : id;
  }
  const readable = key.readable.map((c) => `\`${c}\``).join(" or ");
  return `${id} The readable identifier (${readable}) is also accepted and resolved within the company; one that matches more than one record, such as several revisions, is refused.`;
}
