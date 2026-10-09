// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { RecordOutlet } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { DocumentPage, DocumentSidebar } from "~/components/DocumentPage";
import {
  getRentalShipmentLines,
  getShipment,
  getShipmentLines,
  getShipmentRelatedItems,
  getShipmentTracking,
  type RentalShipmentLine
} from "~/modules/inventory";
import {
  ShipmentDocuments,
  ShipmentHeader
} from "~/modules/inventory/ui/Shipments";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  realtime: [
    { table: "shipment", column: "id", param: "shipmentId" },
    { table: "shipmentLine", column: "shipmentId", param: "shipmentId" }
  ],
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Shipments`, to: path.to.shipments },
    (data) => data?.shipment?.shipmentId
  ),
  module: "inventory"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory"
  });

  const { shipmentId } = params;
  if (!shipmentId) throw new Error("Could not find shipmentId");

  const [shipment, shipmentLines, shipmentLineTracking] = await Promise.all([
    getShipment(client, shipmentId),
    getShipmentLines(client, shipmentId),
    getShipmentTracking(client, shipmentId, companyId)
  ]);

  if (shipment.error) {
    throw redirect(
      path.to.shipments,
      await flash(request, error(shipment.error, "Failed to load shipment"))
    );
  }

  if (shipment.data.companyId !== companyId) {
    throw redirect(path.to.shipments);
  }

  let fixedAssetLines: {
    id: string;
    salesOrderLineId: string;
    assetId: string;
    assetName: string | null;
    assetReadableId: string | null;
    description: string | null;
    shipped: boolean;
    serialNumber: string | null;
  }[] = [];

  if (shipment.data.sourceDocument === "Sales Order") {
    const serviceRole = getCarbonServiceRole();
    const faLineRecords = await serviceRole
      .from("shipmentFixedAssetLine")
      .select(
        "id, salesOrderLineId, shipped, serialNumber, salesOrderLine:salesOrderLineId(assetId, description, fixedAsset:assetId(name, fixedAssetId, serialNumber))"
      )
      .eq("shipmentId", shipmentId)
      .eq("companyId", companyId)
      .not("salesOrderLineId", "is", null);

    fixedAssetLines = (faLineRecords.data ?? [])
      .filter((row) => {
        const sol = row.salesOrderLine as any;
        return sol?.assetId;
      })
      .map((row) => {
        const sol = row.salesOrderLine as any;
        return {
          id: row.id,
          salesOrderLineId: row.salesOrderLineId,
          assetId: sol.assetId,
          assetName: sol.fixedAsset?.name ?? null,
          assetReadableId: sol.fixedAsset?.fixedAssetId ?? null,
          description: sol.description,
          shipped: row.shipped,
          serialNumber: row.serialNumber ?? sol.fixedAsset?.serialNumber ?? null
        };
      });
  }

  let rentalLines: RentalShipmentLine[] = [];

  if (shipment.data.sourceDocument === "Rental Agreement") {
    // Service role: rentalAgreementLine needs sales_view, which an inventory
    // user may not hold.
    const rentalLineRecords = await getRentalShipmentLines(
      getCarbonServiceRole(),
      shipmentId,
      companyId
    );
    if (rentalLineRecords.error) {
      throw redirect(
        path.to.shipments,
        await flash(
          request,
          error(rentalLineRecords.error, "Failed to load the rental units")
        )
      );
    }

    rentalLines = (rentalLineRecords.data ?? []).map((row) => {
      // The read filters out rows with no rental line.
      const line = row.rentalAgreementLine!;
      return {
        id: row.id,
        rentalAgreementLineId: row.rentalAgreementLineId!,
        shipped: row.shipped,
        meter: row.meter === null ? null : Number(row.meter),
        unitName: line.fixedAsset?.name ?? line.item?.name ?? "Rental unit",
        thumbnailPath: line.item?.thumbnailPath ?? null,
        itemType: line.item?.type ?? null,
        assetReadableId: line.fixedAsset?.fixedAssetId ?? null,
        serialNumber:
          line.fixedAsset?.serialNumber ??
          line.trackedEntity?.readableId ??
          null,
        lineStatus: line.status
      };
    });
    // By unit, like ordinary lines by part number, so the list holds still.
    rentalLines.sort((a, b) =>
      (a.assetReadableId ?? a.unitName).localeCompare(
        b.assetReadableId ?? b.unitName
      )
    );
  }

  return {
    shipment: shipment.data,
    shipmentLines: shipmentLines.data ?? [],
    fixedAssetLines,
    rentalLines,
    shipmentLineTracking: shipmentLineTracking.data ?? [],
    relatedItems: getShipmentRelatedItems(
      client,
      shipmentId,
      shipment.data?.sourceDocumentId ?? ""
    )
  };
}

export default function ShipmentRoute() {
  const { shipment } = useLoaderData<typeof loader>();

  return (
    <DocumentPage
      header={<ShipmentHeader />}
      sidebar={
        <DocumentSidebar
          documents={<ShipmentDocuments />}
          activity={{
            entityType: "shipment",
            entityId: shipment.id,
            refreshKey: `${shipment.updatedAt ?? ""}:${shipment.status}`
          }}
        />
      }
    >
      <RecordOutlet />
    </DocumentPage>
  );
}
