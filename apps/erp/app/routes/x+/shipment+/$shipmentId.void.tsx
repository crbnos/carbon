import { error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { FunctionRegion } from "@supabase/supabase-js";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory",
  });

  const { shipmentId } = params;
  if (!shipmentId) throw new Error("shipmentId not found");

  try {
    const serviceRole = getCarbonServiceRole();

    // Verify shipment is posted before allowing void
    const { data: shipment } = await client
      .from("shipment")
      .select("status")
      .eq("id", shipmentId)
      .single();

    if (shipment?.status !== "Posted") {
      throw redirect(
        path.to.shipmentDetails(shipmentId),
        await flash(
          request,
          error(new Error("Can only void posted shipments"), "Invalid operation")
        )
      );
    }

    const voidShipment = await serviceRole.functions.invoke("void-shipment", {
      body: {
        shipmentId: shipmentId,
        userId: userId,
        companyId: companyId,
      },
      region: FunctionRegion.UsEast1,
    });

    if (voidShipment.error) {
      throw redirect(
        path.to.shipmentDetails(shipmentId),
        await flash(
          request,
          error(voidShipment.error, "Failed to void shipment")
        )
      );
    }

    throw redirect(
      path.to.shipmentDetails(shipmentId),
      await flash(request, {
        type: "success",
        title: "Shipment voided",
        message: "The shipment has been successfully voided",
      })
    );
  } catch (err) {
    throw redirect(
      path.to.shipmentDetails(shipmentId),
      await flash(
        request,
        error(err, "Failed to void shipment")
      )
    );
  }
}