// Orderful ↔ canonical mapping. Every Orderful-specific key lives in this one
// file so a shape correction is a one-file change.
//
// NOTE: these Orderful request/response shapes are modeled from Orderful's
// public "embedded EDI for SaaS platforms" documentation and MUST be confirmed
// against a sandbox account before production use (spec ⚠️ vendor signup). Until
// then the client's getTransaction/sendTransaction throw rather than guess wire
// responses; only the webhook-embedded inbound path (parsed here) is exercised.

import type {
  EdiDocumentType,
  EdiOrderPayload,
  EdiOutboundPayload,
  ParsedEdiWebhook
} from "../../types";

type OrderfulLineItem = {
  lineNumber?: string;
  buyerPartNumber?: string;
  revision?: string;
  quantity?: number;
  unitOfMeasure?: string;
  unitPrice?: number;
  requestedDate?: string;
};

type OrderfulOrderContent = {
  purchaseOrderNumber?: string;
  orderDate?: string;
  requestedShipDate?: string;
  shipTo?: {
    locationCode?: string;
    name?: string;
    address?: {
      addressLine1?: string;
      addressLine2?: string;
      city?: string;
      state?: string;
      postalCode?: string;
      countryCode?: string;
    };
  };
  lineItems?: OrderfulLineItem[];
};

// Orderful delivers transactions as JSON with a transaction type and a body.
export type OrderfulTransaction = {
  transactionId: string;
  transactionType: string; // "850" | "855" | "856" | "810" | "997"
  partnerId?: string;
  content?: OrderfulOrderContent; // inbound order body
  // 997 acknowledgment fields:
  acknowledgedTransactionId?: string;
  acknowledgmentStatus?: "accepted" | "rejected";
  errors?: string[];
};

export type OrderfulTransactionBody = {
  transactionType: string;
  partnerId?: string;
  content: EdiOutboundPayload;
};

const X12_TO_DOCUMENT_TYPE: Record<string, EdiDocumentType> = {
  "850": "Purchase Order",
  "855": "Purchase Order Acknowledgment",
  "856": "Advance Ship Notice",
  "810": "Invoice"
};

const DOCUMENT_TYPE_TO_X12: Record<EdiDocumentType, string> = {
  "Purchase Order": "850",
  "Purchase Order Acknowledgment": "855",
  "Advance Ship Notice": "856",
  Invoice: "810"
};

export function toCanonicalOrder(tx: OrderfulTransaction): {
  documentType: EdiDocumentType;
  payload: EdiOrderPayload;
} {
  const content = tx.content ?? {};
  return {
    documentType: X12_TO_DOCUMENT_TYPE[tx.transactionType] ?? "Purchase Order",
    payload: {
      partnerReference: content.purchaseOrderNumber ?? "",
      orderDate: content.orderDate ?? "",
      requestedShipDate: content.requestedShipDate,
      shipTo: {
        code: content.shipTo?.locationCode ?? "",
        name: content.shipTo?.name,
        address: content.shipTo?.address
      },
      lines: (content.lineItems ?? []).map((li, index) => ({
        partnerLineNumber: li.lineNumber ?? String(index + 1),
        partnerPartId: li.buyerPartNumber ?? "",
        partnerPartRevision: li.revision,
        quantity: li.quantity ?? 0,
        unitOfMeasure: li.unitOfMeasure ?? "EA",
        unitPrice: li.unitPrice ?? 0,
        requestedDate: li.requestedDate
      }))
    }
  };
}

export function fromCanonical(
  documentType: EdiDocumentType,
  payload: EdiOutboundPayload
): OrderfulTransactionBody {
  // The canonical payload is provider-neutral; Orderful's exact content schema
  // is confirmed against the sandbox before this is sent (see file note).
  return {
    transactionType: DOCUMENT_TYPE_TO_X12[documentType],
    content: payload
  };
}

/** Normalize an Orderful webhook body to Carbon's ParsedEdiWebhook. */
export function parseOrderfulWebhook(body: unknown): ParsedEdiWebhook | null {
  if (!body || typeof body !== "object") return null;
  const tx = body as OrderfulTransaction;
  if (!tx.transactionId || !tx.transactionType) return null;

  if (tx.transactionType === "997") {
    return {
      kind: "acknowledgment",
      externalId: tx.acknowledgedTransactionId ?? tx.transactionId,
      accepted: tx.acknowledgmentStatus !== "rejected",
      reasons: tx.errors ?? []
    };
  }

  const documentType = X12_TO_DOCUMENT_TYPE[tx.transactionType];
  if (!documentType) return null;

  return {
    kind: "transaction",
    externalId: tx.transactionId,
    documentType,
    partnerExternalId: tx.partnerId,
    payload: tx.content ? toCanonicalOrder(tx).payload : undefined
  };
}
