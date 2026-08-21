// Canonical cXML punchout types owned by Carbon. No fast-xml-parser types leak
// out of the parse layer — everything here is plain data the ERP app can trust.

export type CxmlIdentity = { domain: string; identity: string };

export type CxmlCredentials = {
  from: CxmlIdentity;
  to: CxmlIdentity;
  sender: CxmlIdentity;
  sharedSecret: string;
  deploymentMode: "test" | "production";
  userAgent: string;
};

export type PunchoutCartLine = {
  supplierPartId: string;
  supplierPartAuxiliaryId: string | null;
  quantity: number;
  unitPrice: number;
  currencyCode: string;
  description: string;
  unitOfMeasureCode: string; // raw UN/CEFACT code from cart
  classification: string | null;
  manufacturerPartId: string | null;
  manufacturerName: string | null;
};

export type PunchoutCart = {
  buyerCookie: string;
  total: number | null;
  currencyCode: string | null;
  operationAllowed: "create" | "inspect" | "edit" | null;
  lines: PunchoutCartLine[];
};

export type CxmlConfirmationLine = {
  lineNumber: number;
  quantity: number;
  unitOfMeasureCode: string | null;
  type: string;
  shipmentDate: string | null;
  deliveryDate: string | null;
};

export type CxmlConfirmationPayload = {
  payloadId: string;
  confirmId: string | null;
  supplierOrderId: string | null;
  orderId: string | null;
  orderPayloadId: string | null;
  noticeDate: string | null;
  total: number | null;
  lines: CxmlConfirmationLine[];
};

export type CxmlShipNoticePayload = {
  payloadId: string;
  shipmentId: string;
  shipmentDate: string | null;
  deliveryDate: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  orderId: string | null;
  lines: Array<{
    lineNumber: number;
    quantity: number;
    unitOfMeasureCode: string | null;
  }>;
};

export type CxmlInvoiceLine = {
  invoiceLineNumber: number;
  orderLineNumber: number | null;
  supplierPartId: string | null;
  description: string | null;
  quantity: number;
  unitOfMeasureCode: string | null;
  unitPrice: number;
  subtotal: number | null;
};

export type CxmlInvoicePayload = {
  payloadId: string;
  invoiceId: string;
  purpose: "standard" | "lineLevelCreditMemo";
  invoiceDate: string | null;
  orderId: string | null;
  paymentTermDays: number | null;
  lines: CxmlInvoiceLine[];
  subtotal: number | null;
  tax: number | null;
  shipping: number | null;
  specialHandling: number | null;
  gross: number | null;
  net: number | null;
  due: number | null;
  currencyCode: string | null;
};

export type CxmlParseResult<T> = { data: T | null; error: string | null };

export type CxmlAddress = {
  name: string;
  deliverTo: string | null;
  street: string[];
  city: string;
  state: string | null;
  postalCode: string | null;
  countryCode: string;
};
