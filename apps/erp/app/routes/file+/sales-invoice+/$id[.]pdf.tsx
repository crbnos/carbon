import { requirePermissions } from "@carbon/auth/auth.server";
import { SalesInvoicePDF } from "@carbon/documents/pdf";
import type { JSONContent } from "@carbon/react";
import { getPreferenceHeaders } from "@carbon/remix";
import { renderToStream } from "@react-pdf/renderer";
import type { LoaderFunctionArgs } from "react-router";
import { getPaymentTermsList } from "~/modules/accounting";
import { getShippingMethodsList } from "~/modules/inventory";
import {
  getSalesInvoice,
  getSalesInvoiceCustomerDetails,
  getSalesInvoiceLines,
  getSalesInvoiceShipment
} from "~/modules/invoicing";
import { getSalesTerms } from "~/modules/sales";
import {
  getAccountsReceivableBillingAddress,
  getCompany,
  getCompanySettings
} from "~/modules/settings";
import { getBase64ImageFromSupabase } from "~/modules/shared";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

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
    shippingMethods
  ] = await Promise.all([
    getCompany(client, companyId),
    getCompanySettings(client, companyId),
    getAccountsReceivableBillingAddress(client, companyId),
    getSalesInvoice(client, id),
    getSalesInvoiceLines(client, id),
    getSalesInvoiceCustomerDetails(client, id),
    getSalesInvoiceShipment(client, id),
    getSalesTerms(client, companyId),
    getPaymentTermsList(client, companyId),
    getShippingMethodsList(client, companyId)
  ]);

  if (company.error) {
    console.error(company.error);
  }

  if (salesInvoice.error) {
    console.error(salesInvoice.error);
  }

  if (salesInvoiceLines.error) {
    console.error(salesInvoiceLines.error);
  }

  if (salesInvoiceShipment.error) {
    console.error(salesInvoiceShipment.error);
  }

  if (salesInvoiceLocations.error) {
    console.error(salesInvoiceLocations.error);
  }

  if (terms.error) {
    console.error(terms.error);
  }

  if (
    company.error ||
    salesInvoice.error ||
    salesInvoiceLines.error ||
    salesInvoiceLocations.error ||
    salesInvoiceShipment.error ||
    terms.error
  ) {
    throw new Error("Failed to load sales order");
  }

  const showThumbnails =
    companySettings.data?.includeThumbnailsOnSalesPdfs ?? true;

  let thumbnails: Record<string, string | null> = {};

  if (showThumbnails) {
    const thumbnailPaths = salesInvoiceLines.data?.reduce<
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
    <SalesInvoicePDF
      company={company.data as any}
      companySettings={companySettings.data}
      locale={locale}
      meta={{
        author: "Carbon",
        keywords: "sales order",
        subject: "Sales Invoice"
      }}
      salesInvoice={salesInvoice.data}
      salesInvoiceLines={salesInvoiceLines.data ?? []}
      salesInvoiceLocations={salesInvoiceLocations.data}
      salesInvoiceShipment={salesInvoiceShipment.data}
      accountsReceivableBillingAddress={
        companySettings.data?.accountsReceivableAddress
          ? arBillingAddress.data
          : null
      }
      terms={(terms?.data?.salesTerms ?? {}) as JSONContent}
      paymentTerms={paymentTerms.data ?? []}
      shippingMethods={shippingMethods.data ?? []}
      title="Sales Invoice"
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
    "Content-Disposition": `inline; filename="${company.data.name} - ${salesInvoice.data.invoiceId}.pdf"`
  });
  return new Response(new Uint8Array(body), { status: 200, headers });
}
