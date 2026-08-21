import { XMLParser } from "fast-xml-parser";
import { describe, expect, it } from "vitest";
import type { CxmlCredentials } from "../types";
import {
  buildCxmlResponse,
  buildOrderRequest,
  buildPunchOutSetupRequest
} from "./build";
import { parsePunchOutOrderMessage } from "./parse";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  parseTagValue: false
});

const credentials: CxmlCredentials = {
  from: { domain: "NetworkID", identity: "tester" },
  to: { domain: "DUNS", identity: "006931349" },
  sender: { domain: "NetworkID", identity: "tester" },
  sharedSecret: "mcmaster",
  deploymentMode: "test",
  userAgent: "Carbon"
};

describe("buildPunchOutSetupRequest", () => {
  it("round-trips BuyerCookie and return URL", () => {
    const xml = buildPunchOutSetupRequest({
      credentials,
      buyerCookie: "cookie-123",
      returnUrl: "https://erp.example.com/api/punchout/pnch_1/return",
      userEmail: "buyer@example.com",
      userName: "Jane Buyer",
      payloadId: "payload-1",
      timestamp: "2026-08-20T00:00:00Z"
    });
    const parsed = parser.parse(xml);
    const setup = parsed.cXML.Request.PunchOutSetupRequest;
    expect(setup["@_operation"]).toBe("create");
    expect(setup.BuyerCookie).toBe("cookie-123");
    expect(setup.BrowserFormPost.URL).toBe(
      "https://erp.example.com/api/punchout/pnch_1/return"
    );
    expect(xml).toContain(
      '<Extrinsic name="UserEmail">buyer@example.com</Extrinsic>'
    );
    expect(parsed.cXML.Header.Sender.Credential.SharedSecret).toBe("mcmaster");
  });
});

describe("buildOrderRequest", () => {
  it("echoes SupplierPartID and SupplierPartAuxiliaryID byte-for-byte", () => {
    const xml = buildOrderRequest({
      credentials,
      payloadId: "payload-2",
      timestamp: "2026-08-20T00:00:00Z",
      orderId: "PO-1001",
      orderDate: "2026-08-20T00:00:00Z",
      total: 5.63,
      currencyCode: "USD",
      shipTo: {
        name: "Acme",
        deliverTo: "Joe",
        street: ["123 Test St"],
        city: "Anywhere",
        state: "CT",
        postalCode: "06511",
        countryCode: "US"
      },
      billTo: null,
      contactEmail: "buyer@example.com",
      contactName: "Jane Buyer",
      comments: null,
      lines: [
        {
          lineNumber: 1,
          quantity: 2,
          supplierPartId: "6884A242",
          supplierPartAuxiliaryId: "2058175713947",
          unitPrice: 5.63,
          description: "Nosepiece for Cordless & Air-Powered Tool",
          unitOfMeasureCode: "EA"
        }
      ]
    });

    // The raw aux id appears unescaped, byte-for-byte, in the output.
    expect(xml).toContain(
      "<SupplierPartAuxiliaryID>2058175713947</SupplierPartAuxiliaryID>"
    );

    const parsed = parser.parse(xml);
    const item = parsed.cXML.Request.OrderRequest.ItemOut;
    expect(item["@_lineNumber"]).toBe("1");
    expect(item["@_quantity"]).toBe("2");
    expect(item.ItemID.SupplierPartID).toBe("6884A242");
    expect(item.ItemID.SupplierPartAuxiliaryID).toBe("2058175713947");
    expect(
      parsed.cXML.Request.OrderRequest.OrderRequestHeader["@_orderID"]
    ).toBe("PO-1001");
    // Description with an ampersand escapes and re-parses cleanly (the node
    // carries an xml:lang attribute, so the text lives on #text).
    expect(item.ItemDetail.Description["#text"]).toBe(
      "Nosepiece for Cordless & Air-Powered Tool"
    );
  });

  it("preserves an already-escaped aux id verbatim (round-trips through the POOM)", () => {
    // An aux id arriving already-escaped from a cart must not be double-escaped.
    const auxRaw = "A&amp;B";
    const xml = buildOrderRequest({
      credentials,
      payloadId: "p",
      timestamp: "t",
      orderId: "PO-2",
      orderDate: "t",
      total: 1,
      currencyCode: "USD",
      shipTo: null,
      billTo: null,
      contactEmail: null,
      contactName: null,
      comments: null,
      lines: [
        {
          lineNumber: 1,
          quantity: 1,
          supplierPartId: "X",
          supplierPartAuxiliaryId: auxRaw,
          unitPrice: 1,
          description: "d",
          unitOfMeasureCode: "EA"
        }
      ]
    });
    expect(xml).toContain(
      `<SupplierPartAuxiliaryID>${auxRaw}</SupplierPartAuxiliaryID>`
    );
  });
});

describe("buildCxmlResponse", () => {
  it("builds a parseable Status response", () => {
    const xml = buildCxmlResponse({
      statusCode: 200,
      statusText: "success",
      payloadId: "p",
      timestamp: "t"
    });
    const parsed = parser.parse(xml);
    expect(parsed.cXML.Response.Status["@_code"]).toBe("200");
    expect(parsed.cXML.Response.Status["@_text"]).toBe("success");
  });
});

describe("cart → order round-trip", () => {
  it("carries POOM aux ids into an OrderRequest unchanged", () => {
    const poom = `<?xml version="1.0"?>
<cXML payloadID="p" timestamp="t" version="1.1">
  <Message>
    <PunchOutOrderMessage>
      <BuyerCookie>c</BuyerCookie>
      <PunchOutOrderMessageHeader operationAllowed="create">
        <Total><Money currency="USD">0.9</Money></Total>
      </PunchOutOrderMessageHeader>
      <ItemIn quantity="1">
        <ItemID>
          <SupplierPartID>3201T16</SupplierPartID>
          <SupplierPartAuxiliaryID>8310486455458</SupplierPartAuxiliaryID>
        </ItemID>
        <ItemDetail>
          <UnitPrice><Money currency="USD">0.9</Money></UnitPrice>
          <Description xml:lang="en">U-Bolt</Description>
          <UnitOfMeasure>EA</UnitOfMeasure>
        </ItemDetail>
      </ItemIn>
    </PunchOutOrderMessage>
  </Message>
</cXML>`;
    const { data } = parsePunchOutOrderMessage(poom);
    const line = data?.lines[0];
    const xml = buildOrderRequest({
      credentials,
      payloadId: "p",
      timestamp: "t",
      orderId: "PO-3",
      orderDate: "t",
      total: 0.9,
      currencyCode: "USD",
      shipTo: null,
      billTo: null,
      contactEmail: null,
      contactName: null,
      comments: null,
      lines: [
        {
          lineNumber: 1,
          quantity: line?.quantity ?? 0,
          supplierPartId: line?.supplierPartId ?? "",
          supplierPartAuxiliaryId: line?.supplierPartAuxiliaryId ?? null,
          unitPrice: line?.unitPrice ?? 0,
          description: line?.description ?? "",
          unitOfMeasureCode: line?.unitOfMeasureCode ?? "EA"
        }
      ]
    });
    expect(xml).toContain(
      "<SupplierPartAuxiliaryID>8310486455458</SupplierPartAuxiliaryID>"
    );
  });
});
