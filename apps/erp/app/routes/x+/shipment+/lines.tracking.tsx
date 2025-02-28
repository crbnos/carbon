import { error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { json, type ActionFunctionArgs } from "@vercel/remix";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    create: "inventory",
  });

  const formData = await request.formData();

  const shipmentLineId = formData.get("shipmentLineId") as string;
  const shipmentId = formData.get("shipmentId") as string;
  // const itemId = formData.get("itemId") as string;
  const trackingType = formData.get("trackingType") as "batch" | "serial";
  const trackedEntityId = formData.get("trackedEntityId") as string;

  // Fetch the current tracked entity to get existing attributes
  const trackedEntityResponse = await client
    .from("trackedEntity")
    .select("*")
    .eq("id", trackedEntityId)
    .eq("companyId", companyId)
    .single();

  if (trackedEntityResponse.error) {
    return json(
      { success: false, error: trackedEntityResponse.error.message },
      await flash(
        request,
        error(trackedEntityResponse.error, trackedEntityResponse.error.message)
      )
    );
  }

  const trackedEntity = trackedEntityResponse.data;

  if (trackedEntity.status !== "Available") {
    return json(
      {
        success: false,
        error: `Tracked entity is not available. Current status: ${trackedEntity.status}`,
      },
      await flash(
        request,
        error(
          `Tracked entity is not available. Current status: ${trackedEntity.status}`
        )
      )
    );
  }

  const serviceRole = await getCarbonServiceRole();

  // Prepare new attributes by merging with existing ones
  const existingAttributes = trackedEntity.attributes || {};
  let newAttributes = { ...(existingAttributes as Record<string, any>) };

  if (trackingType === "batch") {
    const quantity = Number(formData.get("quantity"));

    if (trackedEntity.quantity < quantity) {
      return json(
        { success: false, error: "Batch has insufficient quantity" },
        await flash(request, error("Batch has insufficient quantity"))
      );
    }

    // Add batch-specific attributes
    newAttributes = {
      ...newAttributes,
      "Shipment Line": shipmentLineId,
      Shipment: shipmentId,
    };
  } else if (trackingType === "serial") {
    const index = Number(formData.get("index"));

    // Add serial-specific attributes
    newAttributes = {
      ...newAttributes,
      "Shipment Line": shipmentLineId,
      Shipment: shipmentId,
      "Shipment Line Index": index,
    };
  }

  // Update the trackedEntity record using service role to bypass RLS
  const updateResponse = await serviceRole
    .from("trackedEntity")
    .update({
      attributes: newAttributes,
    })
    .eq("id", trackedEntityId)
    .eq("status", "Available");

  if (updateResponse.error) {
    return json(
      { success: false, error: updateResponse.error.message },
      await flash(
        request,
        error(updateResponse.error, updateResponse.error.message)
      )
    );
  }

  return json({ success: true });
}
