// Pure outbound payload builders. Each takes plain row objects (the caller fetches
// the real posted record) and returns a BuildResult: a payload or null plus issues.
// Never send an unmatchable document — a missing buyer PO number or an unmapped
// item produces a null payload with issues instead of a wrong wire document.

import type {
  EdiAckPayload,
  EdiInvoicePayload,
  EdiIssue,
  EdiShipNoticePayload
} from "./types";

export type BuildResult<T> = { payload: T | null; issues: EdiIssue[] };

/** 855 PO Acknowledgment (accept-as-is) from the confirmed sales order. */
export function buildAckPayload(args: {
  salesOrder: { customerReference: string | null };
}): BuildResult<EdiAckPayload> {
  const partnerReference = args.salesOrder.customerReference;
  if (!partnerReference) {
    return {
      payload: null,
      issues: [
        {
          code: "missing-reference",
          message: "Sales order has no customer reference (buyer PO number)"
        }
      ]
    };
  }
  return { payload: { partnerReference, accepted: true }, issues: [] };
}

/** 856 ASN from the actual posted shipment (buyer parts + shipped quantities). */
export function buildShipNoticePayload(args: {
  shipment: {
    partnerReference: string | null; // buyer PO number, from the source sales order
    shipDate: string;
    trackingNumber?: string | null;
    shipVia?: string | null;
  };
  shipmentLines: Array<{
    itemId: string;
    quantity: number;
    unitOfMeasure: string;
  }>;
  partNumbersByItemId: Record<string, string>;
}): BuildResult<EdiShipNoticePayload> {
  const issues: EdiIssue[] = [];
  const { shipment, shipmentLines, partNumbersByItemId } = args;

  if (!shipment.partnerReference) {
    issues.push({
      code: "missing-reference",
      message:
        "Shipment's sales order has no customer reference (buyer PO number)"
    });
  }

  const lines: EdiShipNoticePayload["lines"] = [];
  for (const line of shipmentLines) {
    const partnerPartId = partNumbersByItemId[line.itemId];
    if (!partnerPartId) {
      issues.push({
        code: "unknown-part",
        message: `No buyer part number mapped for item ${line.itemId}`,
        context: { itemId: line.itemId }
      });
      continue;
    }
    lines.push({
      partnerPartId,
      quantity: line.quantity,
      unitOfMeasure: line.unitOfMeasure
    });
  }

  if (issues.length > 0 || !shipment.partnerReference) {
    return { payload: null, issues };
  }

  return {
    payload: {
      partnerReference: shipment.partnerReference,
      shipDate: shipment.shipDate,
      trackingNumber: shipment.trackingNumber ?? undefined,
      shipVia: shipment.shipVia ?? undefined,
      lines
    },
    issues: []
  };
}

/** 810 Invoice from the posted sales invoice. */
export function buildInvoicePayload(args: {
  salesInvoice: {
    partnerReference: string | null; // buyer PO number, from the source sales order
    invoiceNumber: string;
    invoiceDate: string;
    currencyCode: string;
  };
  salesInvoiceLines: Array<{
    itemId: string;
    quantity: number;
    unitOfMeasure: string;
    unitPrice: number;
  }>;
  partNumbersByItemId: Record<string, string>;
}): BuildResult<EdiInvoicePayload> {
  const issues: EdiIssue[] = [];
  const { salesInvoice, salesInvoiceLines, partNumbersByItemId } = args;

  if (!salesInvoice.partnerReference) {
    issues.push({
      code: "missing-reference",
      message:
        "Sales invoice's sales order has no customer reference (buyer PO number)"
    });
  }

  const lines: EdiInvoicePayload["lines"] = [];
  let total = 0;
  for (const line of salesInvoiceLines) {
    const partnerPartId = partNumbersByItemId[line.itemId];
    if (!partnerPartId) {
      issues.push({
        code: "unknown-part",
        message: `No buyer part number mapped for item ${line.itemId}`,
        context: { itemId: line.itemId }
      });
      continue;
    }
    lines.push({
      partnerPartId,
      quantity: line.quantity,
      unitOfMeasure: line.unitOfMeasure,
      unitPrice: line.unitPrice
    });
    total += line.quantity * line.unitPrice;
  }

  if (issues.length > 0 || !salesInvoice.partnerReference) {
    return { payload: null, issues };
  }

  return {
    payload: {
      partnerReference: salesInvoice.partnerReference,
      invoiceNumber: salesInvoice.invoiceNumber,
      invoiceDate: salesInvoice.invoiceDate,
      currencyCode: salesInvoice.currencyCode,
      lines,
      total
    },
    issues: []
  };
}
