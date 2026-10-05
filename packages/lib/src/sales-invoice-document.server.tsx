// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { SalesInvoiceEmail } from "@carbon/documents/email";
import { ensureFont, SalesInvoicePDF } from "@carbon/documents/pdf";
import type { ResolvedSection } from "@carbon/documents/template";
import {
  collectSectionIds,
  getBuiltInSection,
  resolveTemplate,
  templateShowsThumbnails,
  toDocumentTemplate
} from "@carbon/documents/template";
import { getContentType, getFileExtension, storage } from "@carbon/files";
import { getLogger } from "@carbon/logger";
import { renderToStream } from "@react-pdf/renderer";
import type { SupabaseClient } from "@supabase/supabase-js";

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

const LOGO_FIELDS = [
  "logoLight",
  "logoDark",
  "logoLightIcon",
  "logoDarkIcon",
  "logoWatermark"
] as const;

async function getCompanyWithPublicLogos(
  client: Client,
  companyId: string,
  storageUrl: string
) {
  const company = await client
    .from("company")
    .select("*")
    .eq("id", companyId)
    .single();
  if (company.error) return company;

  const prefix = `${storageUrl}/storage/v1/object/public/public/`;
  const data = { ...company.data };
  for (const field of LOGO_FIELDS) {
    data[field] = company.data[field]
      ? `${prefix}${company.data[field]}`
      : null;
  }
  return { data, error: null };
}

async function resolveSections(
  client: Client,
  companyId: string,
  ids: string[]
): Promise<Record<string, ResolvedSection>> {
  if (ids.length === 0) return {};
  const map: Record<string, ResolvedSection> = {};

  // System sections live in code, not the DB. Seed them first so a stored row
  // with the same id (a customized/forked default) overrides below.
  for (const id of ids) {
    const builtIn = getBuiltInSection(id);
    if (builtIn) map[id] = builtIn;
  }

  const dbIds = ids.filter((id) => !map[id] || map[id]?.builtIn);
  const { data } = await client
    .from("documentSection")
    .select("*")
    .eq("companyId", companyId)
    .in("id", dbIds);
  for (const row of (data ?? []) as ResolvedSection[]) {
    map[row.id] = {
      id: row.id,
      name: row.name,
      placement: row.placement,
      content: row.content,
      config: row.config
    };
  }
  return map;
}

async function getBase64Image(client: Client, path: string) {
  // Legacy stored HEIC can't be decoded by the PDF renderer — serve the
  // imgproxy JPEG rendition instead. Everything else passes through raw.
  const extension = getFileExtension(path);
  const heic = extension === "heic" || extension === "heif";

  // Private object paths are prefixed with the owning company's id.
  const companyId = path.split("/")[0];
  if (!companyId) return null;

  const { data } = await storage(client)
    .company(companyId)
    .download(path, heic ? { transform: { quality: 90 } } : undefined);
  if (!data) return null;

  const base64String = Buffer.from(await data.arrayBuffer()).toString("base64");

  const contentType = heic ? "image/jpeg" : getContentType(extension);
  const mimeType = contentType.startsWith("image/") ? contentType : "image/png";

  return `data:${mimeType};base64,${base64String}`;
}

/**
 * Read a sales invoice and everything its PDF and email render. A pure
 * function of its arguments — no request, no app imports — so an Inngest job
 * can call it with a service-role client. Throws when the invoice, company,
 * lines, locations, shipment or terms cannot be read.
 */
export async function loadSalesInvoiceDocument(args: {
  client: Client;
  companyId: string;
  companyGroupId: string;
  invoiceId: string;
  locale: string;
  /** Base for public logo URLs (`SUPABASE_URL`). */
  storageUrl: string;
}): Promise<SalesInvoiceDocument> {
  const { client, companyId, companyGroupId, invoiceId, locale, storageUrl } =
    args;

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
    documentTemplate
  ] = await Promise.all([
    getCompanyWithPublicLogos(client, companyId, storageUrl),
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
      .from("documentTemplate")
      .select("*")
      .eq("companyId", companyId)
      .eq("documentType", "salesInvoice")
      .maybeSingle()
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

  const templateConfig = toDocumentTemplate(
    documentTemplate.data,
    "salesInvoice"
  );

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

  // Resolve against the effective template (default when nothing is stored) so
  // built-in / forked header & footer sections render even before a company
  // saves a custom layout.
  const resolved = resolveTemplate("salesInvoice", templateConfig);
  const sections = await resolveSections(
    client,
    companyId,
    collectSectionIds(resolved)
  );

  // Settlement decimals from the document currency's row (authoritative over
  // CLDR); null keeps the PDF's historical 2dp fallback.
  const currencyRow = salesInvoice.data.currencyCode
    ? await client
        .from("currencies")
        .select("*")
        .eq("code", salesInvoice.data.currencyCode)
        .eq("companyGroupId", companyGroupId)
        .single()
    : null;
  const currencyDecimals = currencyRow?.data?.decimalPlaces ?? null;

  // `company` (table, logos rewritten to public URLs) stands in for the
  // `companies` view row the documents type against, as the routes always did.
  const companyRow = company.data as unknown as SalesInvoicePDFProps["company"];
  const lines = salesInvoiceLines.data ?? [];

  const pdfProps: SalesInvoicePDFProps = {
    company: companyRow,
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
    salesInvoiceLocations: salesInvoiceLocations.data,
    salesInvoiceShipment: salesInvoiceShipment.data,
    accountsReceivableBillingAddress: companySettings.data
      ?.accountsReceivableAddress
      ? arBillingAddress.data
      : null,
    terms: (terms.data?.salesTerms ?? {}) as SalesInvoicePDFProps["terms"],
    paymentTerms: paymentTerms.data ?? [],
    shippingMethods: shippingMethods.data ?? [],
    title: "Sales Invoice",
    thumbnails,
    template: templateConfig,
    sections
  };

  // The view types every column nullable; the table's invoiceId never is.
  const invoiceReadableId = salesInvoice.data.invoiceId ?? invoiceId;

  return {
    pdfProps,
    email: {
      company: companyRow,
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
  const stream = await renderToStream(SalesInvoicePDF(props));

  return new Promise((resolve, reject) => {
    const buffers: Uint8Array[] = [];
    stream.on("data", (data) => {
      buffers.push(data);
    });
    stream.on("end", () => {
      resolve(Buffer.concat(buffers));
    });
    stream.on("error", reject);
  });
}
