import { requirePermissions } from "@carbon/auth/auth.server";
import { PurchaseOrderPDF } from "@carbon/documents/pdf";
import type { JSONContent } from "@carbon/react";
import { renderToStream } from "@react-pdf/renderer";
import { type LoaderFunctionArgs } from "@vercel/remix";
import {
  getPurchaseOrder,
  getPurchaseOrderLines,
  getPurchaseOrderLocations,
  getPurchasingTerms,
} from "~/modules/purchasing";
import { getCompany } from "~/modules/settings";
import { getLocale } from "~/utils/request";

export const config = { runtime: "nodejs" };

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "purchasing",
  });

  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  const [
    company,
    purchaseOrder,
    purchaseOrderLines,
    purchaseOrderLocations,
    terms,
  ] = await Promise.all([
    getCompany(client, companyId),
    getPurchaseOrder(client, orderId),
    getPurchaseOrderLines(client, orderId),
    getPurchaseOrderLocations(client, orderId),
    getPurchasingTerms(client, companyId),
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

  const locale = getLocale(request);

  const stream = await renderToStream(
    <PurchaseOrderPDF
      company={company.data}
      locale={locale}
      purchaseOrder={purchaseOrder.data}
      purchaseOrderLines={purchaseOrderLines.data ?? []}
      purchaseOrderLocations={purchaseOrderLocations.data}
      terms={(terms?.data?.purchasingTerms || {}) as JSONContent}
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
    "Content-Disposition": `attachment; filename="${purchaseOrder.data.purchaseOrderId}.pdf"`,
  });
  return new Response(body, { status: 200, headers });
}
