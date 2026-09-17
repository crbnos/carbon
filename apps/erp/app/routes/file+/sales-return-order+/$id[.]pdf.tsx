import { requirePermissions } from "@carbon/auth/auth.server";
import { ensureFont, SalesReturnOrderPDF } from "@carbon/documents/pdf";
import {
  collectSectionIds,
  resolveTemplate,
  toDocumentTemplate
} from "@carbon/documents/template";
import { getLogger } from "@carbon/logger";
import type { JSONContent } from "@carbon/react";
import { getPreferenceHeaders } from "@carbon/utils";
import { renderToStream } from "@react-pdf/renderer";
import type { LoaderFunctionArgs } from "react-router";
import { getCurrencyByCode } from "~/modules/accounting";
import { getLocation } from "~/modules/resources";
import {
  getCustomer,
  getCustomerLocation,
  getCustomerLocations,
  getSalesReturnOrder,
  getSalesReturnOrderLines,
  getSalesTerms
} from "~/modules/sales";
import {
  getCompany,
  getCompanySettings,
  getDocumentTemplate,
  resolveSections
} from "~/modules/settings";

const logger = getLogger("erp", "sales-return-order", "pdf");

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, companyGroupId } = await requirePermissions(
    request,
    {
      view: "sales"
    }
  );

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [
    company,
    companySettings,
    salesReturnOrder,
    salesReturnOrderLines,
    terms,
    documentTemplate
  ] = await Promise.all([
    getCompany(client, companyId),
    getCompanySettings(client, companyId),
    getSalesReturnOrder(client, id),
    getSalesReturnOrderLines(client, id, companyId),
    getSalesTerms(client, companyId),
    getDocumentTemplate(client, companyId, "salesReturnOrder")
  ]);

  if (company.error) {
    logger.error("Failed to load company", { error: company.error });
  }

  if (salesReturnOrder.error) {
    logger.error("Failed to load salesReturnOrder", {
      error: salesReturnOrder.error
    });
  }

  if (salesReturnOrderLines.error) {
    logger.error("Failed to load salesReturnOrderLines", {
      error: salesReturnOrderLines.error
    });
  }

  if (terms.error) {
    logger.error("Failed to load terms", { error: terms.error });
  }

  if (
    company.error ||
    salesReturnOrder.error ||
    salesReturnOrderLines.error ||
    terms.error
  ) {
    throw new Error("Failed to load sales return order");
  }

  // Party addresses hang off the header row, so they resolve in a second pass.
  const [location, customer, customerLocation, currencyRow] = await Promise.all(
    [
      salesReturnOrder.data.locationId
        ? getLocation(client, salesReturnOrder.data.locationId)
        : null,
      salesReturnOrder.data.customerId
        ? getCustomer(client, salesReturnOrder.data.customerId)
        : null,
      // The header's location when set; otherwise fall back to the customer's
      // own location(s). `customerLocationId` is only populated when the
      // customer has a default shipping location configured, so without this
      // fallback the CUSTOMER box on the PDF prints a bare name with no address.
      salesReturnOrder.data.customerLocationId
        ? getCustomerLocation(client, salesReturnOrder.data.customerLocationId)
        : salesReturnOrder.data.customerId
          ? getCustomerLocations(client, salesReturnOrder.data.customerId)
          : null,
      salesReturnOrder.data.currencyCode
        ? getCurrencyByCode(
            client,
            companyGroupId,
            salesReturnOrder.data.currencyCode
          )
        : null
    ]
  );

  const returnToAddress = location?.data
    ? {
        name: location.data.name,
        addressLine1: location.data.addressLine1,
        addressLine2: location.data.addressLine2,
        city: location.data.city,
        stateProvince: location.data.stateProvince,
        postalCode: location.data.postalCode,
        countryCode: location.data.countryCode
      }
    : null;

  // `getCustomerLocation` returns one row; the `getCustomerLocations` fallback
  // returns an array — normalize to a single row before reading the address.
  const customerLocationRow = Array.isArray(customerLocation?.data)
    ? customerLocation.data[0]
    : customerLocation?.data;
  const customerAddr = customerLocationRow?.address;

  const customerAddress = customer?.data
    ? {
        name: customer.data.name,
        addressLine1: customerAddr?.addressLine1,
        addressLine2: customerAddr?.addressLine2,
        city: customerAddr?.city,
        stateProvince: customerAddr?.stateProvince,
        postalCode: customerAddr?.postalCode,
        country: customerAddr?.country?.name ?? null,
        // The plural fallback's select omits `countryCode`; `country.alpha2`
        // is the same ISO code, so read it from whichever shape is present.
        countryCode:
          ("countryCode" in (customerAddr ?? {})
            ? (customerAddr as { countryCode?: string | null }).countryCode
            : customerAddr?.country?.alpha2) ?? null
      }
    : null;

  const { locale } = getPreferenceHeaders(request);

  const templateConfig = toDocumentTemplate(
    documentTemplate.data,
    "salesReturnOrder"
  );
  const resolved = resolveTemplate("salesReturnOrder", templateConfig);
  const sections = await resolveSections(
    client,
    companyId,
    collectSectionIds(resolved)
  );
  await ensureFont(resolved.settings.fontFamily);

  // Settlement decimals from the document currency's row (authoritative over
  // CLDR); null keeps the PDF's historical 2dp fallback.
  const currencyDecimals = currencyRow?.data?.decimalPlaces ?? null;

  const stream = await renderToStream(
    <SalesReturnOrderPDF
      company={company.data as any}
      companySettings={companySettings.data}
      locale={locale}
      currencyDecimals={currencyDecimals}
      meta={{
        author: "Carbon",
        keywords: "rma, return merchandise authorization",
        subject: "Return Merchandise Authorization"
      }}
      salesReturnOrder={salesReturnOrder.data}
      salesReturnOrderLines={salesReturnOrderLines.data ?? []}
      returnToAddress={returnToAddress}
      customerAddress={customerAddress}
      terms={(terms?.data?.salesTerms ?? {}) as JSONContent}
      title="Return Merchandise Authorization"
      template={templateConfig}
      sections={sections}
    />
  );

  const body: Buffer = await new Promise((resolve, reject) => {
    const buffers: Uint8Array[] = [];
    stream.on("data", (data) => {
      buffers.push(data);
    });
    stream.on("end", () => {
      resolve(Buffer.concat(buffers));
    });
    stream.on("error", reject);
  });

  const headers = new Headers({
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${company.data.name} - ${salesReturnOrder.data.salesReturnOrderId}.pdf"`
  });
  return new Response(new Uint8Array(body), { status: 200, headers });
}
