import { error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Outlet, useParams } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { defer, redirect } from "@vercel/remix";
import { PanelProvider } from "~/components/Layout";
import {
  getShipment,
  getShipmentTracking,
  getShipmentLines,
} from "~/modules/inventory";
import ShipmentHeader from "~/modules/inventory/ui/Shipments/ShipmentHeader";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Shipments",
  to: path.to.shipments,
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    view: "inventory",
  });

  const serviceRole = await getCarbonServiceRole();

  const { shipmentId } = params;
  if (!shipmentId) throw new Error("Could not find shipmentId");

  const [shipment, shipmentLines, shipmentLineTracking] = await Promise.all([
    getShipment(serviceRole, shipmentId),
    getShipmentLines(serviceRole, shipmentId),
    getShipmentTracking(serviceRole, shipmentId, companyId),
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

  return defer({
    shipment: shipment.data,
    shipmentLines: shipmentLines.data ?? [],
    shipmentLineTracking: shipmentLineTracking.data ?? [],
  });
}

export default function ShipmentRoute() {
  const params = useParams();
  const { shipmentId } = params;
  if (!shipmentId) throw new Error("Could not find shipmentId");

  return (
    <PanelProvider>
      <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
        <ShipmentHeader />
        <div className="flex h-[calc(100dvh-99px)] overflow-y-auto scrollbar-hide w-full">
          <VStack spacing={4} className="h-full p-2 w-full max-w-5xl mx-auto">
            <Outlet />
          </VStack>
        </div>
      </div>
    </PanelProvider>
  );
}
