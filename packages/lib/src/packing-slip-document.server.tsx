// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { ensureFont, PackingSlipPDF } from "@carbon/documents/pdf";
import {
  collectSectionIds,
  type DocumentEdit,
  templateShowsThumbnails
} from "@carbon/documents/template";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DocumentNotFoundError,
  getBase64Image,
  getCompany,
  renderPdfToBuffer,
  resolveSections,
  withPdfLogos
} from "./document-data.server";
import { getPrintedTemplate } from "./document-edit.server";

const logger = getLogger("lib", "packing-slip-document");

type Client = SupabaseClient<Database>;

export type PackingSlipPDFProps = Parameters<typeof PackingSlipPDF>[0];
export { DocumentNotFoundError } from "./document-data.server";

/**
 * Everything needed to render a shipment's packing slip (a rental's delivery
 * ticket, a contract's receiving report), read once. Shared by the ERP's PDF
 * routes and the print job, so both render the same document.
 */
export type PackingSlipDocument = {
  pdfProps: PackingSlipPDFProps;
  shipmentReadableId: string;
  fileName: string;
};

/** The part of the slip that depends on the shipment's source document. */
type SourceProps = Pick<
  PackingSlipPDFProps,
  | "customer"
  | "customerReference"
  | "sourceDocument"
  | "sourceDocumentId"
  | "shippingAddress"
  | "paymentTerm"
  | "shippingMethod"
  | "trackedEntities"
  | "rentalUnits"
  | "documentType"
  | "meta"
>;

type Shipment = Database["public"]["Tables"]["shipment"]["Row"];

const NO_TERM = { id: "", name: "" };
const PACKING_SLIP_META = {
  author: "Carbon",
  keywords: "packing slip",
  subject: "Packing Slip"
};

function must<R extends { data: unknown; error: unknown }>(
  result: R,
  what: string
): NonNullable<R["data"]> {
  if (result.error || result.data == null) {
    logger.error("Failed to load {what}", { what, error: result.error });
    throw new Error(`Failed to load ${what}`);
  }
  return result.data as NonNullable<R["data"]>;
}

const address = (value: unknown) =>
  (value ?? null) as PackingSlipPDFProps["shippingAddress"];

/**
 * Read a shipment and everything its packing slip renders. `client` reads the
 * company, shipment and template; the source document's customer, terms and
 * tracking are read with `serviceRole`, pinned to `companyId`. Throws when a
 * required read fails.
 */
export async function loadPackingSlipDocument(args: {
  client: Client;
  serviceRole: Client;
  companyId: string;
  shipmentId: string;
  locale: string;
  /** Draft edits to preview; omitted, the saved ones are read. */
  edit?: DocumentEdit | null;
}): Promise<PackingSlipDocument> {
  const { client, serviceRole, companyId, shipmentId, locale } = args;

  const [companyResult, shipmentResult, linesResult, termsResult, template] =
    await Promise.all([
      getCompany(client, companyId),
      // RLS admits a shipment from any company the user belongs to, but the
      // source document is read with the service role: pin it to this company.
      client
        .from("shipment")
        .select("*")
        .eq("id", shipmentId)
        .eq("companyId", companyId)
        .single(),
      client.from("shipmentLines").select("*").eq("shipmentId", shipmentId),
      serviceRole
        .from("terms")
        .select("salesTerms")
        .eq("id", companyId)
        .single(),
      getPrintedTemplate(
        client,
        { companyId, documentType: "packingSlip", documentId: shipmentId },
        args.edit
      )
    ]);

  // No row: the shipment is gone or belongs to another company.
  if (shipmentResult.error?.code === "PGRST116") {
    throw new DocumentNotFoundError(`Shipment ${shipmentId} not found`);
  }
  const shipment = must(shipmentResult, "shipment");
  const company = must(companyResult, "company");
  const shipmentLines = must(linesResult, "shipment lines");
  const terms = must(termsResult, "terms");
  if (!shipment.sourceDocumentId) {
    throw new Error("Shipment has no source document");
  }

  const thumbnailClient = templateShowsThumbnails(template, "packingSlip")
    ? thumbnailClientFor(shipment, client, serviceRole)
    : null;
  const [sections, source, thumbnails] = await Promise.all([
    resolveSections(client, companyId, collectSectionIds(template)),
    loadSource(client, serviceRole, companyId, shipment),
    thumbnailClient ? loadThumbnails(thumbnailClient, shipmentLines) : {},
    ensureFont(template.settings.fontFamily)
  ]);

  return {
    pdfProps: {
      ...source,
      company: withPdfLogos(
        company
      ) as unknown as PackingSlipPDFProps["company"],
      locale,
      shipment,
      shipmentLines,
      terms: (terms.salesTerms ?? {}) as PackingSlipPDFProps["terms"],
      thumbnails,
      template,
      sections
    },
    shipmentReadableId: shipment.shipmentId,
    fileName: `${company.name} - ${shipment.shipmentId}.pdf`
  };
}

/** Render a packing slip PDF into a Buffer. */
export function renderPackingSlipPdf(
  props: PackingSlipPDFProps
): Promise<Buffer> {
  // Called as a function (it uses no hooks), so this package needs no JSX.
  return renderPdfToBuffer(PackingSlipPDF(props));
}

/**
 * Who reads line thumbnails: the source's customer-facing reads use the
 * service role, a purchase order or transfer reads as the caller, and a
 * rental or contract slip shows none.
 */
function thumbnailClientFor(
  shipment: Shipment,
  client: Client,
  serviceRole: Client
): Client | null {
  switch (shipment.sourceDocument) {
    case "Sales Order":
    case "Sales Invoice":
      return serviceRole;
    case "Purchase Order":
    case "Outbound Transfer":
      return client;
    default:
      return null;
  }
}

async function loadThumbnails(
  client: Client,
  lines: PackingSlipPDFProps["shipmentLines"]
): Promise<Record<string, string | null>> {
  const entries = await Promise.all(
    lines
      .filter((line) => line.id && line.thumbnailPath)
      .map(
        async (line) =>
          [line.id!, await getBase64Image(client, line.thumbnailPath!)] as const
      )
  );
  return Object.fromEntries(entries.filter(([, data]) => data));
}

function getShippingMethod(client: Client, id: string | null | undefined) {
  return client
    .from("shippingMethod")
    .select("*")
    .eq("id", id ?? "")
    .single();
}

function getPaymentTerm(client: Client, id: string | null | undefined) {
  return client
    .from("paymentTerm")
    .select("*")
    .eq("id", id ?? "")
    .single();
}

function getCustomerLocation(client: Client, id: string | null | undefined) {
  return client
    .from("customerLocation")
    .select(
      "*, address(id, addressLine1, addressLine2, city, stateProvince, countryCode, country(alpha2, name), postalCode)"
    )
    .eq("id", id ?? "")
    .single();
}

function getCustomer(client: Client, id: string | null | undefined) {
  return client
    .from("customer")
    .select("*")
    .eq("id", id ?? "")
    .single();
}

function getShipmentTracking(
  client: Client,
  shipmentId: string,
  companyId: string
) {
  return client
    .from("trackedEntity")
    .select("*")
    .eq("attributes ->> Shipment", shipmentId)
    .eq("companyId", companyId);
}

async function loadSource(
  client: Client,
  serviceRole: Client,
  companyId: string,
  shipment: Shipment
): Promise<SourceProps> {
  const sourceId = shipment.sourceDocumentId ?? "";

  switch (shipment.sourceDocument) {
    case "Sales Order": {
      const [salesOrder, salesOrderShipment] = await Promise.all([
        serviceRole.from("salesOrders").select("*").eq("id", sourceId).single(),
        serviceRole
          .from("salesOrderShipment")
          .select("shippingMethodId")
          .eq("id", sourceId)
          .single()
      ]);
      const order = salesOrder.data;
      const [customer, location, paymentTerm, shippingMethod, tracking] =
        await Promise.all([
          getCustomer(serviceRole, order?.customerId),
          getCustomerLocation(serviceRole, order?.customerLocationId),
          getPaymentTerm(serviceRole, order?.paymentTermId),
          getShippingMethod(
            serviceRole,
            shipment.shippingMethodId ??
              salesOrderShipment.data?.shippingMethodId
          ),
          getShipmentTracking(serviceRole, shipment.id, companyId)
        ]);
      return {
        customer: must(customer, "customer"),
        customerReference: order?.customerReference ?? undefined,
        sourceDocument: "Sales Order",
        sourceDocumentId: order?.salesOrderId ?? undefined,
        shippingAddress: address(location.data?.address),
        paymentTerm: paymentTerm.data ?? NO_TERM,
        shippingMethod: shippingMethod.data ?? NO_TERM,
        trackedEntities: tracking.data ?? [],
        meta: PACKING_SLIP_META
      };
    }
    case "Sales Invoice": {
      const invoice = must(
        await serviceRole
          .from("salesInvoice")
          .select("*, salesInvoiceShipment(*)")
          .eq("id", sourceId)
          .single(),
        "sales invoice"
      );
      const [customer, location, paymentTerm, shippingMethod, tracking] =
        await Promise.all([
          getCustomer(serviceRole, invoice.customerId),
          getCustomerLocation(serviceRole, invoice.locationId),
          getPaymentTerm(serviceRole, invoice.paymentTermId),
          getShippingMethod(
            serviceRole,
            shipment.shippingMethodId ??
              invoice.salesInvoiceShipment?.shippingMethodId
          ),
          getShipmentTracking(serviceRole, shipment.id, companyId)
        ]);
      return {
        customer: must(customer, "customer"),
        customerReference: invoice.customerReference ?? undefined,
        sourceDocument: "Sales Invoice",
        sourceDocumentId: invoice.invoiceId ?? undefined,
        shippingAddress: address(location.data?.address),
        paymentTerm: paymentTerm.data ?? NO_TERM,
        shippingMethod: shippingMethod.data ?? NO_TERM,
        trackedEntities: tracking.data ?? [],
        meta: PACKING_SLIP_META
      };
    }
    case "Purchase Order": {
      const [purchaseOrder, delivery] = await Promise.all([
        client.from("purchaseOrders").select("*").eq("id", sourceId).single(),
        client
          .from("purchaseOrderDelivery")
          .select("shippingMethodId")
          .eq("id", sourceId)
          .single()
      ]);
      const order = purchaseOrder.data;
      const [supplier, location, paymentTerm, shippingMethod, tracking] =
        await Promise.all([
          client
            .from("supplier")
            .select("*")
            .eq("id", order?.supplierId ?? "")
            .single(),
          client
            .from("supplierLocation")
            .select(
              "*, address(id, addressLine1, addressLine2, city, stateProvince, country(alpha2, name), postalCode)"
            )
            .eq("id", order?.supplierLocationId ?? "")
            .single(),
          getPaymentTerm(client, order?.paymentTermId),
          getShippingMethod(client, delivery.data?.shippingMethodId),
          getShipmentTracking(client, shipment.id, companyId)
        ]);
      return {
        customer: must(supplier, "supplier"),
        customerReference: order?.supplierReference ?? undefined,
        sourceDocument: "Purchase Order",
        sourceDocumentId: order?.purchaseOrderId ?? undefined,
        shippingAddress: address(location.data?.address),
        paymentTerm: paymentTerm.data ?? NO_TERM,
        shippingMethod: shippingMethod.data ?? NO_TERM,
        trackedEntities: tracking.data ?? [],
        meta: PACKING_SLIP_META
      };
    }
    case "Outbound Transfer": {
      const [transfer, shippingMethod, tracking] = await Promise.all([
        client
          .from("warehouseTransfer")
          .select("transferId, toLocation:location!toLocationId(*)")
          .eq("id", sourceId)
          .single(),
        getShippingMethod(client, shipment.shippingMethodId),
        getShipmentTracking(client, shipment.id, companyId)
      ]);
      const { transferId, toLocation } = must(transfer, "warehouse transfer");
      return {
        customer: {
          name: toLocation?.name ?? ""
        } as PackingSlipPDFProps["customer"],
        sourceDocument: "Outbound Transfer",
        sourceDocumentId: transferId ?? undefined,
        shippingAddress: address(
          toLocation
            ? {
                addressLine1: toLocation.addressLine1,
                addressLine2: toLocation.addressLine2,
                city: toLocation.city,
                stateProvince: toLocation.stateProvince,
                postalCode: toLocation.postalCode,
                countryCode: toLocation.countryCode
              }
            : null
        ),
        paymentTerm: NO_TERM,
        shippingMethod: shippingMethod.data ?? NO_TERM,
        trackedEntities: tracking.data ?? [],
        meta: PACKING_SLIP_META
      };
    }
    case "Rental Agreement": {
      const agreement = must(
        await serviceRole
          .from("rentalAgreements")
          .select("*")
          .eq("id", sourceId)
          .eq("companyId", companyId)
          .single(),
        "rental agreement"
      );
      const [customer, location, paymentTerm, shippingMethod, rentalLines] =
        await Promise.all([
          serviceRole
            .from("customer")
            .select("*")
            .eq("id", agreement.customerId ?? "")
            .eq("companyId", companyId)
            .single(),
          getCustomerLocation(serviceRole, agreement.customerLocationId),
          getPaymentTerm(serviceRole, agreement.paymentTermId),
          getShippingMethod(serviceRole, shipment.shippingMethodId),
          serviceRole
            .from("shipmentFixedAssetLine")
            .select(
              "id, shipped, rentalAgreementLine!shipmentFixedAssetLine_rentalAgreementLineId_fkey(fixedAsset(fixedAssetId, name, serialNumber), item(name), trackedEntity(readableId))"
            )
            .eq("shipmentId", shipment.id)
            .eq("companyId", companyId)
            .not("rentalAgreementLineId", "is", null)
            .order("createdAt")
            .order("id")
        ]);
      const rentalUnits = must(rentalLines, "rental units")
        .filter((row) => row.shipped && row.rentalAgreementLine)
        .map((row) => {
          const line = row.rentalAgreementLine!;
          return {
            id: row.id,
            name: line.fixedAsset?.name ?? line.item?.name ?? "Rental unit",
            assetReadableId: line.fixedAsset?.fixedAssetId ?? null,
            serialNumber:
              line.fixedAsset?.serialNumber ??
              line.trackedEntity?.readableId ??
              null
          };
        });
      return {
        customer: must(customer, "customer"),
        sourceDocument: "Rental Agreement",
        sourceDocumentId: agreement.rentalAgreementId ?? undefined,
        shippingAddress: address(location.data?.address),
        paymentTerm: paymentTerm.data ?? NO_TERM,
        shippingMethod: shippingMethod.data ?? NO_TERM,
        trackedEntities: [],
        rentalUnits,
        documentType: "deliveryTicket",
        meta: {
          author: "Carbon",
          keywords: "delivery ticket",
          subject: "Delivery Ticket"
        }
      };
    }
    case "Customer Contract": {
      // A contract delivery prints as a Receiving Report: the contract number
      // and, per CLIN, what was delivered with its serials (spec 10.4). The
      // user keys it into WAWF; there is no EDI export.
      const contract = must(
        await serviceRole
          .from("customerContract")
          .select(
            "customerContractId, customerReference, customerId, shipToCustomerLocationId"
          )
          .eq("id", sourceId)
          .eq("companyId", companyId)
          .single(),
        "contract"
      );
      const [customer, location, shippingMethod, deliveryLines] =
        await Promise.all([
          serviceRole
            .from("customer")
            .select("*")
            .eq("id", contract.customerId)
            .eq("companyId", companyId)
            .single(),
          getCustomerLocation(serviceRole, contract.shipToCustomerLocationId),
          getShippingMethod(serviceRole, shipment.shippingMethodId),
          serviceRole
            .from("shipmentLine")
            .select(
              "id, lineId, shippedQuantity, unitOfMeasure, serialNumber, item(readableIdWithRevision, name)"
            )
            .eq("shipmentId", shipment.id)
            .eq("companyId", companyId)
            .gt("shippedQuantity", 0)
            .order("createdAt")
        ]);
      const lines = must(deliveryLines, "delivery lines");

      // `shipmentLine.lineId` names the CLIN with no foreign key: one read.
      const clinIds = [
        ...new Set(
          lines.map((line) => line.lineId).filter((id): id is string => !!id)
        )
      ];
      const clins = must(
        await serviceRole
          .from("customerContractLine")
          .select("id, lineItemNumber, description")
          .in("id", clinIds.length > 0 ? clinIds : [""])
          .eq("companyId", companyId),
        "contract lines"
      );
      const clinById = new Map(clins.map((clin) => [clin.id, clin]));

      return {
        customer: must(customer, "customer"),
        customerReference: contract.customerReference ?? undefined,
        sourceDocument: "Contract",
        sourceDocumentId: contract.customerContractId ?? undefined,
        shippingAddress: address(location.data?.address),
        paymentTerm: NO_TERM,
        shippingMethod: shippingMethod.data ?? NO_TERM,
        trackedEntities: [],
        rentalUnits: lines.map((line) => {
          const clinLine = line.lineId ? clinById.get(line.lineId) : null;
          const clin = clinLine?.lineItemNumber;
          const description = clinLine?.description || line.item?.name || "";
          return {
            id: line.id,
            name: clin ? `CLIN ${clin} ${description}` : description,
            assetReadableId: line.item?.readableIdWithRevision ?? null,
            serialNumber: line.serialNumber ?? null,
            quantity:
              `${line.shippedQuantity} ${line.unitOfMeasure ?? ""}`.trim()
          };
        }),
        documentType: "receivingReport",
        meta: {
          author: "Carbon",
          keywords: "receiving report",
          subject: "Receiving Report"
        }
      };
    }
    default:
      throw new Error("Invalid source document");
  }
}
