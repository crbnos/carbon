import { requirePermissions } from "@carbon/auth/auth.server";
import { PurchaseOrderPDF } from "@carbon/documents/pdf";
import type { JSONContent } from "@carbon/react";
import { getPreferenceHeaders } from "@carbon/remix";
import { renderToStream } from "@react-pdf/renderer";
import type { LoaderFunctionArgs } from "react-router";
import { getPaymentTermsList } from "~/modules/accounting";
import {
  getPurchaseOrder,
  getPurchaseOrderLines,
  getPurchaseOrderLocations,
  getPurchasingTerms
} from "~/modules/purchasing";
import {
  getAccountsPayableBillingAddress,
  getCompany,
  getCompanySettings
} from "~/modules/settings";
import { getBase64ImageFromSupabase } from "~/modules/shared";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "purchasing"
  });

  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  const [
    company,
    companySettings,
    apBillingAddress,
    purchaseOrder,
    purchaseOrderLines,
    purchaseOrderLocations,
    terms,
    paymentTerms
  ] = await Promise.all([
    getCompany(client, companyId),
    getCompanySettings(client, companyId),
    getAccountsPayableBillingAddress(client, companyId),
    getPurchaseOrder(client, orderId),
    getPurchaseOrderLines(client, orderId),
    getPurchaseOrderLocations(client, orderId),
    getPurchasingTerms(client, companyId),
    getPaymentTermsList(client, companyId)
  ]);

  if (company.error) {
    console.error(company.error);
  }

  if (purchaseOrder.error) {
    console.error(purchaseOrder.error);
  }

  if (purchaseOrderLines.error) {
    console.error(purchaseOrderLines.error);
  }

  if (purchaseOrderLocations.error) {
    console.error(purchaseOrderLocations.error);
  }

  if (terms.error) {
    console.error(terms.error);
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

  const showThumbnails =
    companySettings.data?.includeThumbnailsOnPurchasingPdfs ?? true;

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

  const { locale } = getPreferenceHeaders(request);

  const stream = await renderToStream(
    <PurchaseOrderPDF
      company={company.data as any}
      companySettings={companySettings.data}
      accountsPayableBillingAddress={
        companySettings.data?.accountsPayableAddress
          ? apBillingAddress.data
          : null
      }
      locale={locale}
      paymentTerms={paymentTerms.data ?? []}
      purchaseOrder={purchaseOrder.data}
      purchaseOrderLines={purchaseOrderLines.data ?? []}
      purchaseOrderLocations={purchaseOrderLocations.data}
      terms={(terms?.data?.purchasingTerms || {}) as JSONContent}
      thumbnails={thumbnails}
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
    "Content-Disposition": `inline; filename="${company.data.name} - ${purchaseOrder.data.purchaseOrderId}.pdf"`
  });
  return new Response(new Uint8Array(body), { status: 200, headers });
}
