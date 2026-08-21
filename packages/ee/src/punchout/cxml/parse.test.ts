import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decodePunchoutFormPost,
  parseConfirmationRequest,
  parseCxmlEnvelope,
  parseCxmlMoney,
  parseInvoiceDetailRequest,
  parsePunchOutOrderMessage,
  parsePunchOutSetupResponse,
  parseShipNoticeRequest
} from "./parse";

const fixture = (name: string): string =>
  readFileSync(new URL(`./__fixtures__/${name}.xml`, import.meta.url), "utf8");

describe("parseCxmlMoney", () => {
  it("strips $ and commas", () => {
    expect(parseCxmlMoney("$629.52")).toBe(629.52);
    expect(parseCxmlMoney("1,234.50")).toBe(1234.5);
    expect(parseCxmlMoney("203.08")).toBe(203.08);
    expect(parseCxmlMoney("-254.04")).toBe(-254.04);
    expect(parseCxmlMoney("0.0000")).toBe(0);
  });
  it("returns null for empty/garbage", () => {
    expect(parseCxmlMoney("")).toBeNull();
    expect(parseCxmlMoney(null)).toBeNull();
    expect(parseCxmlMoney("abc")).toBeNull();
  });
});

describe("parseCxmlEnvelope", () => {
  it("reads payloadId and sender shared secret without throwing", () => {
    const env = parseCxmlEnvelope(fixture("order-confirmation"));
    expect(env.payloadId).toBe("73017420187118402");
    expect(env.senderSharedSecret).toBe("mcmaster");
    expect(env.senderIdentity.identity).toBe("006931349");
    expect(env.body).not.toBeNull();
  });
  it("returns empty credentials on malformed xml", () => {
    const env = parseCxmlEnvelope("not xml <<<");
    expect(env.senderSharedSecret).toBe("");
    expect(env.payloadId).toBe("");
  });
});

describe("parsePunchOutOrderMessage", () => {
  it("parses a 3-line McMaster cart", () => {
    const { data, error } = parsePunchOutOrderMessage(fixture("poom"));
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data?.lines).toHaveLength(3);
    expect(data?.buyerCookie).toBe(
      "my72M1ntbyLaBsbThh0du14YcK1Me2Ww0.123456123456"
    );
    expect(data?.operationAllowed).toBe("edit");

    const first = data?.lines[0];
    expect(first?.supplierPartId).toBe("3201T16");
    expect(first?.supplierPartAuxiliaryId).toBe("8310486455458");
    expect(first?.unitPrice).toBe(0.9);
    expect(first?.unitOfMeasureCode).toBe("EA");
    expect(first?.currencyCode).toBe("USD");

    const third = data?.lines[2];
    expect(third?.supplierPartId).toBe("9691T713");
    expect(third?.unitPrice).toBe(184);
    expect(third?.unitOfMeasureCode).toBe("PR");
  });

  it("treats an empty cart as a cancel (no lines)", () => {
    const empty = fixture("poom").replace(/<ItemIn[\s\S]*<\/ItemIn>/, "");
    const { data } = parsePunchOutOrderMessage(empty);
    expect(data?.lines).toHaveLength(0);
  });
});

describe("parseConfirmationRequest", () => {
  it("parses the $629.52 total, 4 lines, and delivery dates", () => {
    const { data, error } = parseConfirmationRequest(
      fixture("order-confirmation")
    );
    expect(error).toBeNull();
    expect(data?.total).toBe(629.52);
    expect(data?.confirmId).toBe("4122618");
    expect(data?.orderId).toBe("2951005347");
    expect(data?.lines).toHaveLength(4);
    expect(data?.lines[0]?.deliveryDate).toBe("2018-07-13T08:40:02-05:00");
    expect(data?.lines[0]?.unitOfMeasureCode).toBe("EA");
  });
});

describe("parseShipNoticeRequest", () => {
  it("parses the UPS tracking number, carrier, and UOM", () => {
    const { data, error } = parseShipNoticeRequest(fixture("ship-notice"));
    expect(error).toBeNull();
    expect(data?.trackingNumber).toBe("1Z602878787878787878");
    expect(data?.carrier).toBe("UPS");
    expect(data?.shipmentId).toBe("8490281");
    expect(data?.orderId).toBe("4506600153");
    expect(data?.lines).toHaveLength(1);
    expect(data?.lines[0]?.unitOfMeasureCode).toBe("PK");
  });
});

describe("parseInvoiceDetailRequest", () => {
  it("parses a standard invoice: gross 269.92, net term 30", () => {
    const { data, error } = parseInvoiceDetailRequest(fixture("invoice"));
    expect(error).toBeNull();
    expect(data?.purpose).toBe("standard");
    expect(data?.invoiceId).toBe("123456789");
    expect(data?.gross).toBe(269.92);
    expect(data?.tax).toBe(15.88);
    expect(data?.subtotal).toBe(254.04);
    expect(data?.paymentTermDays).toBe(30);
    expect(data?.lines).toHaveLength(1);
    expect(data?.lines[0]?.supplierPartId).toBe("3190K822");
    expect(data?.lines[0]?.orderLineNumber).toBe(1);
    expect(data?.lines[0]?.quantity).toBe(2);
    expect(data?.lines[0]?.unitPrice).toBe(127.02);
    expect(data?.currencyCode).toBe("USD");
  });

  it("parses a credit memo with negative quantities/amounts", () => {
    const { data, error } = parseInvoiceDetailRequest(fixture("credit-memo"));
    expect(error).toBeNull();
    expect(data?.purpose).toBe("lineLevelCreditMemo");
    expect(data?.due).toBe(-269.92);
    expect(data?.lines[0]?.quantity).toBe(-2);
    expect(data?.lines[0]?.subtotal).toBe(-254.04);
  });
});

describe("parsePunchOutSetupResponse", () => {
  it("reads the status code and StartPage URL", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<cXML payloadID="p" timestamp="t">
  <Response>
    <Status code="200" text="success" />
    <PunchOutSetupResponse>
      <StartPage>
        <URL>https://www.mcmaster.com/session/abc</URL>
      </StartPage>
    </PunchOutSetupResponse>
  </Response>
</cXML>`;
    const { data } = parsePunchOutSetupResponse(xml);
    expect(data?.statusCode).toBe(200);
    expect(data?.startPageUrl).toBe("https://www.mcmaster.com/session/abc");
  });
});

describe("decodePunchoutFormPost", () => {
  it("prefers cxml-base64 (case-insensitive) over cxml-urlencoded", () => {
    const xml = "<cXML>ok</cXML>";
    const b64 = btoa(xml);
    const form = new URLSearchParams();
    form.set("cxml-urlencoded", "<cXML>wrong</cXML>");
    form.set("CXML-Base64", b64);
    expect(decodePunchoutFormPost(form)).toBe(xml);
  });
  it("falls back to cxml-urlencoded", () => {
    const form = new URLSearchParams();
    form.set("cxml-urlencoded", "<cXML>ok</cXML>");
    expect(decodePunchoutFormPost(form)).toBe("<cXML>ok</cXML>");
  });
  it("returns null when neither key is present", () => {
    expect(decodePunchoutFormPost(new URLSearchParams())).toBeNull();
  });
});
