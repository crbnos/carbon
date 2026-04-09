import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { PackingSlipPDF } from "@carbon/documents/pdf";
import type { JSONContent } from "@carbon/react";
import { renderToStream } from "@react-pdf/renderer";
import type { LoaderFunctionArgs } from "react-router";
import { getPaymentTerm } from "~/modules/accounting";
import {
  getShipment,
  getShipmentLinesWithDetails,
  getShipmentTracking,
  getShippingMethod
} from "~/modules/inventory";
import {
  getPurchaseOrder,
  getPurchaseOrderDelivery,
  getSupplierLocation
} from "~/modules/purchasing";
import {
  getCustomerLocation,
  getSalesOrder,
  getSalesOrderShipment,
  getSalesTerms
} from "~/modules/sales";
import { getCompany, getCompanySettings } from "~/modules/settings";
import { getBase64ImageFromSupabase } from "~/modules/shared";
import { getLocale } from "~/utils/request";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [company, companySettings, shipment, shipmentLines] = await Promise.all(
    [
      getCompany(client, companyId),
      getCompanySettings(client, companyId),
      getShipment(client, id),
      getShipmentLinesWithDetails(client, id)
    ]
  );

  if (company.error) {
    console.error(company.error);
  }

  if (shipment.error) {
    console.error(shipment.error);
  }

  if (shipmentLines.error) {
    console.error(shipmentLines.error);
  }

  const serviceRole = getCarbonServiceRole();
  const terms = await getSalesTerms(serviceRole, companyId);

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
    case "Sales Order": {
      const [salesOrder, salesOrderShipment] = await Promise.all([
        getSalesOrder(serviceRole, shipment.data.sourceDocumentId),
        getSalesOrderShipment(serviceRole, shipment.data.sourceDocumentId)
      ]);

      const [
        customer,
        customerLocation,
        paymentTerm,
        shippingMethod,
        shipmentTracking
      ] = await Promise.all([
        serviceRole
          .from("customer")
          .select("*")
          .eq("id", salesOrder.data?.customerId ?? "")
          .single(),
        getCustomerLocation(
          serviceRole,
          salesOrder.data?.customerLocationId ?? ""
        ),
        getPaymentTerm(serviceRole, salesOrder.data?.paymentTermId ?? ""),
        getShippingMethod(
          serviceRole,
          shipment.data.shippingMethodId ??
            salesOrderShipment.data?.shippingMethodId ??
            ""
        ),
        getShipmentTracking(serviceRole, shipment.data.id, companyId)
      ]);

      if (customer.error) {
        console.error(customer.error);
        throw new Error("Failed to load customer");
      }

      let thumbnails: Record<string, string | null> = {};

      if (companySettings.data?.includeThumbnailsOnSalesPdfs ?? true) {
        const thumbnailPaths = shipmentLines.data?.reduce<
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
                  return getBase64ImageFromSupabase(serviceRole, path).then(
                    (data) => ({
                      id,
                      data
                    })
                  );
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

      const stream = await renderToStream(
        <PackingSlipPDF
          company={company.data as any}
          customer={customer.data}
          locale={locale}
          meta={{
            author: "Carbon",
            keywords: "packing slip",
            subject: "Packing Slip"
          }}
          customerReference={salesOrder.data?.customerReference ?? undefined}
          sourceDocument="Sales Order"
          sourceDocumentId={salesOrder.data?.salesOrderId ?? undefined}
          shipment={shipment.data}
          shipmentLines={shipmentLines.data ?? []}
          // @ts-expect-error
          shippingAddress={customerLocation.data?.address ?? null}
          terms={(terms?.data?.salesTerms ?? {}) as JSONContent}
          paymentTerm={paymentTerm.data ?? { id: "", name: "" }}
          shippingMethod={shippingMethod.data ?? { id: "", name: "" }}
          trackedEntities={shipmentTracking.data ?? []}
          title="Packing Slip"
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
        "Content-Disposition": `inline; filename="${company.data.name} - ${shipment.data.shipmentId}.pdf"`
      });
      return new Response(new Uint8Array(body), { status: 200, headers });
    }
    case "Sales Invoice": {
      const salesInvoice = await serviceRole
        .from("salesInvoice")
        .select("*, salesInvoiceShipment(*)")
        .eq("id", shipment.data.sourceDocumentId ?? "")
        .single();

      if (salesInvoice.error) {
        console.error(salesInvoice.error);
        throw new Error("Failed to load sales invoice");
      }

      const [
        customer,
        customerLocation,
        paymentTerm,
        shippingMethod,
        shipmentTracking
      ] = await Promise.all([
        serviceRole
          .from("customer")
          .select("*")
          .eq("id", salesInvoice.data?.customerId ?? "")
          .single(),
        getCustomerLocation(serviceRole, salesInvoice.data?.locationId ?? ""),
        getPaymentTerm(serviceRole, salesInvoice.data?.paymentTermId ?? ""),
        getShippingMethod(
          serviceRole,
          shipment.data.shippingMethodId ??
            salesInvoice.data?.salesInvoiceShipment?.shippingMethodId ??
            ""
        ),
        getShipmentTracking(serviceRole, shipment.data.id, companyId)
      ]);

      if (customer.error) {
        console.error(customer.error);
        throw new Error("Failed to load customer");
      }

      let thumbnails: Record<string, string | null> = {};

      if (companySettings.data?.includeThumbnailsOnSalesPdfs ?? true) {
        const thumbnailPaths = shipmentLines.data?.reduce<
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
                  return getBase64ImageFromSupabase(serviceRole, path).then(
                    (data) => ({
                      id,
                      data
                    })
                  );
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

      const stream = await renderToStream(
        <PackingSlipPDF
          company={company.data as any}
          customer={customer.data}
          locale={locale}
          meta={{
            author: "Carbon",
            keywords: "packing slip",
            subject: "Packing Slip"
          }}
          customerReference={salesInvoice.data?.customerReference ?? undefined}
          sourceDocument="Sales Invoice"
          sourceDocumentId={salesInvoice.data?.invoiceId ?? undefined}
          shipment={shipment.data}
          shipmentLines={shipmentLines.data ?? []}
          // @ts-expect-error
          shippingAddress={customerLocation.data?.address ?? null}
          terms={(terms?.data?.salesTerms ?? {}) as JSONContent}
          paymentTerm={paymentTerm.data ?? { id: "", name: "" }}
          shippingMethod={shippingMethod.data ?? { id: "", name: "" }}
          trackedEntities={shipmentTracking.data ?? []}
          title="Packing Slip"
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
        "Content-Disposition": `inline; filename="${company.data.name} - ${shipment.data.shipmentId}.pdf"`
      });
      return new Response(new Uint8Array(body), { status: 200, headers });
    }
    case "Purchase Order": {
      const [purchaseOrder, purchaseOrderDelivery] = await Promise.all([
        getPurchaseOrder(client, shipment.data.sourceDocumentId),
        getPurchaseOrderDelivery(client, shipment.data.sourceDocumentId)
      ]);

      const [
        supplier,
        supplierLocation,
        poPaymentTerm,
        poShippingMethod,
        poShipmentTracking
      ] = await Promise.all([
        client
          .from("supplier")
          .select("*")
          .eq("id", purchaseOrder.data?.supplierId ?? "")
          .single(),
        getSupplierLocation(
          client,
          purchaseOrder.data?.supplierLocationId ?? ""
        ),
        getPaymentTerm(client, purchaseOrder.data?.paymentTermId ?? ""),
        getShippingMethod(
          client,
          purchaseOrderDelivery.data?.shippingMethodId ?? ""
        ),
        getShipmentTracking(client, shipment.data.id, companyId)
      ]);

      if (supplier.error) {
        console.error(supplier.error);
        throw new Error("Failed to load supplier");
      }

      let poThumbnails: Record<string, string | null> = {};

      if (companySettings.data?.includeThumbnailsOnPurchasingPdfs ?? true) {
        const poThumbnailPaths = shipmentLines.data?.reduce<
          Record<string, string | null>
        >((acc, line) => {
          if (line.thumbnailPath) {
            acc[line.id!] = line.thumbnailPath;
          }
          return acc;
        }, {});

        poThumbnails =
          (poThumbnailPaths
            ? await Promise.all(
                Object.entries(poThumbnailPaths).map(([id, path]) => {
                  if (!path) {
                    return null;
                  }
                  return getBase64ImageFromSupabase(client, path).then(
                    (data) => ({
                      id,
                      data
                    })
                  );
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

      const poStream = await renderToStream(
        <PackingSlipPDF
          company={company.data as any}
          customer={supplier.data}
          locale={locale}
          meta={{
            author: "Carbon",
            keywords: "packing slip",
            subject: "Packing Slip"
          }}
          customerReference={purchaseOrder.data?.supplierReference ?? undefined}
          sourceDocument="Purchase Order"
          sourceDocumentId={purchaseOrder.data?.purchaseOrderId ?? undefined}
          shipment={shipment.data}
          shipmentLines={shipmentLines.data ?? []}
          // @ts-expect-error
          shippingAddress={supplierLocation.data?.address ?? null}
          terms={(terms?.data?.salesTerms ?? {}) as JSONContent}
          paymentTerm={poPaymentTerm.data ?? { id: "", name: "" }}
          shippingMethod={poShippingMethod.data ?? { id: "", name: "" }}
          trackedEntities={poShipmentTracking.data ?? []}
          title="Packing Slip"
          thumbnails={poThumbnails}
        />
      );

      const poBody: Buffer = await new Promise((resolve, reject) => {
        const buffers: Uint8Array[] = [];
        poStream.on("data", (data) => {
          buffers.push(data);
        });
        poStream.on("end", () => {
          resolve(Buffer.concat(buffers));
        });
        poStream.on("error", reject);
      });

      const poHeaders = new Headers({
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${company.data.name} - ${shipment.data.shipmentId}.pdf"`
      });
      return new Response(new Uint8Array(poBody), {
        status: 200,
        headers: poHeaders
      });
    }
    default:
      throw new Error("Invalid source document");
  }
}
