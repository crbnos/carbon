import { requirePermissions } from "@carbon/auth/auth.server";
import { ensureFont, PurchaseReturnOrderPDF } from "@carbon/documents/pdf";
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
import {
  getPurchaseReturnOrder,
  getPurchaseReturnOrderLines,
  getPurchasingTerms,
  getSupplier,
  getSupplierLocation
} from "~/modules/purchasing";
import { getLocation } from "~/modules/resources";
import {
  getCompany,
  getCompanySettings,
  getDocumentTemplate,
  resolveSections
} from "~/modules/settings";

const logger = getLogger("erp", "purchase-return-order", "pdf");

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, companyGroupId } = await requirePermissions(
    request,
    {
      view: "purchasing"
    }
  );

  const { id } = params;
  if (!id) throw new Error("Could not find id");

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
    getPurchaseReturnOrder(client, id),
    getPurchaseReturnOrderLines(client, id, companyId),
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
      purchaseReturnOrder.data.supplierLocationId
        ? getSupplierLocation(
            client,
            purchaseReturnOrder.data.supplierLocationId
          )
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

  const supplierAddress = supplier?.data
    ? {
        name: supplier.data.name,
        addressLine1: supplierLocation?.data?.address?.addressLine1,
        addressLine2: supplierLocation?.data?.address?.addressLine2,
        city: supplierLocation?.data?.address?.city,
        stateProvince: supplierLocation?.data?.address?.stateProvince,
        postalCode: supplierLocation?.data?.address?.postalCode,
        country: supplierLocation?.data?.address?.country?.name ?? null
      }
    : null;

  const { locale } = getPreferenceHeaders(request);

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

  const stream = await renderToStream(
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
    "Content-Disposition": `inline; filename="${company.data.name} - ${purchaseReturnOrder.data.purchaseReturnOrderId}.pdf"`
  });
  return new Response(new Uint8Array(body), { status: 200, headers });
}
