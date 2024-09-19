import { SalesOrderPDF } from "@carbon/documents";
import type { JSONContent } from "@carbon/react";
import { renderToStream } from "@react-pdf/renderer";
import { type LoaderFunctionArgs } from "@vercel/remix";
import logger from "~/lib/logger";
import {
  getSalesOrder,
  getSalesOrderCustomerDetails,
  getSalesOrderLines,
  getSalesTerms,
} from "~/modules/sales";
import { getCompany } from "~/modules/settings";
import { requirePermissions } from "~/services/auth/auth.server";

export const config = { runtime: "nodejs" };

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales",
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [company, salesOrder, salesOrderLines, salesOrderLocations, terms] =
    await Promise.all([
      getCompany(client, companyId),
      getSalesOrder(client, id),
      getSalesOrderLines(client, id),
      getSalesOrderCustomerDetails(client, id),
      getSalesTerms(client, companyId),
    ]);

  if (company.error) {
    logger.error(company.error);
  }

  if (salesOrder.error) {
    logger.error(salesOrder.error);
  }

  if (salesOrderLines.error) {
    logger.error(salesOrderLines.error);
  }

  if (salesOrderLocations.error) {
    logger.error(salesOrderLocations.error);
  }

  if (terms.error) {
    logger.error(terms.error);
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

  const stream = await renderToStream(
    <SalesOrderPDF
      company={company.data}
      meta={{
        author: "CarbonOS",
        keywords: "sales order",
        subject: "Sales Order",
      }}
      salesOrder={salesOrder.data}
      salesOrderLines={salesOrderLines.data ?? []}
      salesOrderLocations={salesOrderLocations.data}
      terms={(terms?.data?.salesTerms ?? {}) as JSONContent}
      title="Sales Order"
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

  const headers = new Headers({ "Content-Type": "application/pdf" });
  return new Response(body, { status: 200, headers });
}
