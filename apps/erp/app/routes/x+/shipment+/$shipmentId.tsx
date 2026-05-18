import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
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
  const { companyId } = await requirePermissions(request, {
    view: "inventory"
  });

  const { shipmentId } = params;
  if (!shipmentId) throw new Error("Could not find shipmentId");

  const [shipment, shipmentLines, shipmentLineTracking] = await Promise.all([
    getShipment(shipmentId),
    getShipmentLines(shipmentId),
    getShipmentTracking(shipmentId)
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

  return {
    shipment: shipment.data,
    shipmentLines: shipmentLines.data ?? [],
    shipmentLineTracking: shipmentLineTracking.data ?? [],
    relatedItems: getShipmentRelatedItems(
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
