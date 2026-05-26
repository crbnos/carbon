import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  deleteShipment,
  getShipment
} from "~/modules/inventory/inventory.service.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermissions(request, {
    delete: "inventory"
  });

  const { shipmentId } = params;
  if (!shipmentId) {
    throw redirect(
      path.to.shipments,
      await flash(request, error(params, "Failed to get an shipment id"))
    );
  }

  // make sure the shipment has not been posted
  const { error: getShipmentError, data: shipment } =
    await getShipment(shipmentId);
  if (getShipmentError) {
    throw redirect(
      path.to.shipments,
      await flash(request, error(getShipmentError, "Failed to get shipment"))
    );
  }

  if (shipment?.postingDate) {
    throw redirect(
      path.to.shipments,
      await flash(
        request,
        error(getShipmentError, "Cannot delete a posted shipment")
      )
    );
  }

  const { error: deleteShipmentError } = await deleteShipment(shipmentId);
  if (deleteShipmentError) {
    throw redirect(
      path.to.shipments,
      await flash(
        request,
        error(deleteShipmentError, deleteShipmentError.message)
      )
    );
  }

  throw redirect(
    path.to.shipments,
    await flash(request, success("Successfully deleted shipment"))
  );
}
