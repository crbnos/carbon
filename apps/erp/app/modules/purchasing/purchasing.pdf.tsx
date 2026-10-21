// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import {
  ensureFont,
  getPurchaseOrderDisplayId,
  PurchaseOrderPDF,
  PurchaseReturnOrderPDF
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
import { getLocation } from "~/modules/resources/resources.service";
import {
  getAccountsPayableBillingAddress,
  getCompany,
  getCompanySettings,
  getDocumentTemplate,
  resolveSections
} from "~/modules/settings/settings.service";
import { getBase64ImageFromSupabase } from "~/modules/shared/shared.service";
import {
  getPurchaseOrder,
  getPurchaseOrderLines,
  getPurchaseOrderLocations,
  getPurchaseReturnOrder,
  getPurchaseReturnOrderLines,
  getPurchasingTerms,
  getSupplier,
  getSupplierLocation,
  getSupplierLocations
} from "./purchasing.service";

/**
 * The purchasing PDFs, rendered with a client rather than a request, so a
 * route serving the file and an operation attaching it (finalize, approve,
 * confirm) render the same document. Each throws when its records cannot be
 * read.
 */

const logger = getLogger("erp", "purchasing", "pdf");

type Rendered = { body: Buffer; fileName: string };

function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
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

/** A purchase order's PDF, as the supplier receives it. */
export async function renderPurchaseOrderPdf(
  client: SupabaseClient<Database>,
  {
    companyId,
    companyGroupId,
    purchaseOrderId,
    locale
  }: {
    companyId: string;
    companyGroupId: string;
    purchaseOrderId: string;
    locale: string;
  }
): Promise<Rendered> {
  const [
    company,
    companySettings,
    apBillingAddress,
    purchaseOrder,
    purchaseOrderLines,
    purchaseOrderLocations,
    terms,
    paymentTerms,
    documentTemplate
  ] = await Promise.all([
    getCompany(client, companyId),
    getCompanySettings(client, companyId),
    getAccountsPayableBillingAddress(client, companyId),
    getPurchaseOrder(client, purchaseOrderId),
    getPurchaseOrderLines(client, purchaseOrderId),
    getPurchaseOrderLocations(client, purchaseOrderId),
    getPurchasingTerms(client, companyId),
    getPaymentTermsList(client, companyId),
    getDocumentTemplate(client, companyId, "purchaseOrder")
  ]);

  if (company.error) {
    logger.error("Failed to load company", { error: company.error });
  }

  if (purchaseOrder.error) {
    logger.error("Failed to load purchaseOrder", {
      error: purchaseOrder.error
    });
  }

  if (purchaseOrderLines.error) {
    logger.error("Failed to load purchaseOrderLines", {
      error: purchaseOrderLines.error
    });
  }

  if (purchaseOrderLocations.error) {
    logger.error("Failed to load purchaseOrderLocations", {
      error: purchaseOrderLocations.error
    });
  }

  if (terms.error) {
    logger.error("Failed to load terms", { error: terms.error });
  }

  if (
    company.error ||
    purchaseOrder.error ||
    purchaseOrderLines.error ||
    purchaseOrderLocations.error ||
    terms.error
  ) {
    throw new Error("Failed to load purchase order");
  }

  const templateConfig = toDocumentTemplate(
    documentTemplate.data,
    "purchaseOrder"
  );
  const showThumbnails = templateShowsThumbnails(
    templateConfig,
    "purchaseOrder"
  );

  let thumbnails: Record<string, string | null> = {};

  if (showThumbnails) {
    const thumbnailPaths = purchaseOrderLines.data?.reduce<
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

  const resolved = resolveTemplate("purchaseOrder", templateConfig);
  const sections = await resolveSections(
    client,
    companyId,
    collectSectionIds(resolved)
  );
  await ensureFont(resolved.settings.fontFamily);

  // Settlement decimals from the document currency's row (authoritative over
  // CLDR); null keeps the PDF's historical 2dp fallback.
  const currencyRow = purchaseOrder.data?.currencyCode
    ? await getCurrencyByCode(
        client,
        companyGroupId,
        purchaseOrder.data.currencyCode
      )
    : null;
  const currencyDecimals = currencyRow?.data?.decimalPlaces ?? null;

  const body = await collect(
    await renderToStream(
      <PurchaseOrderPDF
        company={company.data as any}
        companySettings={companySettings.data}
        accountsPayableBillingAddress={
          companySettings.data?.accountsPayableAddress
            ? apBillingAddress.data
            : null
        }
        locale={locale}
        currencyDecimals={currencyDecimals}
        paymentTerms={paymentTerms.data ?? []}
        purchaseOrder={purchaseOrder.data}
        purchaseOrderLines={purchaseOrderLines.data ?? []}
        purchaseOrderLocations={purchaseOrderLocations.data}
        terms={(terms?.data?.purchasingTerms || {}) as JSONContent}
        thumbnails={thumbnails}
        template={templateConfig}
        sections={sections}
      />
    )
  );

  return {
    body,
    fileName: `${company.data.name} - ${getPurchaseOrderDisplayId(purchaseOrder.data)}.pdf`
  };
}

/** A purchase return order's PDF ("Return to Supplier"). */
export async function renderPurchaseReturnOrderPdf(
  client: SupabaseClient<Database>,
  {
    companyId,
    companyGroupId,
    purchaseReturnOrderId,
    locale
  }: {
    companyId: string;
    companyGroupId: string;
    purchaseReturnOrderId: string;
    locale: string;
  }
): Promise<Rendered> {
  const [
    company,
    companySettings,
    purchaseReturnOrder,
    purchaseReturnOrderLines,
    terms,
    documentTemplate
  ] = await Promise.all([
    getCompany(client, companyId),
    getCompanySettings(client, companyId),
    getPurchaseReturnOrder(client, purchaseReturnOrderId),
    getPurchaseReturnOrderLines(client, purchaseReturnOrderId, companyId),
    getPurchasingTerms(client, companyId),
    getDocumentTemplate(client, companyId, "purchaseReturnOrder")
  ]);

  if (company.error) {
    logger.error("Failed to load company", { error: company.error });
  }

  if (purchaseReturnOrder.error) {
    logger.error("Failed to load purchaseReturnOrder", {
      error: purchaseReturnOrder.error
    });
  }

  if (purchaseReturnOrderLines.error) {
    logger.error("Failed to load purchaseReturnOrderLines", {
      error: purchaseReturnOrderLines.error
    });
  }

  if (terms.error) {
    logger.error("Failed to load terms", { error: terms.error });
  }

  if (
    company.error ||
    purchaseReturnOrder.error ||
    purchaseReturnOrderLines.error ||
    terms.error
  ) {
    throw new Error("Failed to load purchase return order");
  }

  // Party addresses hang off the header row, so they resolve in a second pass.
  const [location, supplier, supplierLocation, currencyRow] = await Promise.all(
    [
      purchaseReturnOrder.data.locationId
        ? getLocation(client, purchaseReturnOrder.data.locationId)
        : null,
      purchaseReturnOrder.data.supplierId
        ? getSupplier(client, purchaseReturnOrder.data.supplierId)
        : null,
      // The header's location when set; otherwise fall back to the supplier's
      // own location(s) — without this the SUPPLIER box prints a bare name
      // with no address whenever no default location is configured.
      purchaseReturnOrder.data.supplierLocationId
        ? getSupplierLocation(
            client,
            purchaseReturnOrder.data.supplierLocationId
          )
        : purchaseReturnOrder.data.supplierId
          ? getSupplierLocations(client, purchaseReturnOrder.data.supplierId)
          : null,
      purchaseReturnOrder.data.currencyCode
        ? getCurrencyByCode(
            client,
            companyGroupId,
            purchaseReturnOrder.data.currencyCode
          )
        : null
    ]
  );

  const shipFromAddress = location?.data
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

  // `getSupplierLocation` returns one row; the `getSupplierLocations` fallback
  // returns an array — normalize to a single row before reading the address.
  const supplierLocationRow = Array.isArray(supplierLocation?.data)
    ? supplierLocation.data[0]
    : supplierLocation?.data;
  const supplierAddr = supplierLocationRow?.address;

  const supplierAddress = supplier?.data
    ? {
        name: supplier.data.name,
        addressLine1: supplierAddr?.addressLine1,
        addressLine2: supplierAddr?.addressLine2,
        city: supplierAddr?.city,
        stateProvince: supplierAddr?.stateProvince,
        postalCode: supplierAddr?.postalCode,
        country: supplierAddr?.country?.name ?? null
      }
    : null;

  const templateConfig = toDocumentTemplate(
    documentTemplate.data,
    "purchaseReturnOrder"
  );
  const resolved = resolveTemplate("purchaseReturnOrder", templateConfig);
  const sections = await resolveSections(
    client,
    companyId,
    collectSectionIds(resolved)
  );
  await ensureFont(resolved.settings.fontFamily);

  // Settlement decimals from the document currency's row (authoritative over
  // CLDR); null keeps the PDF's historical 2dp fallback.
  const currencyDecimals = currencyRow?.data?.decimalPlaces ?? null;

  const body = await collect(
    await renderToStream(
      <PurchaseReturnOrderPDF
        company={company.data as any}
        companySettings={companySettings.data}
        locale={locale}
        currencyDecimals={currencyDecimals}
        meta={{
          author: "Carbon",
          keywords: "supplier return, purchase return order",
          subject: "Return to Supplier"
        }}
        purchaseReturnOrder={purchaseReturnOrder.data}
        purchaseReturnOrderLines={purchaseReturnOrderLines.data ?? []}
        shipFromAddress={shipFromAddress}
        supplierAddress={supplierAddress}
        terms={(terms?.data?.purchasingTerms ?? {}) as JSONContent}
        title="Return to Supplier"
        template={templateConfig}
        sections={sections}
      />
    )
  );

  return {
    body,
    fileName: `${company.data.name} - ${purchaseReturnOrder.data.purchaseReturnOrderId}.pdf`
  };
}
