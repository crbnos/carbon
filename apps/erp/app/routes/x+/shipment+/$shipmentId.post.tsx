import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  postShipment,
  SHIPMENT_NOT_FOUND
} from "~/modules/inventory/inventory.server";
import { loader as pdfLoader } from "~/routes/file+/shipment+/$id[.]pdf";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const { shipmentId } = params;
  if (!shipmentId) throw new Error("shipmentId not found");

  const formData = await request.formData();
  const acknowledged = formData.get("acknowledged") === "true";

  // Rule evaluation, the expired-batch policy, the Pending flip, the
  // post-shipment edge function and its follow-ups live in the command,
  // shared with the inventory_postShipment tool. The packing slip needs this
  // request, so only the route renders it.
  const result = await postShipment(client, {
    shipmentId,
    companyId,
    userId,
    acknowledged,
    renderPackingSlip: () =>
      // @ts-expect-error TS2741 - TODO: fix type
      pdfLoader({ request, params: { id: shipmentId }, context: {} })
  });

  if (result.error) {
    throw redirect(
      result.error.flash === SHIPMENT_NOT_FOUND
        ? path.to.shipments
        : path.to.shipmentDetails(shipmentId),
      await flash(
        request,
        error(result.error.cause ?? null, result.error.flash)
      )
    );
  }

  if (result.data.status === "blocked") {
    return {
      error: null,
      data: null,
      violations: result.data.violations,
      ruleNames: result.data.ruleNames
    };
  }

  if (result.data.warning) {
    throw redirect(
      path.to.shipmentDetails(shipmentId),
      await flash(request, success(result.data.warning))
    );
  }

  throw redirect(path.to.shipmentDetails(shipmentId));
}
