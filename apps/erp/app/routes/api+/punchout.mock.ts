import { buildCxmlResponse, parseCxmlEnvelope } from "@carbon/ee/punchout";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

// Dev-only mock of McMaster's punchout + order endpoints, so the whole round
// trip can be exercised locally without real credentials. Install the
// integration with punchoutUrl = <origin>/api/punchout/mock and order URLs =
// <origin>/api/punchout/mock?as=order.

function notFoundInProduction() {
  if (process.env.NODE_ENV === "production") {
    throw new Response("Not found", { status: 404 });
  }
}

const XML_HEADERS = { "Content-Type": "text/xml" };
const HTML_HEADERS = { "Content-Type": "text/html" };

// A three-line POOM matching the real McMaster sample parts; the BuyerCookie is
// substituted per request. An empty-cart variant omits every ItemIn.
function poom(buyerCookie: string, empty: boolean): string {
  const items = empty
    ? ""
    : `
      <ItemIn quantity="2">
        <ItemID>
          <SupplierPartID>3201T16</SupplierPartID>
          <SupplierPartAuxiliaryID>8310486455458</SupplierPartAuxiliaryID>
        </ItemID>
        <ItemDetail>
          <UnitPrice><Money currency="USD">0.9</Money></UnitPrice>
          <Description xml:lang="en">Black-Oxide Steel U-Bolt</Description>
          <UnitOfMeasure>EA</UnitOfMeasure>
          <Classification domain="UNSPSC">31161600</Classification>
        </ItemDetail>
      </ItemIn>
      <ItemIn quantity="1">
        <ItemID>
          <SupplierPartID>57145K76</SupplierPartID>
          <SupplierPartAuxiliaryID>8310486455459</SupplierPartAuxiliaryID>
        </ItemID>
        <ItemDetail>
          <UnitPrice><Money currency="USD">18.18</Money></UnitPrice>
          <Description xml:lang="en">Hinged Shaft Collar</Description>
          <UnitOfMeasure>EA</UnitOfMeasure>
          <Classification domain="UNSPSC">23150000</Classification>
        </ItemDetail>
      </ItemIn>
      <ItemIn quantity="1">
        <ItemID>
          <SupplierPartID>9691T713</SupplierPartID>
          <SupplierPartAuxiliaryID>8310486455460</SupplierPartAuxiliaryID>
        </ItemID>
        <ItemDetail>
          <UnitPrice><Money currency="USD">184</Money></UnitPrice>
          <Description xml:lang="en">Leather Work Shoes</Description>
          <UnitOfMeasure>PR</UnitOfMeasure>
          <Classification domain="UNSPSC">46181600</Classification>
        </ItemDetail>
      </ItemIn>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<cXML payloadID="${datetime.timestamp()}@mock.carbon" timestamp="${datetime.timestamp()}" version="1.1">
  <Header>
    <From><Credential domain="DUNS"><Identity>006931349</Identity></Credential></From>
    <To><Credential domain="NetworkID"><Identity>mock</Identity></Credential></To>
    <Sender>
      <Credential domain="DUNS"><Identity>006931349</Identity><SharedSecret>mcmaster</SharedSecret></Credential>
      <UserAgent>Mock McMaster-Carr</UserAgent>
    </Sender>
  </Header>
  <Message>
    <PunchOutOrderMessage>
      <BuyerCookie>${buyerCookie}</BuyerCookie>
      <PunchOutOrderMessageHeader operationAllowed="create">
        <Total><Money currency="USD">203.08</Money></Total>
      </PunchOutOrderMessageHeader>${items}
    </PunchOutOrderMessage>
  </Message>
</cXML>`;
}

// Plays McMaster's POSR + order endpoints.
export async function action({ request }: ActionFunctionArgs) {
  notFoundInProduction();
  const url = new URL(request.url);

  // Order-posting endpoint: always accept with a 200 cXML Response.
  if (url.searchParams.get("as") === "order") {
    return new Response(
      buildCxmlResponse({
        statusCode: 200,
        statusText: "success",
        payloadId: `${datetime.timestamp()}@mock.carbon`,
        timestamp: datetime.timestamp()
      }),
      { headers: XML_HEADERS, status: 200 }
    );
  }

  // POSR endpoint: read the BuyerCookie + BrowserFormPost URL, hand back a
  // PunchOutSetupResponse whose StartPage points at the mock storefront (loader).
  const body = await request.text();
  const { body: envelopeBody } = parseCxmlEnvelope(body);
  const setup = (envelopeBody as Record<string, unknown> | null)?.[
    "PunchOutSetupRequest"
  ] as Record<string, unknown> | undefined;
  const buyerCookie = String(setup?.["BuyerCookie"] ?? "");
  const browserFormPost = setup?.["BrowserFormPost"] as
    | Record<string, unknown>
    | undefined;
  const returnUrl = String(browserFormPost?.["URL"] ?? "");

  const startPage = `${url.origin}/api/punchout/mock?cookie=${encodeURIComponent(
    buyerCookie
  )}&return=${encodeURIComponent(returnUrl)}`;

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>
<cXML payloadID="${datetime.timestamp()}@mock.carbon" timestamp="${datetime.timestamp()}">
  <Response>
    <Status code="200" text="success" />
    <PunchOutSetupResponse>
      <StartPage><URL>${startPage}</URL></StartPage>
    </PunchOutSetupResponse>
  </Response>
</cXML>`,
    { headers: XML_HEADERS, status: 200 }
  );
}

// Plays the McMaster storefront: a minimal page that posts a cart (or an empty
// cancel cart) back to the return URL.
export async function loader({ request }: LoaderFunctionArgs) {
  notFoundInProduction();
  const url = new URL(request.url);
  const cookie = url.searchParams.get("cookie") ?? "";
  const returnUrl = url.searchParams.get("return") ?? "";

  const checkoutCart = poom(cookie, false);
  const cancelCart = poom(cookie, true);

  const page = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Mock McMaster-Carr</title></head>
  <body style="font-family: system-ui; padding: 2rem; max-width: 40rem; margin: 0 auto;">
    <h1>Mock McMaster-Carr — 3 items</h1>
    <p>This stands in for mcmaster.com during local development.</p>
    <form method="post" action="${returnUrl}">
      <input type="hidden" name="cxml-urlencoded" value="${escapeHtmlAttr(
        checkoutCart
      )}" />
      <button type="submit">Checkout (return 3-line cart)</button>
    </form>
    <form method="post" action="${returnUrl}" style="margin-top: 1rem;">
      <input type="hidden" name="cxml-urlencoded" value="${escapeHtmlAttr(
        cancelCart
      )}" />
      <button type="submit">Cancel (empty cart)</button>
    </form>
  </body>
</html>`;

  return new Response(page, { headers: HTML_HEADERS, status: 200 });
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
