import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { deleteShipment, getShipment } from "~/modules/inventory";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "inventory",
  });

  const { shipmentId } = params;
  if (!shipmentId) {
    throw redirect(
      path.to.shipments,
      await flash(request, error(params, "Failed to get an shipment id"))
    );
  }

  // make sure the shipment has not been posted
  const { error: getShipmentError, data: shipment } = await getShipment(
    client,
    shipmentId
  );
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

  const { error: deleteShipmentError } = await deleteShipment(
    client,
    shipmentId
  );
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
