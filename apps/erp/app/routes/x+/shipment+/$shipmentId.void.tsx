import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { voidShipment } from "~/modules/inventory/inventory.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const { shipmentId } = params;
  if (!shipmentId) throw new Error("shipmentId not found");

  let result: Awaited<ReturnType<typeof voidShipment>>;
  try {
    result = await voidShipment(client, { shipmentId, companyId, userId });
  } catch (err) {
    throw redirect(
      path.to.shipmentDetails(shipmentId),
      await flash(request, error(err, "Failed to void shipment"))
    );
  }

  if (result.error) {
    throw redirect(
      path.to.shipmentDetails(shipmentId),
      await flash(
        request,
        error(result.error.cause ?? null, result.error.flash)
      )
    );
  }

  return redirect(
    path.to.shipmentDetails(shipmentId),
    await flash(request, success("Shipment voided"))
  );
}
