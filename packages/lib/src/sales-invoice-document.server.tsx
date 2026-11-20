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
import { getPrintedTemplate } from "./document-edit.server";
import { loadTaxSummary } from "./sales-invoice-tax-summary.server";

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
   * emailed copy. Pass it only after checking the caller's permission;
   * defaults to `client` for callers that already hold a service-role one.
   */
  taxClient?: Client;
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
    company,
    companySettings,
    arBillingAddress,
    salesInvoice,
    salesInvoiceLines,
    salesInvoiceLocations,
    salesInvoiceShipment,
    terms,
    paymentTerms,
    shippingMethods,
    shippingTerms,
    templateConfig
  ] = await Promise.all([
    getCompany(client, companyId),
    client.from("companySettings").select("*").eq("id", companyId).single(),
    client
      .from("companyAccountsReceivableBillingAddress")
      .select("*")
      .eq("id", companyId)
      .single(),
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
      .order("name", { ascending: true }),
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
    taxClient: taxClient ?? client,
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
