// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { isUnaffectedByNavigation, redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { DocumentPage, DocumentSidebar } from "~/components/DocumentPage";
import {
  getShipment,
  getShipmentLines,
  getShipmentRelatedItems,
  getShipmentTracking
} from "~/modules/inventory";
import {
  ShipmentDocuments,
  ShipmentHeader
} from "~/modules/inventory/ui/Shipments";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Shipments`, to: path.to.shipments },
    (data) => data?.shipment?.shipmentId
  ),
  module: "inventory"
};

export const shouldRevalidate: ShouldRevalidateFunction = (args) =>
  isUnaffectedByNavigation(args, { params: ["shipmentId"] })
    ? false
    : args.defaultShouldRevalidate;

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
      .eq("companyId", companyId);

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

  return {
    shipment: shipment.data,
    shipmentLines: shipmentLines.data ?? [],
    fixedAssetLines,
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
      <Outlet />
    </DocumentPage>
  );
}
