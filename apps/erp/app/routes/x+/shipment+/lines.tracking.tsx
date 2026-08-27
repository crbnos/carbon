import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    create: "inventory"
  });

  const formData = await request.formData();

  const shipmentLineId = formData.get("shipmentLineId") as string;
  const shipmentId = formData.get("shipmentId") as string;
  // const itemId = formData.get("itemId") as string;
  const trackingType = formData.get("trackingType") as "batch" | "serial";
  const trackedEntityId = formData.get("trackedEntityId") as string;

  // Fetch the current tracked entity to get existing attributes
  const [trackedEntityResponse, shipmentResponse] = await Promise.all([
    client
      .from("trackedEntity")
      .select("*")
      .eq("id", trackedEntityId)
      .eq("companyId", companyId)
      .single(),
    client
      .from("shipment")
      .select("sourceDocument")
      .eq("id", shipmentId)
      .eq("companyId", companyId)
      .single()
  ]);

  if (trackedEntityResponse.error) {
    return data(
      { success: false, error: trackedEntityResponse.error.message },
      await flash(
        request,
        error(trackedEntityResponse.error, trackedEntityResponse.error.message)
      )
    );
  }

  const trackedEntity = trackedEntityResponse.data;

  // A failed shipment lookup must not silently fall back to "Available" —
  // that would reject legitimate On Hold sales-return tracking writes.
  if (shipmentResponse.error) {
    return data(
      { success: false, error: shipmentResponse.error.message },
      await flash(
        request,
        error(shipmentResponse.error, "Failed to load shipment")
      )
    );
  }

  // Return-to-customer shipments (source "Sales Return Order") ship returned
  // stock, which is deliberately On Hold until dispositioned/shipped back —
  // everything else ships Available stock only.
  const allowedStatus =
    shipmentResponse.data?.sourceDocument === "Sales Return Order"
      ? "On Hold"
      : "Available";

  if (trackedEntity.status !== allowedStatus) {
    return data(
      {
        success: false,
        error: `Tracked entity is not available. Current status: ${trackedEntity.status}`
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
      return data(
        { success: false, error: "Batch has insufficient quantity" },
        await flash(request, error("Batch has insufficient quantity"))
      );
    }

    // Add batch-specific attributes
    newAttributes = {
      ...newAttributes,
      "Shipment Line": shipmentLineId,
      Shipment: shipmentId
    };
  } else if (trackingType === "serial") {
    const index = Number(formData.get("index"));

    // Add serial-specific attributes
    newAttributes = {
      ...newAttributes,
      "Shipment Line": shipmentLineId,
      Shipment: shipmentId,
      "Shipment Line Index": index
    };
  }

  // Update the trackedEntity record using service role to bypass RLS
  const updateResponse = await serviceRole
    .from("trackedEntity")
    .update({
      attributes: newAttributes
    })
    .eq("id", trackedEntityId)
    .eq("status", allowedStatus)
    .select("id");

  if (updateResponse.error) {
    return data(
      { success: false, error: updateResponse.error.message },
      await flash(
        request,
        error(updateResponse.error, updateResponse.error.message)
      )
    );
  }

  // The status filter guards against a concurrent flip; zero matched rows is
  // a conflict, not a success.
  if (!updateResponse.data || updateResponse.data.length === 0) {
    const message = `Tracked entity is no longer ${allowedStatus}`;
    return data(
      { success: false, error: message },
      await flash(request, error(message))
    );
  }

  // Only after the new assignment succeeds, clear stale shipment attrs
  // Batch: any prior entity on this line. Serial: only the entity at this index.
  let staleQuery = serviceRole
    .from("trackedEntity")
    .select("id, attributes")
    .eq("companyId", companyId)
    .eq("attributes ->> Shipment Line", shipmentLineId)
    .neq("id", trackedEntityId);

  if (trackingType === "serial") {
    const index = Number(formData.get("index"));
    staleQuery = staleQuery.eq(
      "attributes ->> Shipment Line Index",
      String(index)
    );
  }

  const staleResponse = await staleQuery;

  if (staleResponse.data && staleResponse.data.length > 0) {
    await Promise.all(
      staleResponse.data.map((stale) => {
        const cleaned = {
          ...((stale.attributes ?? {}) as Record<string, any>)
        };
        delete cleaned["Shipment Line"];
        delete cleaned.Shipment;
        delete cleaned["Shipment Line Index"];
        return serviceRole
          .from("trackedEntity")
          .update({ attributes: cleaned })
          .eq("id", stale.id);
      })
    );
  }

  return { success: true };
}
