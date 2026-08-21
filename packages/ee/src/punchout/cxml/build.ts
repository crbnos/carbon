import type { CxmlAddress, CxmlCredentials } from "../types";

const DOCTYPE =
  '<!DOCTYPE cXML SYSTEM "http://xml.cxml.org/schemas/cXML/1.2.019/cXML.dtd">';

/** Escape text and attribute values. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function credentialsHeader(c: CxmlCredentials): string {
  return `  <Header>
    <From>
      <Credential domain="${escapeXml(c.from.domain)}">
        <Identity>${escapeXml(c.from.identity)}</Identity>
      </Credential>
    </From>
    <To>
      <Credential domain="${escapeXml(c.to.domain)}">
        <Identity>${escapeXml(c.to.identity)}</Identity>
      </Credential>
    </To>
    <Sender>
      <Credential domain="${escapeXml(c.sender.domain)}">
        <Identity>${escapeXml(c.sender.identity)}</Identity>
        <SharedSecret>${escapeXml(c.sharedSecret)}</SharedSecret>
      </Credential>
      <UserAgent>${escapeXml(c.userAgent)}</UserAgent>
    </Sender>
  </Header>`;
}

function renderAddress(tag: "ShipTo" | "BillTo", address: CxmlAddress): string {
  const streets = address.street
    .map((s) => `        <Street>${escapeXml(s)}</Street>`)
    .join("\n");
  return `    <${tag}>
      <Address isoCountryCode="${escapeXml(address.countryCode)}">
        <Name xml:lang="en">${escapeXml(address.name)}</Name>
        <PostalAddress>
${address.deliverTo ? `        <DeliverTo>${escapeXml(address.deliverTo)}</DeliverTo>\n` : ""}${streets}
          <City>${escapeXml(address.city)}</City>
${address.state ? `          <State>${escapeXml(address.state)}</State>\n` : ""}${
  address.postalCode
    ? `          <PostalCode>${escapeXml(address.postalCode)}</PostalCode>\n`
    : ""
}          <Country isoCountryCode="${escapeXml(address.countryCode)}">${escapeXml(
    address.countryCode
  )}</Country>
        </PostalAddress>
      </Address>
    </${tag}>`;
}

/**
 * Build a PunchOutSetupRequest (operation="create"). Matches the POSR fixture
 * shape at cXML 1.2.019.
 */
export function buildPunchOutSetupRequest(input: {
  credentials: CxmlCredentials;
  buyerCookie: string;
  returnUrl: string;
  userEmail: string | null;
  userName: string | null;
  payloadId: string;
  timestamp: string;
}): string {
  const {
    credentials,
    buyerCookie,
    returnUrl,
    userEmail,
    userName,
    payloadId,
    timestamp
  } = input;
  const contact = userName
    ? `      <Contact role="user">
        <Name xml:lang="en">${escapeXml(userName)}</Name>
      </Contact>
`
    : "";
  const extrinsic = userEmail
    ? `      <Extrinsic name="UserEmail">${escapeXml(userEmail)}</Extrinsic>
`
    : "";
  return `<?xml version="1.0" encoding="utf-8"?>
${DOCTYPE}
<cXML timestamp="${escapeXml(timestamp)}" payloadID="${escapeXml(payloadId)}">
${credentialsHeader(credentials)}
  <Request deploymentMode="${credentials.deploymentMode}">
    <PunchOutSetupRequest operation="create">
      <BuyerCookie>${escapeXml(buyerCookie)}</BuyerCookie>
      <BrowserFormPost>
        <URL>${escapeXml(returnUrl)}</URL>
      </BrowserFormPost>
${contact}${extrinsic}    </PunchOutSetupRequest>
  </Request>
</cXML>`;
}

/**
 * Build an OrderRequest. Each ItemOut echoes SupplierPartID and — verbatim,
 * unescaped — SupplierPartAuxiliaryID, which arrives already-escaped from the
 * POOM and must round-trip byte-for-byte.
 */
export function buildOrderRequest(input: {
  credentials: CxmlCredentials;
  payloadId: string;
  timestamp: string;
  orderId: string;
  orderDate: string;
  total: number;
  currencyCode: string;
  shipTo: CxmlAddress | null;
  billTo: CxmlAddress | null;
  contactEmail: string | null;
  contactName: string | null;
  comments: string | null;
  lines: Array<{
    lineNumber: number;
    quantity: number;
    supplierPartId: string;
    supplierPartAuxiliaryId: string | null;
    unitPrice: number;
    description: string;
    unitOfMeasureCode: string;
  }>;
}): string {
  const {
    credentials,
    payloadId,
    timestamp,
    orderId,
    orderDate,
    total,
    currencyCode,
    shipTo,
    billTo,
    contactEmail,
    contactName,
    comments,
    lines
  } = input;

  const items = lines
    .map(
      (
        line
      ) => `      <ItemOut quantity="${line.quantity}" lineNumber="${line.lineNumber}">
        <ItemID>
          <SupplierPartID>${escapeXml(line.supplierPartId)}</SupplierPartID>${
            line.supplierPartAuxiliaryId
              ? `
          <SupplierPartAuxiliaryID>${line.supplierPartAuxiliaryId}</SupplierPartAuxiliaryID>`
              : ""
          }
        </ItemID>
        <ItemDetail>
          <UnitPrice>
            <Money currency="${escapeXml(currencyCode)}">${line.unitPrice}</Money>
          </UnitPrice>
          <Description xml:lang="en">${escapeXml(line.description)}</Description>
          <UnitOfMeasure>${escapeXml(line.unitOfMeasureCode)}</UnitOfMeasure>
        </ItemDetail>
      </ItemOut>`
    )
    .join("\n");

  const contact =
    contactName || contactEmail
      ? `        <Contact role="user">
${contactName ? `          <Name xml:lang="en">${escapeXml(contactName)}</Name>\n` : ""}${
  contactEmail ? `          <Email>${escapeXml(contactEmail)}</Email>\n` : ""
}        </Contact>
`
      : "";

  return `<?xml version="1.0" encoding="utf-8"?>
${DOCTYPE}
<cXML timestamp="${escapeXml(timestamp)}" payloadID="${escapeXml(payloadId)}">
${credentialsHeader(credentials)}
  <Request deploymentMode="${credentials.deploymentMode}">
    <OrderRequest>
      <OrderRequestHeader orderID="${escapeXml(orderId)}" orderDate="${escapeXml(
        orderDate
      )}" type="new">
        <Total>
          <Money currency="${escapeXml(currencyCode)}">${total}</Money>
        </Total>
${shipTo ? `${renderAddress("ShipTo", shipTo)}\n` : ""}${
  billTo ? `${renderAddress("BillTo", billTo)}\n` : ""
}${contact}${comments ? `        <Comments>${escapeXml(comments)}</Comments>\n` : ""}      </OrderRequestHeader>
${items}
    </OrderRequest>
  </Request>
</cXML>`;
}

/** Build the cXML Response the webhook replies with (200 success / 4xx / 5xx). */
export function buildCxmlResponse(input: {
  statusCode: number;
  statusText: string;
  payloadId: string;
  timestamp: string;
}): string {
  const { statusCode, statusText, payloadId, timestamp } = input;
  return `<?xml version="1.0" encoding="utf-8"?>
${DOCTYPE}
<cXML timestamp="${escapeXml(timestamp)}" payloadID="${escapeXml(payloadId)}">
  <Response>
    <Status code="${statusCode}" text="${escapeXml(statusText)}" />
  </Response>
</cXML>`;
}
