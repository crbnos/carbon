import { error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory",
  });

  const { shipmentId } = params;
  if (!shipmentId) throw new Error("shipmentId not found");

  const setPendingState = await client
    .from("shipment")
    .update({
      status: "Pending",
    })
    .eq("id", shipmentId);

  if (setPendingState.error) {
    throw redirect(
      path.to.shipments,
      await flash(
        request,
        error(setPendingState.error, "Failed to post shipment")
      )
    );
  }

  try {
    const serviceRole = await getCarbonServiceRole();
    const postShipment = await serviceRole.functions.invoke("post-shipment", {
      body: {
        shipmentId: shipmentId,
        userId: userId,
        companyId: companyId,
      },
    });

    if (postShipment.error) {
      await client
        .from("shipment")
        .update({
          status: "Draft",
        })
        .eq("id", shipmentId);

      throw redirect(
        path.to.shipments,
        await flash(
          request,
          error(postShipment.error, "Failed to post shipment")
        )
      );
    }
  } catch (error) {
    await client
      .from("shipment")
      .update({
        status: "Draft",
      })
      .eq("id", shipmentId);
  }

  throw redirect(path.to.shipments);
}
