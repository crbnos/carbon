import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useParams } from "react-router";
import {
  getShipment,
  getShipmentLines,
  getShipmentRelatedItems,
  getShipmentTracking
} from "~/modules/inventory";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Shipments`,
  to: path.to.shipments
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
      .eq("shipmentId", shipmentId);

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
  const params = useParams();
  const { shipmentId } = params;
  if (!shipmentId) throw new Error("Could not find shipmentId");

  return (
    <div className="flex h-[calc(100dvh-49px)] overflow-y-auto scrollbar-hide w-full">
      <div className="h-full p-4 w-full max-w-5xl mx-auto">
        <div className="flex flex-col gap-2 pb-16 w-full">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
