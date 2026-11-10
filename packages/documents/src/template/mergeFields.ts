// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { isEditableValue, type MergeField } from "./merge";
import type { DocumentTemplateType } from "./schema";

/** A value a document may change. */
const value = <T extends string>(token: T, label: string, group: string) =>
  ({ token, label, group }) as const;
/** A figure: `MergeField.amount`. */
const figure = <T extends string>(token: T, label: string, group: string) =>
  ({ token, label, group, amount: true }) as const;
/** A value no document can change: `MergeField.fixed`. */
const locked = <T extends string>(token: T, label: string, group: string) =>
  ({ token, label, group, fixed: true }) as const;

/** The six lines of a party's address, as `{prefix.field}` variables. */
export type AddressField =
  | "name"
  | "addressLine1"
  | "addressLine2"
  | "city"
  | "statePostal"
  | "country";
export type AddressToken<P extends string> = `${P}.${AddressField}`;

function addressFields<P extends string>(
  prefix: P,
  party: string,
  group = party
): readonly { token: AddressToken<P>; label: string; group: string }[] {
  const field = (name: AddressField, label: string) => ({
    token: `${prefix}.${name}` as AddressToken<P>,
    label: `${party} ${label}`,
    group
  });
  return [
    field("name", "Name"),
    field("addressLine1", "Address"),
    field("addressLine2", "Address Line 2"),
    field("city", "City"),
    field("statePostal", "State and Postal Code"),
    field("country", "Country")
  ];
}

/**
 * Company detail fields shared by the customer/supplier-facing documents
 * (invoice, order, PO, quote, packing slip). Also the field list offered for
 * the footer registration number, which is company data by definition.
 */
export const COMPANY_MERGE_FIELDS = [
  value("company.name", "Company Name", "Company"),
  value("company.city", "Company City", "Company"),
  value("company.country", "Company Country", "Company"),
  value("company.taxId", "Company Tax ID", "Company"),
  value("company.eori", "Company EORI", "Company"),
  value("company.vatNumber", "Company VAT Number", "Company"),
  value("company.registrationNumber", "Company Registration Number", "Company")
] as const satisfies readonly MergeField[];

const SALES_INVOICE_MERGE_FIELDS = [
  locked("invoice.number", "Invoice Number", "Invoice"),
  value("invoice.dateIssued", "Issue Date", "Invoice"),
  value("invoice.dateDue", "Due Date", "Invoice"),
  value("invoice.customerReference", "Customer Reference", "Invoice"),
  locked("invoice.currency", "Currency", "Invoice"),
  value("invoice.salesOrders", "Sales Orders", "Invoice"),
  value("invoice.paymentTerms", "Payment Terms", "Invoice"),
  value("invoice.shippingMethod", "Shipping Method", "Invoice"),
  value("invoice.shippingTerms", "Shipping Terms", "Invoice"),
  value("invoice.incoterm", "Incoterm", "Invoice"),
  figure("invoice.subtotal", "Subtotal", "Totals"),
  figure("invoice.discount", "Discount", "Totals"),
  figure("invoice.addOns", "Add-Ons", "Totals"),
  figure("invoice.shipping", "Shipping", "Totals"),
  figure("invoice.tax", "Tax", "Totals"),
  figure("invoice.total", "Total", "Totals"),
  ...addressFields("customer", "Customer"),
  value("customer.taxId", "Customer Tax ID", "Customer"),
  value("customer.vatNumber", "Customer VAT", "Customer"),
  value("customer.eori", "Customer EORI", "Customer"),
  value("customer.contactName", "Customer Contact", "Customer"),
  value("customer.contactEmail", "Customer Email", "Customer"),
  ...addressFields("shipTo", "Ship To"),
  ...COMPANY_MERGE_FIELDS
] as const satisfies readonly MergeField[];

const SALES_ORDER_MERGE_FIELDS = [
  locked("order.number", "Order Number", "Order"),
  value("order.date", "Order Date", "Order"),
  value("order.customerReference", "Customer Reference", "Order"),
  value("order.requestedDate", "Requested Date", "Order"),
  value("order.promisedDate", "Promised Date", "Order"),
  value("order.paymentTerms", "Payment Terms", "Order"),
  value("order.shippingMethod", "Shipping Method", "Order"),
  value("order.shippingTerms", "Shipping Terms", "Order"),
  value("order.incoterm", "Incoterm", "Order"),
  locked("order.currency", "Currency", "Order"),
  figure("order.subtotal", "Subtotal", "Totals"),
  figure("order.addOns", "Add-Ons", "Totals"),
  figure("order.shipping", "Shipping", "Totals"),
  figure("order.tax", "Tax", "Totals"),
  figure("order.total", "Total", "Totals"),
  ...addressFields("customer", "Customer"),
  value("customer.taxId", "Customer Tax ID", "Customer"),
  value("customer.vatNumber", "Customer VAT", "Customer"),
  value("customer.eori", "Customer EORI", "Customer"),
  ...addressFields("billTo", "Bill To"),
  ...COMPANY_MERGE_FIELDS
] as const satisfies readonly MergeField[];

const SALES_RETURN_ORDER_MERGE_FIELDS = [
  locked("order.number", "RMA Number", "Return"),
  value("order.date", "Order Date", "Return"),
  value("order.expirationDate", "Expiration Date", "Return"),
  value("order.customerReference", "Customer Reference", "Return"),
  locked("order.currency", "Currency", "Return"),
  figure("order.total", "Total", "Totals"),
  ...addressFields("customer", "Customer"),
  ...addressFields("returnTo", "Return To"),
  ...COMPANY_MERGE_FIELDS
] as const satisfies readonly MergeField[];

const PURCHASE_ORDER_MERGE_FIELDS = [
  locked("order.number", "PO Number", "Order"),
  locked("order.id", "PO Number (no revision)", "Order"),
  locked("order.revision", "Revision", "Order"),
  value("order.date", "Order Date", "Order"),
  value("order.requestedDate", "Requested Date", "Order"),
  value("order.promisedDate", "Promised Date", "Order"),
  value("order.paymentTerms", "Payment Terms", "Order"),
  value("order.incoterm", "Incoterm", "Order"),
  value("order.supplierReference", "Supplier Reference", "Order"),
  locked("order.currency", "Currency", "Order"),
  value("order.approvedBy", "Approved By", "Order"),
  value("order.approvedDate", "Approval Date", "Order"),
  value("order.billingEmail", "Billing Email", "Order"),
  figure("order.subtotal", "Subtotal", "Totals"),
  figure("order.shipping", "Shipping", "Totals"),
  figure("order.tax", "Tax", "Totals"),
  figure("order.total", "Total", "Totals"),
  ...addressFields("supplier", "Supplier"),
  value("supplier.taxId", "Supplier Tax ID", "Supplier"),
  value("supplier.vatNumber", "Supplier VAT", "Supplier"),
  value("supplier.eori", "Supplier EORI", "Supplier"),
  value("supplier.contactName", "Supplier Contact", "Supplier"),
  value("supplier.contactEmail", "Supplier Email", "Supplier"),
  value("buyer.name", "Buyer Name", "Buyer"),
  value("buyer.email", "Buyer Email", "Buyer"),
  value("buyer.phone", "Buyer Phone", "Buyer"),
  ...addressFields("deliverTo", "Deliver To"),
  ...COMPANY_MERGE_FIELDS
] as const satisfies readonly MergeField[];

const PURCHASE_RETURN_ORDER_MERGE_FIELDS = [
  locked("order.number", "Return Number", "Return"),
  value("order.date", "Order Date", "Return"),
  value("order.expirationDate", "Expiration Date", "Return"),
  value("order.supplierReference", "Supplier RMA Number", "Return"),
  locked("order.currency", "Currency", "Return"),
  figure("order.total", "Total", "Totals"),
  ...addressFields("supplier", "Supplier"),
  ...addressFields("shipFrom", "Ship From"),
  ...COMPANY_MERGE_FIELDS
] as const satisfies readonly MergeField[];

const PURCHASING_RFQ_MERGE_FIELDS = [
  locked("rfq.number", "RFQ Number", "RFQ"),
  value("rfq.date", "RFQ Date", "RFQ"),
  value("rfq.dueDate", "Due Date", "RFQ"),
  value("rfq.location", "Receiving Location", "RFQ"),
  value("deliverTo.addressLine1", "Delivery Address Line 1", "Deliver To"),
  value("deliverTo.addressLine2", "Delivery Address Line 2", "Deliver To"),
  value(
    "deliverTo.cityStatePostal",
    "Delivery City, State and Postal Code",
    "Deliver To"
  ),
  value("deliverTo.country", "Delivery Country", "Deliver To"),
  value("contact.name", "Buyer Name", "Buyer"),
  value("contact.email", "Buyer Email", "Buyer"),
  ...COMPANY_MERGE_FIELDS
] as const satisfies readonly MergeField[];

const QUOTE_MERGE_FIELDS = [
  locked("quote.number", "Quote Number", "Quote"),
  locked("quote.revision", "Revision", "Quote"),
  value("quote.date", "Date Printed", "Quote"),
  value("quote.expirationDate", "Expiration Date", "Quote"),
  value("quote.customerReference", "Customer Reference", "Quote"),
  value("quote.maxLeadTime", "Max Lead Time", "Quote"),
  value("quote.paymentTerms", "Payment Terms", "Quote"),
  value("quote.incoterm", "Incoterm", "Quote"),
  locked("quote.currency", "Currency", "Quote"),
  figure("quote.subtotal", "Subtotal", "Totals"),
  figure("quote.shipping", "Shipping", "Totals"),
  figure("quote.fees", "Fees", "Totals"),
  figure("quote.tax", "Tax", "Totals"),
  figure("quote.total", "Total", "Totals"),
  ...addressFields("customer", "Customer"),
  value("customer.taxId", "Customer Tax ID", "Customer"),
  value("customer.vatNumber", "Customer VAT", "Customer"),
  value("customer.eori", "Customer EORI", "Customer"),
  value("customer.contactName", "Customer Contact", "Customer"),
  value("customer.contactEmail", "Customer Email", "Customer"),
  ...COMPANY_MERGE_FIELDS
] as const satisfies readonly MergeField[];

const PACKING_SLIP_MERGE_FIELDS = [
  locked("shipment.number", "Shipment Number", "Shipment"),
  value("shipment.trackingNumber", "Tracking Number", "Shipment"),
  value("shipment.date", "Shipment Date", "Shipment"),
  value("shipment.sourceDocument", "Source Document Type", "Shipment"),
  value("shipment.sourceDocumentId", "Source Document Number", "Shipment"),
  value("shipment.customerReference", "Customer PO Number", "Shipment"),
  value("shipment.method", "Shipping Method", "Shipment"),
  value("shipment.paymentTerm", "Payment Terms", "Shipment"),
  ...addressFields("customer", "Customer"),
  ...COMPANY_MERGE_FIELDS
] as const satisfies readonly MergeField[];

const STOCK_TRANSFER_MERGE_FIELDS = [
  locked("transfer.number", "Transfer Number", "Transfer"),
  value("transfer.location", "Location", "Transfer"),
  value("transfer.assignee", "Assignee", "Transfer"),
  value("transfer.date", "Transfer Date", "Transfer"),
  value("company.name", "Company Name", "Company"),
  value("company.addressLine1", "Company Address", "Company"),
  value("company.addressLine2", "Company Address Line 2", "Company"),
  value("company.city", "Company City", "Company"),
  value("company.statePostal", "Company State and Postal Code", "Company"),
  value("company.country", "Company Country", "Company"),
  value("company.phone", "Company Phone", "Company"),
  value("company.email", "Company Email", "Company"),
  value("company.website", "Company Website", "Company")
] as const satisfies readonly MergeField[];

const JOB_TRAVELER_MERGE_FIELDS = [
  locked("job.number", "Job Number", "Job"),
  value("job.startDate", "Start Date", "Job"),
  value("job.dueDate", "Due Date", "Job"),
  value("job.deadlineType", "Deadline Type", "Job"),
  figure("job.quantity", "Quantity", "Job"),
  figure("job.scrapQuantity", "Scrap Quantity", "Job"),
  locked("job.unit", "Unit of Measure", "Job"),
  value("job.salesOrder", "Sales Order", "Job"),
  locked("job.methodRevision", "Method Revision", "Job"),
  locked("job.batchNumber", "Batch or Serial Number", "Job"),
  locked("item.readableId", "Item ID", "Item"),
  locked("item.name", "Item Name", "Item"),
  locked("item.trackingType", "Tracking Type", "Item"),
  value("customer.name", "Customer Name", "Customer"),
  value("company.name", "Company Name", "Company"),
  value("company.city", "Company City", "Company"),
  value("company.country", "Company Country", "Company")
] as const satisfies readonly MergeField[];

const ISSUE_MERGE_FIELDS = [
  locked("issue.number", "Issue Number", "Issue"),
  value("issue.name", "Issue Name", "Issue"),
  value("issue.status", "Status", "Issue"),
  value("issue.openDate", "Open Date", "Issue"),
  value("issue.closeDate", "Close Date", "Issue"),
  value("issue.type", "Issue Type", "Issue"),
  value("issue.initiatedBy", "Initiated By", "Issue"),
  value("company.name", "Company Name", "Company"),
  value("company.city", "Company City", "Company"),
  value("company.country", "Company Country", "Company")
] as const satisfies readonly MergeField[];

const TRACKING_LABEL_MERGE_FIELDS = [
  value("item.id", "Item ID", "Item"),
  value("item.revision", "Revision", "Item"),
  value("label.quantity", "Quantity", "Label"),
  value("label.trackingType", "Tracking Type", "Label"),
  value("label.number", "Serial / Batch Number", "Label"),
  value("label.trackedEntityId", "Tracked Entity ID", "Label"),
  value("company.name", "Company Name", "Company"),
  value("company.city", "Company City", "Company"),
  value("company.country", "Company Country", "Company")
] as const satisfies readonly MergeField[];

/** Catalog of insertable merge fields per document type (editor-facing). */
export const MERGE_FIELDS = {
  salesInvoice: SALES_INVOICE_MERGE_FIELDS,
  salesOrder: SALES_ORDER_MERGE_FIELDS,
  salesReturnOrder: SALES_RETURN_ORDER_MERGE_FIELDS,
  purchaseOrder: PURCHASE_ORDER_MERGE_FIELDS,
  purchaseReturnOrder: PURCHASE_RETURN_ORDER_MERGE_FIELDS,
  purchasingRfq: PURCHASING_RFQ_MERGE_FIELDS,
  quote: QUOTE_MERGE_FIELDS,
  packingSlip: PACKING_SLIP_MERGE_FIELDS,
  stockTransfer: STOCK_TRANSFER_MERGE_FIELDS,
  jobTraveler: JOB_TRAVELER_MERGE_FIELDS,
  issue: ISSUE_MERGE_FIELDS,
  trackingLabel: TRACKING_LABEL_MERGE_FIELDS
} as const satisfies Record<DocumentTemplateType, readonly MergeField[]>;

/** The fields of table rows, each defined once, so a flag cannot differ by document. */
const LINE = {
  number: locked("line.number", "Line Number", "Line"),
  description: value("line.description", "Line Item", "Line"),
  descriptionText: value("line.description", "Line Description", "Line"),
  details: value("line.details", "Line Details", "Line"),
  operation: value("line.operation", "Line Operation", "Line"),
  supplierPartId: value("line.supplierPartId", "Line Supplier Part ID", "Line"),
  item: value("line.item", "Line Item ID", "Line"),
  itemId: value("line.itemId", "Item ID", "Line"),
  itemName: value("line.itemName", "Item Name", "Line"),
  quantity: figure("line.quantity", "Quantity", "Line"),
  unit: locked("line.unit", "Unit of Measure", "Line"),
  unitPrice: figure("line.unitPrice", "Unit Price", "Line"),
  discountPercent: locked("line.discountPercent", "Discount Percent", "Line"),
  total: figure("line.total", "Line Total", "Line"),
  shipping: figure("line.shipping", "Line Shipping", "Line"),
  addOn: figure("line.addOn", "Line Add-On", "Line"),
  nonTaxableAddOn: figure(
    "line.nonTaxableAddOn",
    "Line Non-Taxable Add-On",
    "Line"
  ),
  taxPercent: locked("line.taxPercent", "Tax Percent", "Line"),
  taxAmount: figure("line.taxAmount", "Tax Amount", "Line"),
  netValue: figure("line.netValue", "Net Value", "Line"),
  requiredDate: value("line.requiredDate", "Required Date", "Line"),
  from: value("line.from", "From Storage Unit", "Line"),
  to: value("line.to", "To Storage Unit", "Line"),
  reason: value("line.reason", "Return Reason", "Line"),
  shippedQuantity: figure("line.shippedQuantity", "Shipped Quantity", "Line"),
  orderQuantity: figure("line.orderQuantity", "Ordered Quantity", "Line"),
  serialBatch: locked("line.serialBatch", "Serial or Batch", "Line")
} as const satisfies Record<string, MergeField>;

const RETURN_ORDER_LINE_FIELDS = [
  LINE.number,
  LINE.itemId,
  LINE.itemName,
  LINE.quantity,
  LINE.unit,
  LINE.unitPrice,
  LINE.reason
] as const satisfies readonly MergeField[];

/**
 * The variables of one table row. They are filled once per row, so only a text
 * whose `row` is their prefix can use them.
 */
export const LINE_MERGE_FIELDS = {
  quote: [
    LINE.number,
    LINE.description,
    LINE.details,
    figure("price.quantity", "Quantity", "Price"),
    figure("price.unitPrice", "Unit Price", "Price"),
    figure("price.taxAndFees", "Tax and Fees", "Price"),
    value("price.leadTime", "Lead Time", "Price"),
    figure("price.total", "Total", "Price"),
    figure("price.shipping", "Shipping", "Price"),
    locked("price.taxPercent", "Tax Percent", "Price"),
    figure("price.tax", "Tax Amount", "Price"),
    value("charge.description", "Charge Name", "Charge"),
    figure("charge.amount", "Charge Amount", "Charge")
  ],
  jobTraveler: [
    locked("operation.seq", "Sequence", "Operation"),
    value("operation.description", "Operation", "Operation"),
    value("operation.setupTime", "Setup Time", "Operation"),
    value("operation.laborTime", "Labor Time", "Operation"),
    value("operation.machineTime", "Machine Time", "Operation"),
    value("operation.batch", "Batch", "Operation"),
    value("step.name", "Step Name", "Procedure Step"),
    value("material.itemId", "Material Item", "Material"),
    value("material.description", "Material Description", "Material"),
    figure("material.quantity", "Material Quantity", "Material"),
    locked("material.unit", "Material Unit", "Material")
  ],
  issue: [
    value("task.action", "Action", "Task"),
    value("task.supplier", "Task Supplier", "Task"),
    value("task.assignee", "Task Assignee", "Task"),
    value("task.completedDate", "Completed Date", "Task"),
    value("inspection.step", "Inspection Step", "Inspection"),
    value("inspection.job", "Inspection Job", "Inspection"),
    value("inspection.recordedBy", "Recorded By", "Inspection"),
    value("inspection.date", "Inspection Date", "Inspection"),
    value("association.id", "Linked Record", "Association"),
    value("association.disposition", "Disposition", "Association"),
    figure("association.quantity", "Quantity", "Association"),
    value("reviewer.title", "Reviewer", "Reviewer"),
    value("reviewer.status", "Review Status", "Reviewer")
  ],
  salesOrder: [
    LINE.number,
    LINE.description,
    LINE.details,
    LINE.quantity,
    LINE.unit,
    LINE.unitPrice,
    LINE.total,
    LINE.shipping,
    LINE.addOn,
    LINE.nonTaxableAddOn,
    LINE.taxPercent,
    LINE.taxAmount
  ],
  salesInvoice: [
    LINE.number,
    LINE.description,
    LINE.details,
    LINE.quantity,
    LINE.unit,
    LINE.unitPrice,
    LINE.discountPercent,
    LINE.total,
    LINE.shipping,
    LINE.addOn,
    LINE.nonTaxableAddOn,
    LINE.taxAmount,
    LINE.taxPercent
  ],
  stockTransfer: [
    LINE.number,
    LINE.description,
    LINE.itemId,
    LINE.from,
    LINE.to,
    LINE.quantity,
    LINE.unit
  ],
  purchaseReturnOrder: RETURN_ORDER_LINE_FIELDS,
  salesReturnOrder: RETURN_ORDER_LINE_FIELDS,
  purchaseOrder: [
    LINE.number,
    LINE.description,
    LINE.details,
    LINE.supplierPartId,
    LINE.operation,
    LINE.quantity,
    LINE.unit,
    LINE.requiredDate,
    LINE.unitPrice,
    LINE.netValue,
    LINE.taxAmount,
    LINE.taxPercent,
    LINE.shipping,
    LINE.total
  ],
  purchasingRfq: [
    LINE.number,
    LINE.item,
    LINE.descriptionText,
    LINE.quantity,
    LINE.unit
  ],
  packingSlip: [
    LINE.item,
    LINE.descriptionText,
    LINE.shippedQuantity,
    LINE.orderQuantity,
    LINE.unit,
    LINE.serialBatch,
    value("unit.name", "Rental Unit Name", "Rental Unit"),
    value("unit.assetId", "Rental Asset ID", "Rental Unit"),
    figure("unit.quantity", "Rental Quantity", "Rental Unit"),
    locked("unit.serial", "Rental Serial", "Rental Unit")
  ]
} as const satisfies Partial<
  Record<DocumentTemplateType, readonly MergeField[]>
>;

/** The per-row variable names one document type offers, as a type. */
export type LineMergeToken<D extends keyof typeof LINE_MERGE_FIELDS> =
  (typeof LINE_MERGE_FIELDS)[D][number]["token"];

/** One table's variables as values, by their prefix. */
export type RowVars<
  D extends keyof typeof LINE_MERGE_FIELDS,
  P extends string
> = Record<Extract<LineMergeToken<D>, `${P}.${string}`>, string>;

/** The variables of one document's table rows; `row` keeps one table's. */
export function getLineMergeFields(
  documentType: string,
  row?: string
): readonly MergeField[] {
  const fields =
    (LINE_MERGE_FIELDS as Record<string, readonly MergeField[]>)[
      documentType
    ] ?? [];
  return row ? fields.filter((f) => f.token.startsWith(`${row}.`)) : fields;
}

/** The variable names one document type offers, as a type. */
export type MergeToken<D extends DocumentTemplateType> =
  (typeof MERGE_FIELDS)[D][number]["token"];

export function getMergeFields(documentType: string): readonly MergeField[] {
  return (
    (MERGE_FIELDS as Record<string, readonly MergeField[]>)[documentType] ?? []
  );
}

/** Every variable a document type prints: its own and its table rows'. */
export function allMergeFields(documentType: string): readonly MergeField[] {
  return [...getMergeFields(documentType), ...getLineMergeFields(documentType)];
}

/** The variables one document cannot give its own value. */
export function lockedTokens(documentType: string): Set<string> {
  return new Set(
    allMergeFields(documentType)
      .filter((field) => !isEditableValue(field))
      .map((field) => field.token)
  );
}
