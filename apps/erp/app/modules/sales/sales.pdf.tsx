// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import {
  ensureFont,
  getQuoteDisplayId,
  QuotePDF,
  SalesOrderPDF,
  SalesReturnOrderPDF
} from "@carbon/documents/pdf";
import {
  collectSectionIds,
  resolveTemplate,
  templateShowsThumbnails,
  toDocumentTemplate
} from "@carbon/documents/template";
import { getLogger } from "@carbon/logger";
import type { JSONContent } from "@carbon/react";
import { renderToStream } from "@react-pdf/renderer";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getCurrencyByCode,
  getPaymentTermsList
} from "~/modules/accounting/accounting.service";
import { getShippingMethodsList } from "~/modules/inventory/inventory.service";
import { getLocation } from "~/modules/resources/resources.service";
import {
  getAccountsReceivableBillingAddress,
  getCompany,
  getCompanySettings,
  getDocumentTemplate,
  resolveSections
} from "~/modules/settings/settings.service";
import { getBase64ImageFromSupabase } from "~/modules/shared/shared.service";
import {
  getCustomer,
  getCustomerLocation,
  getCustomerLocations,
  getQuote,
  getQuoteCustomerDetails,
  getQuotePayment,
  getQuoteShipment,
  getSalesOrder,
  getSalesOrderCustomerDetails,
  getSalesOrderLines,
  getSalesReturnOrder,
  getSalesReturnOrderLines,
  getSalesTerms
} from "./sales.service";
import { getQuoteLinePricesByQuoteId, getQuoteLines } from "./sales.utils";

// The sales documents as PDFs, read with the caller's client. The file
// routes serve them; the operations that issue a document (quote finalize,
// order confirm, return confirm) attach them.

const quotePdfLogger = getLogger("erp", "quote", "pdf");
const salesOrderPdfLogger = getLogger("erp", "sales-order", "pdf");
const salesReturnOrderPdfLogger = getLogger("erp", "sales-return-order", "pdf");

type PdfArgs = {
  id: string;
  companyId: string;
  companyGroupId: string;
  /** The reader's locale, for numbers and dates. */
  locale: string;
};

/** The quote as a PDF response. */
export async function renderQuotePdf(
  client: SupabaseClient<Database>,
  { id, companyId, companyGroupId, locale }: PdfArgs
): Promise<Response> {
  const [
    company,
    companySettings,
    arBillingAddress,
    quote,
    quoteLines,
    quoteLinePrices,
    quoteLocations,
    quotePayment,
    quoteShipment,
    paymentTerms,
    terms,
    shippingMethods,
    documentTemplate
  ] = await Promise.all([
    getCompany(client, companyId),
    getCompanySettings(client, companyId),
    getAccountsReceivableBillingAddress(client, companyId),
    getQuote(client, id),
    getQuoteLines(client, id),
    getQuoteLinePricesByQuoteId(client, id),
    getQuoteCustomerDetails(client, id),
    getQuotePayment(client, id),
    getQuoteShipment(client, id),
    getPaymentTermsList(client, companyId),
    getSalesTerms(client, companyId),
    getShippingMethodsList(client, companyId),
    getDocumentTemplate(client, companyId, "quote")
  ]);

  if (company.error) {
    quotePdfLogger.error("Failed to load company", { error: company.error });
  }

  if (quote.error) {
    quotePdfLogger.error("Failed to load quote", { error: quote.error });
  }

  if (quoteLines.error) {
    quotePdfLogger.error("Failed to load quoteLines", {
      error: quoteLines.error
    });
  }

  if (quoteLinePrices.error) {
    quotePdfLogger.error("Failed to load quoteLinePrices", {
      error: quoteLinePrices.error
    });
  }

  if (quoteLocations.error) {
    quotePdfLogger.error("Failed to load quoteLocations", {
      error: quoteLocations.error
    });
  }

  if (company.error || quote.error || quoteLocations.error) {
    throw new Error("Failed to load quote");
  }

  const templateConfig = toDocumentTemplate(documentTemplate.data, "quote");
  const showThumbnails = templateShowsThumbnails(templateConfig, "quote");

  let thumbnails: Record<string, string | null> = {};

  if (showThumbnails) {
    const thumbnailPaths = quoteLines.data?.reduce<
      Record<string, string | null>
    >((acc, line) => {
      if (line.thumbnailPath) {
        acc[line.id!] = line.thumbnailPath;
      }
      return acc;
    }, {});

    thumbnails =
      (thumbnailPaths
        ? await Promise.all(
            Object.entries(thumbnailPaths).map(([id, path]) => {
              if (!path) {
                return null;
              }
              return getBase64ImageFromSupabase(client, path).then((data) => ({
                id,
                data
              }));
            })
          )
        : []
      )?.reduce<Record<string, string | null>>((acc, thumbnail) => {
        if (thumbnail) {
          acc[thumbnail.id] = thumbnail.data;
        }
        return acc;
      }, {}) ?? {};
  }

  // The document's own stamped rate — never a live lookup, so a reprint can't
  // silently change. Legacy pre-stamping quotes (null) render at 1, consistent
  // with their line snapshots' default. The currency row is read for its
  // display decimals only.
  const exchangeRate = quote.data?.exchangeRate ?? 1;
  let currencyDecimals: number | null = null;
  if (quote.data?.currencyCode) {
    const currency = await getCurrencyByCode(
      client,
      companyGroupId,
      quote.data.currencyCode
    );
    currencyDecimals = currency.data?.decimalPlaces ?? null;
  }

  const resolved = resolveTemplate("quote", templateConfig);
  const sections = await resolveSections(
    client,
    companyId,
    collectSectionIds(resolved)
  );
  await ensureFont(resolved.settings.fontFamily);

  const stream = await renderToStream(
    <QuotePDF
      company={company.data as any}
      companySettings={companySettings.data}
      locale={locale}
      currencyDecimals={currencyDecimals}
      exchangeRate={exchangeRate}
      quote={quote.data}
      quoteLines={quoteLines.data ?? []}
      quoteLinePrices={quoteLinePrices.data ?? []}
      quoteCustomerDetails={quoteLocations.data}
      payment={quotePayment?.data}
      shipment={quoteShipment?.data}
      accountsReceivableBillingAddress={
        companySettings.data?.accountsReceivableAddress
          ? arBillingAddress.data
          : null
      }
      paymentTerms={paymentTerms.data ?? []}
      shippingMethods={shippingMethods.data ?? []}
      terms={(terms?.data?.salesTerms ?? {}) as JSONContent}
      thumbnails={thumbnails}
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
    "Content-Disposition": `inline; filename="${company.data.name} - ${getQuoteDisplayId(quote.data)}.pdf"`
  });
  return new Response(new Uint8Array(body), { status: 200, headers });
}

/** The sales order as a PDF response. */
export async function renderSalesOrderPdf(
  client: SupabaseClient<Database>,
  { id, companyId, companyGroupId, locale }: PdfArgs
): Promise<Response> {
  const [
    company,
    companySettings,
    arBillingAddress,
    salesOrder,
    salesOrderLines,
    salesOrderLocations,
    terms,
    paymentTerms,
    shippingMethods,
    documentTemplate
  ] = await Promise.all([
    getCompany(client, companyId),
    getCompanySettings(client, companyId),
    getAccountsReceivableBillingAddress(client, companyId),
    getSalesOrder(client, id),
    getSalesOrderLines(client, id),
    getSalesOrderCustomerDetails(client, id),
    getSalesTerms(client, companyId),
    getPaymentTermsList(client, companyId),
    getShippingMethodsList(client, companyId),
    getDocumentTemplate(client, companyId, "salesOrder")
  ]);

  if (company.error) {
    salesOrderPdfLogger.error("Failed to load company", {
      error: company.error
    });
  }

  if (salesOrder.error) {
    salesOrderPdfLogger.error("Failed to load salesOrder", {
      error: salesOrder.error
    });
  }

  if (salesOrderLines.error) {
    salesOrderPdfLogger.error("Failed to load salesOrderLines", {
      error: salesOrderLines.error
    });
  }

  if (salesOrderLocations.error) {
    salesOrderPdfLogger.error("Failed to load salesOrderLocations", {
      error: salesOrderLocations.error
    });
  }

  if (terms.error) {
    salesOrderPdfLogger.error("Failed to load terms", { error: terms.error });
  }

  if (
    company.error ||
    salesOrder.error ||
    salesOrderLines.error ||
    salesOrderLocations.error ||
    terms.error
  ) {
    throw new Error("Failed to load sales order");
  }

  const templateConfig = toDocumentTemplate(
    documentTemplate.data,
    "salesOrder"
  );
  const showThumbnails = templateShowsThumbnails(templateConfig, "salesOrder");

  let thumbnails: Record<string, string | null> = {};

  if (showThumbnails) {
    const thumbnailPaths = salesOrderLines.data?.reduce<
      Record<string, string | null>
    >((acc, line) => {
      if (line.thumbnailPath) {
        acc[line.id!] = line.thumbnailPath;
      }
      return acc;
    }, {});

    thumbnails =
      (thumbnailPaths
        ? await Promise.all(
            Object.entries(thumbnailPaths).map(([id, path]) => {
              if (!path) {
                return null;
              }
              return getBase64ImageFromSupabase(client, path).then((data) => ({
                id,
                data
              }));
            })
          )
        : []
      )?.reduce<Record<string, string | null>>((acc, thumbnail) => {
        if (thumbnail) {
          acc[thumbnail.id] = thumbnail.data;
        }
        return acc;
      }, {}) ?? {};
  }

  const resolved = resolveTemplate("salesOrder", templateConfig);
  const sections = await resolveSections(
    client,
    companyId,
    collectSectionIds(resolved)
  );
  await ensureFont(resolved.settings.fontFamily);

  // Settlement decimals from the document currency's row (authoritative over
  // CLDR); null keeps the PDF's historical 2dp fallback.
  const currencyRow = salesOrder.data?.currencyCode
    ? await getCurrencyByCode(
        client,
        companyGroupId,
        salesOrder.data.currencyCode
      )
    : null;
  const currencyDecimals = currencyRow?.data?.decimalPlaces ?? null;

  const stream = await renderToStream(
    <SalesOrderPDF
      company={company.data as any}
      companySettings={companySettings.data}
      locale={locale}
      currencyDecimals={currencyDecimals}
      meta={{
        author: "Carbon",
        keywords: "sales order",
        subject: "Sales Order"
      }}
      salesOrder={salesOrder.data}
      salesOrderLines={salesOrderLines.data ?? []}
      salesOrderLocations={salesOrderLocations.data}
      accountsReceivableBillingAddress={
        companySettings.data?.accountsReceivableAddress
          ? arBillingAddress.data
          : null
      }
      terms={(terms?.data?.salesTerms ?? {}) as JSONContent}
      paymentTerms={paymentTerms.data ?? []}
      shippingMethods={shippingMethods.data ?? []}
      title="Sales Order"
      thumbnails={thumbnails}
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
    "Content-Disposition": `inline; filename="${company.data.name} - ${salesOrder.data.salesOrderId}.pdf"`
  });
  return new Response(new Uint8Array(body), { status: 200, headers });
}

/** The sales return order (RMA) as a PDF response. */
export async function renderSalesReturnOrderPdf(
  client: SupabaseClient<Database>,
  { id, companyId, companyGroupId, locale }: PdfArgs
): Promise<Response> {
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
    salesReturnOrderPdfLogger.error("Failed to load company", {
      error: company.error
    });
  }

  if (salesReturnOrder.error) {
    salesReturnOrderPdfLogger.error("Failed to load salesReturnOrder", {
      error: salesReturnOrder.error
    });
  }

  if (salesReturnOrderLines.error) {
    salesReturnOrderPdfLogger.error("Failed to load salesReturnOrderLines", {
      error: salesReturnOrderLines.error
    });
  }

  if (terms.error) {
    salesReturnOrderPdfLogger.error("Failed to load terms", {
      error: terms.error
    });
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
