import { XMLParser } from "fast-xml-parser";
import type {
  CxmlConfirmationPayload,
  CxmlIdentity,
  CxmlInvoicePayload,
  CxmlParseResult,
  CxmlShipNoticePayload,
  PunchoutCart,
  PunchoutCartLine
} from "../types";

// parseTagValue:false keeps every text node a string, so identities like
// "006931349" and supplier part numbers keep their exact form (no leading-zero
// or precision loss). Numbers and money are coerced explicitly below.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false
});

type AnyNode = Record<string, unknown> | string | number | null | undefined;

function asArray(v: unknown): AnyNode[] {
  if (v === null || v === undefined) return [];
  return (Array.isArray(v) ? v : [v]) as AnyNode[];
}

// Read the text content of a node that may be a scalar or an attributed
// `{ "#text": ..., "@_x": ... }` object. Returns null for empty/missing.
function text(node: AnyNode): string | null {
  if (node === null || node === undefined) return null;
  if (typeof node === "object") {
    const t = (node as Record<string, unknown>)["#text"];
    return t === undefined || t === null ? null : String(t);
  }
  const s = String(node);
  return s.length === 0 ? null : s;
}

function attr(node: AnyNode, name: string): string | null {
  if (node && typeof node === "object") {
    const v = (node as Record<string, unknown>)[`@_${name}`];
    return v === undefined || v === null ? null : String(v);
  }
  return null;
}

function child(node: AnyNode, name: string): AnyNode {
  if (node && typeof node === "object") {
    return (node as Record<string, unknown>)[name] as AnyNode;
  }
  return undefined;
}

function num(v: unknown, fallback = 0): number {
  if (v === null || v === undefined) return fallback;
  const n = Number(String(v));
  return Number.isFinite(n) ? n : fallback;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v));
  return Number.isFinite(n) ? n : null;
}

/**
 * Strip currency symbols, commas, and whitespace before parsing. McMaster's own
 * confirmation sample contains `<Money currency="USD">$629.52</Money>`.
 */
export function parseCxmlMoney(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const s = String(value).replace(/[$,\s]/g, "");
  if (s.length === 0) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Read a `<Money currency="USD">amount</Money>` node → { amount, currency }.
function readMoney(node: AnyNode): {
  amount: number | null;
  currency: string | null;
} {
  return {
    amount: parseCxmlMoney(text(node)),
    currency: attr(node, "currency")
  };
}

// Read an amount wrapper like `<GrossAmount><Money ...>x</Money></GrossAmount>`.
function readAmount(
  parent: AnyNode,
  tag: string
): { amount: number | null; currency: string | null } {
  return readMoney(child(child(parent, tag), "Money"));
}

function readCredential(node: AnyNode): {
  identity: CxmlIdentity;
  sharedSecret: string | null;
} {
  const credential = child(node, "Credential");
  return {
    identity: {
      domain: attr(credential, "domain") ?? "",
      identity: text(child(credential, "Identity")) ?? ""
    },
    sharedSecret: text(child(credential, "SharedSecret"))
  };
}

/**
 * Parse the cXML envelope for auth/dispatch. Never throws — a malformed body
 * yields empty credentials so downstream secret comparison simply fails.
 */
export function parseCxmlEnvelope(xml: string): {
  payloadId: string;
  timestamp: string;
  senderIdentity: CxmlIdentity;
  senderSharedSecret: string;
  body: AnyNode;
} {
  const empty = {
    payloadId: "",
    timestamp: "",
    senderIdentity: { domain: "", identity: "" },
    senderSharedSecret: "",
    body: null as AnyNode
  };
  try {
    const root = child(parser.parse(xml), "cXML");
    if (!root) return empty;
    const header = child(root, "Header");
    const sender = readCredential(child(header, "Sender"));
    return {
      payloadId: attr(root, "payloadID") ?? "",
      timestamp: attr(root, "timestamp") ?? "",
      senderIdentity: sender.identity,
      senderSharedSecret: sender.sharedSecret ?? "",
      // Body is the Request (documents/POSR) or Message (POOM) element.
      body: child(root, "Request") ?? child(root, "Message") ?? null
    };
  } catch {
    return empty;
  }
}

function requestBody(xml: string): AnyNode {
  const root = child(parser.parse(xml), "cXML");
  return child(root, "Request") ?? child(root, "Message") ?? null;
}

export function parsePunchOutSetupResponse(
  xml: string
): CxmlParseResult<{ statusCode: number; startPageUrl: string | null }> {
  try {
    // POSR responses wrap Status + PunchOutSetupResponse in a Response element.
    const root = child(parser.parse(xml), "cXML");
    const resp = child(root, "Response");
    const status = child(resp, "Status");
    const statusCode = num(attr(status, "code"), 0);
    const setup = child(resp, "PunchOutSetupResponse");
    const startPageUrl = text(child(child(setup, "StartPage"), "URL"));
    return { data: { statusCode, startPageUrl }, error: null };
  } catch (err) {
    return { data: null, error: (err as Error).message };
  }
}

function readCartLine(item: AnyNode): PunchoutCartLine {
  const itemId = child(item, "ItemID");
  const detail = child(item, "ItemDetail");
  const money = readMoney(child(child(detail, "UnitPrice"), "Money"));
  return {
    supplierPartId: text(child(itemId, "SupplierPartID")) ?? "",
    supplierPartAuxiliaryId: text(child(itemId, "SupplierPartAuxiliaryID")),
    quantity: num(attr(item, "quantity"), 1),
    unitPrice: money.amount ?? 0,
    currencyCode: money.currency ?? "USD",
    description: text(child(detail, "Description")) ?? "",
    unitOfMeasureCode: text(child(detail, "UnitOfMeasure")) ?? "EA",
    classification: text(child(detail, "Classification")),
    manufacturerPartId: text(child(detail, "ManufacturerPartID")),
    manufacturerName: text(child(detail, "ManufacturerName"))
  };
}

export function parsePunchOutOrderMessage(
  xml: string
): CxmlParseResult<PunchoutCart> {
  try {
    const message = requestBody(xml);
    const poom = child(message, "PunchOutOrderMessage");
    if (!poom) return { data: null, error: "Missing PunchOutOrderMessage" };
    const header = child(poom, "PunchOutOrderMessageHeader");
    const total = readMoney(child(child(header, "Total"), "Money"));
    const lines = asArray(child(poom, "ItemIn") as AnyNode).map(readCartLine);
    const operation = attr(header, "operationAllowed");
    return {
      data: {
        buyerCookie: text(child(poom, "BuyerCookie")) ?? "",
        total: total.amount,
        currencyCode: total.currency,
        operationAllowed:
          operation === "create" ||
          operation === "inspect" ||
          operation === "edit"
            ? operation
            : null,
        lines
      },
      error: null
    };
  } catch (err) {
    return { data: null, error: (err as Error).message };
  }
}

/**
 * Decode a punchout browser form-post into the raw cXML string. Checks
 * `cxml-base64` first (base64), then `cxml-urlencoded`, case-insensitively.
 */
export function decodePunchoutFormPost(form: URLSearchParams): string | null {
  let base64: string | null = null;
  let urlencoded: string | null = null;
  for (const [key, value] of form.entries()) {
    const lower = key.toLowerCase();
    if (lower === "cxml-base64" && base64 === null) base64 = value;
    else if (lower === "cxml-urlencoded" && urlencoded === null)
      urlencoded = value;
  }
  if (base64 !== null) {
    try {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    } catch {
      return null;
    }
  }
  return urlencoded;
}

export function parseConfirmationRequest(
  xml: string
): CxmlParseResult<CxmlConfirmationPayload> {
  try {
    const root = child(parser.parse(xml), "cXML");
    const request = child(root, "Request") ?? child(root, "Message");
    const cr = child(request, "ConfirmationRequest");
    if (!cr) return { data: null, error: "Missing ConfirmationRequest" };
    const header = child(cr, "ConfirmationHeader");
    const orderRef = child(cr, "OrderReference");
    const lines = asArray(child(cr, "ConfirmationItem") as AnyNode).map(
      (item) => {
        const status = asArray(child(item, "ConfirmationStatus") as AnyNode)[0];
        return {
          lineNumber: num(attr(item, "lineNumber")),
          quantity: num(attr(item, "quantity")),
          unitOfMeasureCode:
            text(child(item, "UnitOfMeasure")) ??
            text(child(status, "UnitOfMeasure")),
          type: attr(status, "type") ?? "",
          shipmentDate: attr(status, "shipmentDate"),
          deliveryDate: attr(status, "deliveryDate")
        };
      }
    );
    return {
      data: {
        payloadId: attr(root, "payloadID") ?? "",
        confirmId: attr(header, "confirmID"),
        supplierOrderId: null,
        orderId: attr(orderRef, "orderID"),
        orderPayloadId: attr(child(orderRef, "DocumentReference"), "payloadID"),
        noticeDate: attr(header, "noticeDate"),
        total: readMoney(child(child(header, "Total"), "Money")).amount,
        lines
      },
      error: null
    };
  } catch (err) {
    return { data: null, error: (err as Error).message };
  }
}

export function parseShipNoticeRequest(
  xml: string
): CxmlParseResult<CxmlShipNoticePayload> {
  try {
    const root = child(parser.parse(xml), "cXML");
    const request = child(root, "Request") ?? child(root, "Message");
    const sn = child(request, "ShipNoticeRequest");
    if (!sn) return { data: null, error: "Missing ShipNoticeRequest" };
    const header = child(sn, "ShipNoticeHeader");
    const control = child(sn, "ShipControl");
    const portion = child(sn, "ShipNoticePortion");
    const orderRef = child(portion, "OrderReference");
    const lines = asArray(child(portion, "ShipNoticeItem") as AnyNode).map(
      (item) => ({
        lineNumber: num(attr(item, "lineNumber")),
        quantity: num(attr(item, "quantity")),
        unitOfMeasureCode: text(child(item, "UnitOfMeasure"))
      })
    );
    return {
      data: {
        payloadId: attr(root, "payloadID") ?? "",
        shipmentId: attr(header, "shipmentID") ?? "",
        shipmentDate: attr(header, "shipmentDate"),
        deliveryDate: attr(header, "deliveryDate"),
        carrier: text(child(control, "CarrierIdentifier")),
        trackingNumber: text(child(control, "ShipmentIdentifier")),
        orderId: attr(orderRef, "orderID"),
        lines
      },
      error: null
    };
  } catch (err) {
    return { data: null, error: (err as Error).message };
  }
}

export function parseInvoiceDetailRequest(
  xml: string
): CxmlParseResult<CxmlInvoicePayload> {
  try {
    const root = child(parser.parse(xml), "cXML");
    const request = child(root, "Request") ?? child(root, "Message");
    const idr = child(request, "InvoiceDetailRequest");
    if (!idr) return { data: null, error: "Missing InvoiceDetailRequest" };
    const header = child(idr, "InvoiceDetailRequestHeader");
    const purposeRaw = attr(header, "purpose");
    const purpose =
      purposeRaw === "lineLevelCreditMemo" ? "lineLevelCreditMemo" : "standard";

    // Net payment term = the longest payInNumberOfDays (discount terms are shorter).
    const paymentTermDays = asArray(child(header, "PaymentTerm") as AnyNode)
      .map((t) => numOrNull(attr(t, "payInNumberOfDays")))
      .filter((n): n is number => n !== null)
      .reduce<number | null>(
        (max, n) => (max === null || n > max ? n : max),
        null
      );

    const orders = asArray(child(idr, "InvoiceDetailOrder") as AnyNode);
    let orderId: string | null = null;
    let currencyCode: string | null = null;
    const lines: CxmlInvoicePayload["lines"] = [];
    for (const order of orders) {
      const info = child(order, "InvoiceDetailOrderInfo");
      const ref = child(info, "OrderReference");
      if (orderId === null) orderId = attr(ref, "orderID");
      for (const item of asArray(
        child(order, "InvoiceDetailItem") as AnyNode
      )) {
        const price = readMoney(child(child(item, "UnitPrice"), "Money"));
        const subtotal = readAmount(item, "SubtotalAmount");
        const itemRef = child(item, "InvoiceDetailItemReference");
        if (currencyCode === null)
          currencyCode = price.currency ?? subtotal.currency;
        lines.push({
          invoiceLineNumber: num(attr(item, "invoiceLineNumber")),
          orderLineNumber: numOrNull(attr(itemRef, "lineNumber")),
          supplierPartId: text(
            child(child(itemRef, "ItemID"), "SupplierPartID")
          ),
          description: text(child(itemRef, "Description")),
          quantity: num(attr(item, "quantity")),
          unitOfMeasureCode: text(child(item, "UnitOfMeasure")),
          unitPrice: price.amount ?? 0,
          subtotal: subtotal.amount
        });
      }
    }

    const summary = child(idr, "InvoiceDetailSummary");
    const gross = readAmount(summary, "GrossAmount");
    return {
      data: {
        payloadId: attr(root, "payloadID") ?? "",
        invoiceId: attr(header, "invoiceID") ?? "",
        purpose,
        invoiceDate: attr(header, "invoiceDate"),
        orderId,
        paymentTermDays,
        lines,
        subtotal: readAmount(summary, "SubtotalAmount").amount,
        tax: readMoney(child(child(summary, "Tax"), "Money")).amount,
        shipping: readAmount(summary, "ShippingAmount").amount,
        specialHandling: readAmount(summary, "SpecialHandlingAmount").amount,
        gross: gross.amount,
        net: readAmount(summary, "NetAmount").amount,
        due: readAmount(summary, "DueAmount").amount,
        currencyCode: currencyCode ?? gross.currency
      },
      error: null
    };
  } catch (err) {
    return { data: null, error: (err as Error).message };
  }
}
