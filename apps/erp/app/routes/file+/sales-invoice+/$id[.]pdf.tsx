import { requirePermissions } from "@carbon/auth/auth.server";
import { SalesInvoicePDF } from "@carbon/documents/pdf";
import type { JSONContent } from "@carbon/react";
import { renderToStream } from "@react-pdf/renderer";
import { type LoaderFunctionArgs } from "@vercel/remix";
import { getPaymentTermsList } from "~/modules/accounting";
import { getShippingMethodsList } from "~/modules/inventory";
import {
  getSalesInvoice,
  getSalesInvoiceCustomerDetails,
  getSalesInvoiceLines,
  getSalesInvoiceShipment,
} from "~/modules/invoicing";
import { getSalesTerms } from "~/modules/sales";
import { getCompany } from "~/modules/settings";
import { getBase64ImageFromSupabase } from "~/modules/shared";
import { getLocale } from "~/utils/request";

export const config = { runtime: "nodejs" };

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales",
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [
    company,
    salesInvoice,
    salesInvoiceLines,
    salesInvoiceLocations,
    salesInvoiceShipment,
    terms,
    paymentTerms,
    shippingMethods,
  ] = await Promise.all([
    getCompany(client, companyId),
    getSalesInvoice(client, id),
    getSalesInvoiceLines(client, id),
    getSalesInvoiceCustomerDetails(client, id),
    getSalesInvoiceShipment(client, id),
    getSalesTerms(client, companyId),
    getPaymentTermsList(client, companyId),
    getShippingMethodsList(client, companyId),
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

  const thumbnailPaths = salesInvoiceLines.data?.reduce<
    Record<string, string | null>
  >((acc, line) => {
    if (line.thumbnailPath) {
      acc[line.id!] = line.thumbnailPath;
    }
    return acc;
  }, {});

  const thumbnails: Record<string, string | null> =
    (thumbnailPaths
      ? await Promise.all(
          Object.entries(thumbnailPaths).map(([id, path]) => {
            if (!path) {
              return null;
            }
            return getBase64ImageFromSupabase(client, path).then((data) => ({
              id,
              data,
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

  const locale = getLocale(request);

  const stream = await renderToStream(
    <SalesInvoicePDF
      company={company.data}
      locale={locale}
      meta={{
        author: "Carbon",
        keywords: "sales order",
        subject: "Sales Invoice",
      }}
      salesInvoice={salesInvoice.data}
      salesInvoiceLines={salesInvoiceLines.data ?? []}
      salesInvoiceLocations={salesInvoiceLocations.data}
      salesInvoiceShipment={salesInvoiceShipment.data}
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
    "Content-Disposition": `attachment; filename="${salesInvoice.data.invoiceId}.pdf"`,
  });
  return new Response(body, { status: 200, headers });
}
