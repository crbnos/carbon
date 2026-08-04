// Canonical, provider-neutral EDI JSON shapes. The "Guide-JSON" idea: Carbon
// owns these shapes; provider adapters map their own JSON to/from them so a
// provider switch never changes the stored payloads or the ERP glue.

export type EdiDocumentType =
  | "Purchase Order" // X12 850 (inbound)
  | "Purchase Order Acknowledgment" // X12 855 (outbound)
  | "Advance Ship Notice" // X12 856 (outbound)
  | "Invoice"; // X12 810 (outbound)

export type EdiDocumentDirection = "Inbound" | "Outbound";

export type EdiDocumentStatus =
  // inbound path
  | "Received"
  | "Needs Review"
  | "Posted"
  | "Rejected"
  // outbound path
  | "Pending"
  | "Sent"
  | "Acknowledged"
  | "Failed";

export type EdiReleaseMode = "Automatic" | "Review";

export type EdiIssueCode =
  | "unknown-partner"
  | "unknown-ship-to"
  | "unknown-part"
  | "price-mismatch"
  | "duplicate-reference"
  | "missing-reference"
  | "provider-rejected"
  | "unacknowledged";

export type EdiIssue = {
  code: EdiIssueCode;
  message: string;
  path?: string;
  context?: Record<string, string | number>;
};

export type EdiAddress = {
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  countryCode?: string;
};

export type EdiOrderLine = {
  partnerLineNumber: string;
  partnerPartId: string; // buyer part number
  partnerPartRevision?: string;
  quantity: number;
  unitOfMeasure: string;
  unitPrice: number;
  requestedDate?: string;
};

export type EdiOrderPayload = {
  partnerReference: string; // buyer PO number
  orderDate: string;
  requestedShipDate?: string;
  shipTo: { code: string; name?: string; address?: EdiAddress };
  lines: EdiOrderLine[];
};

export type EdiAckPayload = {
  partnerReference: string;
  accepted: true;
};

export type EdiShipNoticePayload = {
  partnerReference: string;
  shipDate: string;
  trackingNumber?: string;
  shipVia?: string; // SCAC / ship method
  lines: Array<{
    partnerPartId: string;
    quantity: number;
    unitOfMeasure: string;
  }>;
};

export type EdiInvoicePayload = {
  partnerReference: string;
  invoiceNumber: string;
  invoiceDate: string;
  currencyCode: string;
  lines: Array<{
    partnerPartId: string;
    quantity: number;
    unitOfMeasure: string;
    unitPrice: number;
  }>;
  total: number;
};

export type EdiOutboundPayload =
  | EdiAckPayload
  | EdiShipNoticePayload
  | EdiInvoicePayload;

// Result of a provider webhook parse, normalized to Carbon's vocabulary.
export type ParsedEdiWebhook =
  | {
      kind: "transaction";
      externalId: string;
      documentType: EdiDocumentType;
      payload?: EdiOrderPayload; // present when the webhook embeds the full transaction
    }
  | {
      kind: "acknowledgment";
      externalId: string; // provider transaction id of the outbound document being acked
      accepted: boolean;
      reasons: string[];
    };
