import { requirePermissions } from "@carbon/auth/auth.server";
import { PackingSlipPDF } from "@carbon/documents/pdf";
import type { JSONContent } from "@carbon/react";
import { renderToStream } from "@react-pdf/renderer";
import { type LoaderFunctionArgs } from "@vercel/remix";
import { getPaymentTerm } from "~/modules/accounting";
import {
  getShipment,
  getShipmentLinesWithDetails,
  getShipmentTracking,
  getShippingMethod,
} from "~/modules/inventory";
import {
  getCustomerLocation,
  getSalesOrder,
  getSalesOrderShipment,
  getSalesTerms,
} from "~/modules/sales";
import { getCompany } from "~/modules/settings";
import { getLocale } from "~/utils/request";

export const config = { runtime: "nodejs" };

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory",
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [company, shipment, shipmentLines, terms] = await Promise.all([
    getCompany(client, companyId),
    getShipment(client, id),
    getShipmentLinesWithDetails(client, id),
    getSalesTerms(client, companyId),
  ]);

  if (company.error) {
    console.error(company.error);
  }

  if (shipment.error) {
    console.error(shipment.error);
  }

  if (shipmentLines.error) {
    console.error(shipmentLines.error);
  }

  if (terms.error) {
    console.error(terms.error);
  }

  if (
    company.error ||
    shipment.error ||
    shipmentLines.error ||
    terms.error ||
    shipment.data.sourceDocumentId === null
  ) {
    throw new Error("Failed to load sales order");
  }

  const locale = getLocale(request);

  switch (shipment.data.sourceDocument) {
    case "Sales Order":
      const [salesOrder, salesOrderShipment] = await Promise.all([
        getSalesOrder(client, shipment.data.sourceDocumentId),
        getSalesOrderShipment(client, shipment.data.sourceDocumentId),
      ]);

      const [customer, customerLocation, paymentTerm, shippingMethod, shipmentTracking] =
        await Promise.all([
          client
            .from("customer")
            .select("*")
            .eq("id", salesOrder.data?.customerId ?? "")
            .single(),
          getCustomerLocation(client, salesOrder.data?.locationId ?? ""),
          getPaymentTerm(client, salesOrder.data?.paymentTermId ?? ""),
          getShippingMethod(
            client,
            salesOrderShipment.data?.shippingMethodId ?? ""
          ),
          getShipmentTracking(client, shipment.data.id, companyId),
        ]);

      if (customer.error) {
        console.error(customer.error);
        throw new Error("Failed to load customer");
      }

      const stream = await renderToStream(
        <PackingSlipPDF
          company={company.data}
          customer={customer.data}
          locale={locale}
          meta={{
            author: "CarbonOS",
            keywords: "packing slip",
            subject: "Packing Slip",
          }}
          purchaseOrder={salesOrder.data?.customerReference ?? undefined}
          salesOrder={salesOrder.data?.salesOrderId ?? undefined}
          shipment={shipment.data}
          shipmentLines={shipmentLines.data ?? []}
          // @ts-ignore
          shippingAddress={customerLocation.data?.address}
          terms={(terms?.data?.salesTerms ?? {}) as JSONContent}
          paymentTerm={paymentTerm.data ?? { id: "", name: "" }}
          shippingMethod={shippingMethod.data ?? { id: "", name: "" }}
          trackedEntities={shipmentTracking.data ?? []}
          title="Packing Slip"
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

    default:
      throw new Error("Invalid source document");
  }
}
