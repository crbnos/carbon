import { requirePermissions } from "@carbon/auth/auth.server";
import { SalesOrderPDF } from "@carbon/documents/pdf";
import type { JSONContent } from "@carbon/react";
import { getPreferenceHeaders } from "@carbon/react";
import { renderToStream } from "@react-pdf/renderer";
import type { LoaderFunctionArgs } from "react-router";
import { getPaymentTermsList } from "~/modules/accounting";
import { getShippingMethodsList } from "~/modules/inventory";
import {
  getSalesOrder,
  getSalesOrderCustomerDetails,
  getSalesOrderLines,
  getSalesTerms
} from "~/modules/sales";
import {
  getAccountsReceivableBillingAddress,
  getCompany,
  getCompanySettings
} from "~/modules/settings";
import { getBase64ImageFromSupabase } from "~/modules/shared";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [
    company,
    companySettings,
    arBillingAddress,
    salesOrder,
    salesOrderLines,
    salesOrderLocations,
    terms,
    paymentTerms,
    shippingMethods
  ] = await Promise.all([
    getCompany(),
    getCompanySettings(),
    getAccountsReceivableBillingAddress(),
    getSalesOrder(id),
    getSalesOrderLines(id),
    getSalesOrderCustomerDetails(id),
    getSalesTerms(),
    getPaymentTermsList(),
    getShippingMethodsList()
  ]);

  if (company.error) {
    console.error(company.error);
  }

  if (salesOrder.error) {
    console.error(salesOrder.error);
  }

  if (salesOrderLines.error) {
    console.error(salesOrderLines.error);
  }

  if (salesOrderLocations.error) {
    console.error(salesOrderLocations.error);
  }

  if (terms.error) {
    console.error(terms.error);
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

  const showThumbnails =
    companySettings.data?.includeThumbnailsOnSalesPdfs ?? true;

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
              return getBase64ImageFromSupabase(path).then((data) => ({
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
    <SalesOrderPDF
      company={company.data as any}
      companySettings={companySettings.data}
      locale={locale}
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
