// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { SalesInvoiceEmail } from "@carbon/documents/email";
import { ensureFont, SalesInvoicePDF } from "@carbon/documents/pdf";
import type { DocumentEdit } from "@carbon/documents/template";
import {
  collectSectionIds,
  resolveTemplate,
  templateShowsThumbnails
} from "@carbon/documents/template";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getBase64Image,
  getCompany,
  renderPdfToBuffer,
  resolveSections,
  withEmailLogos,
  withPdfLogos
} from "./document-data.server";
import { getCompanyTemplate, getPrintedTemplate } from "./document-edit.server";
import { loadTaxSummary } from "./sales-invoice-tax-summary.server";

export { loadTaxSummary };

const logger = getLogger("lib", "sales-invoice-document");

// The documents package does not export its prop interfaces; derive them.
export type SalesInvoicePDFProps = Parameters<typeof SalesInvoicePDF>[0];
type SalesInvoiceEmailProps = Parameters<typeof SalesInvoiceEmail>[0];

/**
 * Everything needed to render a sales invoice as a PDF and as an email body,
 * read once. Shared by the ERP's PDF route, the manual post route and the
 * rental invoice automation job, so all three render the same document.
 */
export type SalesInvoiceDocument = {
  pdfProps: SalesInvoicePDFProps;
  email: Omit<SalesInvoiceEmailProps, "recipient" | "sender" | "locale">;
  invoiceReadableId: string;
  fileName: string;
};

type Client = SupabaseClient<Database>;

/** The company-level reads every sales invoice PDF needs. */
async function loadCompanyInvoiceData(client: Client, companyId: string) {
  const [
    company,
    companySettings,
    arBillingAddress,
    terms,
    paymentTerms,
    shippingMethods,
    shippingTerms
  ] = await Promise.all([
    getCompany(client, companyId),
    client.from("companySettings").select("*").eq("id", companyId).single(),
    client
      .from("companyAccountsReceivableBillingAddress")
      .select("*")
      .eq("id", companyId)
      .single(),
    client.from("terms").select("salesTerms").eq("id", companyId).single(),
    client
      .from("paymentTerm")
      .select("id, name")
      .eq("companyId", companyId)
      .eq("active", true)
      .order("name", { ascending: true }),
    client
      .from("shippingMethod")
      .select("id, name")
      .eq("companyId", companyId)
      .eq("active", true)
      .order("name", { ascending: true }),
    client
      .from("shippingTerm")
      .select("id, name")
      .eq("companyId", companyId)
      .eq("active", true)
      .order("name", { ascending: true })
  ]);
  return {
    company,
    companySettings,
    arBillingAddress,
    terms,
    paymentTerms,
    shippingMethods,
    shippingTerms
  };
}

/**
 * Read a sales invoice and everything its PDF and email render. A pure
 * function of its arguments — no request, no app imports — so an Inngest job
 * can call it with a service-role client. Throws when the invoice, company,
 * lines, locations, shipment or terms cannot be read.
 */
export async function loadSalesInvoiceDocument(args: {
  client: Client;
  /**
   * Service-role client for the tax reads, whose RLS needs accounting, sales
   * or purchasing view, so an invoicing-only reader prints the same tax as the
   * emailed copy. Pass it only after checking the caller's permission; a
   * caller that already holds a service-role `client` passes it again.
   */
  taxClient: Client;
  companyId: string;
  companyGroupId: string;
  invoiceId: string;
  locale: string;
  /** Draft edits to preview; omitted, the saved ones are read. */
  edit?: DocumentEdit | null;
}): Promise<SalesInvoiceDocument> {
  const {
    client,
    taxClient,
    companyId,
    companyGroupId,
    invoiceId,
    locale,
    edit
  } = args;

  const [
    {
      company,
      companySettings,
      arBillingAddress,
      terms,
      paymentTerms,
      shippingMethods,
      shippingTerms
    },
    salesInvoice,
    salesInvoiceLines,
    salesInvoiceLocations,
    salesInvoiceShipment,
    templateConfig
  ] = await Promise.all([
    loadCompanyInvoiceData(client, companyId),
    client
      .from("salesInvoices")
      .select("*")
      .eq("id", invoiceId)
      .eq("companyId", companyId)
      .single(),
    client
      .from("salesInvoiceLines")
      .select("*")
      .eq("invoiceId", invoiceId)
      .eq("companyId", companyId)
      .order("sortOrder", { ascending: true })
      .order("createdAt", { ascending: true }),
    // The view has no companyId; the header read beside it is scoped, and a
    // missing header aborts the load before this row is used.
    client
      .from("salesInvoiceLocations")
      .select("*")
      .eq("id", invoiceId)
      .single(),
    client
      .from("salesInvoiceShipment")
      .select("*")
      .eq("id", invoiceId)
      .eq("companyId", companyId)
      .single(),
    getPrintedTemplate(
      client,
      { companyId, documentType: "salesInvoice", documentId: invoiceId },
      edit
    )
  ]);

  if (company.error) {
    logger.error("Failed to load company", { error: company.error });
  }
  if (salesInvoice.error) {
    logger.error("Failed to load salesInvoice", { error: salesInvoice.error });
  }
  if (salesInvoiceLines.error) {
    logger.error("Failed to load salesInvoiceLines", {
      error: salesInvoiceLines.error
    });
  }
  if (salesInvoiceShipment.error) {
    logger.error("Failed to load salesInvoiceShipment", {
      error: salesInvoiceShipment.error
    });
  }
  if (salesInvoiceLocations.error) {
    logger.error("Failed to load salesInvoiceLocations", {
      error: salesInvoiceLocations.error
    });
  }
  if (terms.error) {
    logger.error("Failed to load terms", { error: terms.error });
  }

  if (
    company.error ||
    salesInvoice.error ||
    salesInvoiceLines.error ||
    salesInvoiceLocations.error ||
    salesInvoiceShipment.error ||
    terms.error
  ) {
    throw new Error("Failed to load sales invoice");
  }

  let thumbnails: Record<string, string | null> = {};
  if (templateShowsThumbnails(templateConfig, "salesInvoice")) {
    const loaded = await Promise.all(
      (salesInvoiceLines.data ?? [])
        .filter((line) => line.id && line.thumbnailPath)
        .map(async (line) => ({
          id: line.id!,
          data: await getBase64Image(client, line.thumbnailPath!)
        }))
    );
    thumbnails = loaded.reduce<Record<string, string | null>>(
      (acc, thumbnail) => {
        acc[thumbnail.id] = thumbnail.data;
        return acc;
      },
      {}
    );
  }

  // Resolve the human-readable numbers of any sales orders linked to this
  // invoice's lines. An invoice can be billed against more than one sales
  // order, so we collect the distinct set.
  const linkedSalesOrderIds = Array.from(
    new Set(
      (salesInvoiceLines.data ?? [])
        .map((line) => line.salesOrderId)
        .filter((salesOrderId): salesOrderId is string => Boolean(salesOrderId))
    )
  );

  let salesOrderIds: string[] = [];
  if (linkedSalesOrderIds.length > 0) {
    const salesOrders = await client
      .from("salesOrder")
      .select("id, salesOrderId")
      .in("id", linkedSalesOrderIds)
      .eq("companyId", companyId);
    if (salesOrders.error) {
      logger.error("Failed to load salesOrders", { error: salesOrders.error });
    }
    salesOrderIds = Array.from(
      new Set((salesOrders.data ?? []).map((order) => order.salesOrderId))
    ).sort();
  }

  // The effective template (the default when nothing is stored), so built-in and
  // forked header and footer sections render before a company saves a layout.
  const sections = await resolveSections(
    client,
    companyId,
    collectSectionIds(templateConfig)
  );

  // Settlement decimals from the document currency's row (authoritative over
  // CLDR); null keeps the PDF's historical 2dp fallback.
  const [currencyRow, invoiceContact] = await Promise.all([
    salesInvoice.data.currencyCode
      ? client
          .from("currencies")
          .select("*")
          .eq("code", salesInvoice.data.currencyCode)
          .eq("companyGroupId", companyGroupId)
          .single()
      : null,
    salesInvoice.data.invoiceCustomerContactId
      ? client
          .from("customerContact")
          .select("contact(fullName, email)")
          .eq("id", salesInvoice.data.invoiceCustomerContactId)
          .eq("companyId", companyId)
          .maybeSingle()
      : null
  ]);
  const currencyDecimals = currencyRow?.data?.decimalPlaces ?? null;
  if (invoiceContact?.error) {
    logger.error("Failed to load invoice contact", {
      error: invoiceContact.error
    });
  }
  const locations = {
    ...salesInvoiceLocations.data,
    contactName: invoiceContact?.data?.contact?.fullName ?? null,
    contactEmail: invoiceContact?.data?.contact?.email ?? null
  };

  const tax = await loadTaxSummary({
    taxClient,
    companyId,
    invoiceId,
    company: company.data,
    salesInvoice: salesInvoice.data,
    lines: salesInvoiceLines.data ?? [],
    headerShipping:
      (salesInvoiceShipment.data?.shippingCost ?? 0) *
      (salesInvoice.data.exchangeRate ?? 1),
    currencyDecimals
  });

  // `company` (the table row) stands in for the `companies` view row the
  // documents type against, as the routes always did.
  const pdfCompany = withPdfLogos(
    company.data
  ) as unknown as SalesInvoicePDFProps["company"];
  const emailCompany = withEmailLogos(
    company.data
  ) as unknown as SalesInvoicePDFProps["company"];
  const lines = salesInvoiceLines.data ?? [];

  const pdfProps: SalesInvoicePDFProps = {
    company: pdfCompany,
    companySettings: companySettings.data,
    locale,
    currencyDecimals,
    meta: {
      author: "Carbon",
      keywords: "sales order",
      subject: "Sales Invoice"
    },
    salesInvoice: salesInvoice.data,
    salesInvoiceLines: lines,
    salesOrderIds,
    salesInvoiceLocations: locations,
    salesInvoiceShipment: salesInvoiceShipment.data,
    accountsReceivableBillingAddress: companySettings.data
      ?.accountsReceivableAddress
      ? arBillingAddress.data
      : null,
    terms: (terms.data?.salesTerms ?? {}) as SalesInvoicePDFProps["terms"],
    paymentTerms: paymentTerms.data ?? [],
    shippingMethods: shippingMethods.data ?? [],
    shippingTerms: shippingTerms.data ?? [],
    thumbnails,
    template: templateConfig,
    sections,
    ...tax
  };

  // The view types every column nullable; the table's invoiceId never is.
  const invoiceReadableId = salesInvoice.data.invoiceId ?? invoiceId;

  return {
    pdfProps,
    email: {
      company: emailCompany,
      currencyDecimals,
      salesInvoice: salesInvoice.data,
      salesInvoiceLines: lines,
      salesInvoiceLocations: salesInvoiceLocations.data,
      salesInvoiceShipment: salesInvoiceShipment.data,
      paymentTerms: paymentTerms.data ?? []
    },
    invoiceReadableId,
    fileName: `${company.data.name} - ${invoiceReadableId}.pdf`
  };
}

/** An invoice that is not saved: its header and lines, computed by the caller. */
export type UnsavedSalesInvoice = {
  /** What prints as the invoice number, e.g. "Preview". */
  invoiceId: string;
  customerId: string;
  /** Bill-to and ship-to, as a rental invoice drafts them. */
  customerLocationId: string | null;
  customerContactId: string | null;
  paymentTermId: string | null;
  currencyCode: string;
  exchangeRate: number;
  dateIssued: string;
  dateDue: string | null;
  subtotal: number;
  totalTax: number;
  totalAmount: number;
  lines: {
    id: string;
    invoiceLineType: Database["public"]["Enums"]["salesInvoiceLineType"];
    description: string;
    unitPrice: number;
    convertedUnitPrice: number;
    taxPercent: number;
    taxCodeId: string | null;
  }[];
};

/**
 * The PDF props of an invoice that exists only in memory — a preview of what
 * a billing run will draft. Reads the company, the customer, its location and
 * contact, and the company's sales invoice template (no per-document edit:
 * there is no document). Writes nothing.
 */
export async function loadUnsavedSalesInvoiceDocument(args: {
  client: Client;
  /** Service-role client for the tax summary, as `loadSalesInvoiceDocument`. */
  taxClient: Client;
  companyId: string;
  companyGroupId: string;
  locale: string;
  invoice: UnsavedSalesInvoice;
}): Promise<{ pdfProps: SalesInvoicePDFProps; fileName: string }> {
  const { client, taxClient, companyId, companyGroupId, locale, invoice } =
    args;

  const [
    companyData,
    customer,
    customerTax,
    location,
    contact,
    currency,
    templateConfig
  ] = await Promise.all([
    loadCompanyInvoiceData(client, companyId),
    client
      .from("customer")
      .select("name")
      .eq("id", invoice.customerId)
      .eq("companyId", companyId)
      .single(),
    client
      .from("customerTax")
      .select("taxId, vatNumber, eori")
      .eq("customerId", invoice.customerId)
      .maybeSingle(),
    invoice.customerLocationId
      ? client
          .from("customerLocation")
          .select(
            "address(addressLine1, addressLine2, city, stateProvince, postalCode, countryCode, country(name))"
          )
          .eq("id", invoice.customerLocationId)
          .eq("customerId", invoice.customerId)
          .maybeSingle()
      : null,
    invoice.customerContactId
      ? client
          .from("customerContact")
          .select("contact(fullName, email)")
          .eq("id", invoice.customerContactId)
          .eq("companyId", companyId)
          .maybeSingle()
      : null,
    client
      .from("currencies")
      .select("decimalPlaces")
      .eq("code", invoice.currencyCode)
      .eq("companyGroupId", companyGroupId)
      .maybeSingle(),
    getCompanyTemplate(client, { companyId, documentType: "salesInvoice" })
  ]);

  const { company, companySettings, arBillingAddress, terms } = companyData;
  // A failed address or contact read would print an invoice with no Bill To.
  if (
    company.error ||
    customer.error ||
    terms.error ||
    customerTax.error ||
    location?.error ||
    contact?.error
  ) {
    logger.error("Failed to load the unsaved sales invoice", {
      errors: [company, customer, terms, customerTax, location, contact]
        .map((read) => read?.error)
        .filter(Boolean)
    });
    throw new Error("Failed to load sales invoice");
  }

  const sections = await resolveSections(
    client,
    companyId,
    collectSectionIds(templateConfig)
  );

  const address = location?.data?.address ?? null;
  const pdfCompany = withPdfLogos(
    company.data
  ) as unknown as SalesInvoicePDFProps["company"];

  // The PDF reads view rows an unsaved invoice has none of, so they are built
  // here. `salesInvoiceLocations` mirrors the view's joins
  // (`20261006221401_sales-invoice-discount-and-ship-to.sql`): keep them equal.
  const salesInvoice = {
    id: invoice.invoiceId,
    invoiceId: invoice.invoiceId,
    status: "Draft",
    customerId: invoice.customerId,
    invoiceCustomerId: invoice.customerId,
    invoiceCustomerContactId: invoice.customerContactId,
    invoiceCustomerLocationId: invoice.customerLocationId,
    paymentTermId: invoice.paymentTermId,
    currencyCode: invoice.currencyCode,
    exchangeRate: invoice.exchangeRate,
    dateIssued: invoice.dateIssued,
    dateDue: invoice.dateDue,
    subtotal: invoice.subtotal,
    totalTax: invoice.totalTax,
    totalDiscount: 0,
    totalAmount: invoice.totalAmount,
    customerReference: null,
    externalNotes: null,
    customFields: null,
    companyId
  } as unknown as SalesInvoicePDFProps["salesInvoice"];

  const salesInvoiceLines = invoice.lines.map((line, index) => ({
    id: line.id,
    invoiceId: invoice.invoiceId,
    invoiceLineType: line.invoiceLineType,
    description: line.description,
    itemId: null,
    itemReadableId: null,
    quantity: 1,
    unitPrice: line.unitPrice,
    convertedUnitPrice: line.convertedUnitPrice,
    taxPercent: line.taxPercent,
    taxCodeId: line.taxCodeId,
    discountPercent: 0,
    addOnCost: 0,
    convertedAddOnCost: 0,
    nonTaxableAddOnCost: 0,
    convertedNonTaxableAddOnCost: 0,
    shippingCost: 0,
    convertedShippingCost: 0,
    unitOfMeasureCode: "EA",
    exchangeRate: invoice.exchangeRate,
    sortOrder: index + 1,
    companyId
  })) as unknown as SalesInvoicePDFProps["salesInvoiceLines"];

  const customerName = customer.data.name;
  const salesInvoiceLocations = {
    id: invoice.invoiceId,
    customerName,
    customerAddressLine1: null,
    customerAddressLine2: null,
    customerCity: null,
    customerStateProvince: null,
    customerPostalCode: null,
    customerCountryCode: null,
    customerCountryName: null,
    customerTaxId: customerTax.data?.taxId ?? null,
    customerVatNumber: customerTax.data?.vatNumber ?? null,
    customerEori: customerTax.data?.eori ?? null,
    invoiceCustomerName: customerName,
    invoiceAddressLine1: address?.addressLine1 ?? null,
    invoiceAddressLine2: address?.addressLine2 ?? null,
    invoiceCity: address?.city ?? null,
    invoiceStateProvince: address?.stateProvince ?? null,
    invoicePostalCode: address?.postalCode ?? null,
    invoiceCountryCode: address?.countryCode ?? null,
    invoiceCountryName: address?.country?.name ?? null,
    shipmentCustomerName: address ? customerName : null,
    shipmentAddressLine1: address?.addressLine1 ?? null,
    shipmentAddressLine2: address?.addressLine2 ?? null,
    shipmentCity: address?.city ?? null,
    shipmentStateProvince: address?.stateProvince ?? null,
    shipmentPostalCode: address?.postalCode ?? null,
    shipmentCountryCode: address?.countryCode ?? null,
    shipmentCountryName: address?.country?.name ?? null,
    contactName: contact?.data?.contact?.fullName ?? null,
    contactEmail: contact?.data?.contact?.email ?? null
  } as unknown as SalesInvoicePDFProps["salesInvoiceLocations"];

  const salesInvoiceShipment = {
    id: invoice.invoiceId,
    customerLocationId: invoice.customerLocationId,
    shippingCost: 0,
    shippingMethodId: null,
    shippingTermId: null,
    companyId
  } as unknown as SalesInvoicePDFProps["salesInvoiceShipment"];

  // A draft's summary comes from its lines; the preview has no ledger rows.
  const tax = await loadTaxSummary({
    taxClient,
    companyId,
    invoiceId: invoice.invoiceId,
    company: company.data,
    salesInvoice,
    lines: salesInvoiceLines,
    headerShipping: 0,
    currencyDecimals: currency.data?.decimalPlaces ?? null
  });

  const pdfProps: SalesInvoicePDFProps = {
    company: pdfCompany,
    companySettings: companySettings.data,
    locale,
    currencyDecimals: currency.data?.decimalPlaces ?? null,
    meta: {
      author: "Carbon",
      keywords: "sales invoice preview",
      subject: "Sales Invoice"
    },
    salesInvoice,
    salesInvoiceLines,
    salesOrderIds: [],
    salesInvoiceLocations,
    salesInvoiceShipment,
    accountsReceivableBillingAddress: companySettings.data
      ?.accountsReceivableAddress
      ? arBillingAddress.data
      : null,
    terms: (terms.data?.salesTerms ?? {}) as SalesInvoicePDFProps["terms"],
    paymentTerms: companyData.paymentTerms.data ?? [],
    shippingMethods: companyData.shippingMethods.data ?? [],
    shippingTerms: companyData.shippingTerms.data ?? [],
    thumbnails: {},
    template: templateConfig,
    sections,
    ...tax
  };

  return {
    pdfProps,
    fileName: `${company.data.name} - ${invoice.invoiceId}.pdf`
  };
}

/** Render a sales invoice PDF into a Buffer. */
export async function renderSalesInvoicePdf(
  props: SalesInvoicePDFProps
): Promise<Buffer> {
  // Register the chosen Google font (no-op for built-ins / Inter) before render.
  await ensureFont(
    resolveTemplate("salesInvoice", props.template).settings.fontFamily
  );

  // Called as a function (it uses no hooks), as the post route calls
  // SalesInvoiceEmail, so this package needs no React/JSX toolchain of its own.
  return renderPdfToBuffer(SalesInvoicePDF(props));
}
