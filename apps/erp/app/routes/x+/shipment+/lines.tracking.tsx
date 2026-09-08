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
  const trackingType = formData.get("trackingType") as "batch" | "serial";
  const trackedEntityId = formData.get("trackedEntityId") as string;

  // Fetch the current tracked entity to get existing attributes, plus the
  // shipment and its line — the LINE's item (never the form's) is what the
  // entity must match.
  const [trackedEntityResponse, shipmentResponse, shipmentLineResponse] =
    await Promise.all([
      client
        .from("trackedEntity")
        .select("*")
        .eq("id", trackedEntityId)
        .eq("companyId", companyId)
        .single(),
      client
        .from("shipment")
        .select("sourceDocument, sourceDocumentId")
        .eq("id", shipmentId)
        .eq("companyId", companyId)
        .single(),
      client
        .from("shipmentLine")
        .select("itemId")
        .eq("id", shipmentLineId)
        .eq("shipmentId", shipmentId)
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

  if (shipmentLineResponse.error) {
    return data(
      { success: false, error: shipmentLineResponse.error.message },
      await flash(
        request,
        error(shipmentLineResponse.error, "Failed to load shipment line")
      )
    );
  }

  // The entity must be the line's item — the loosest picker (or a crafted
  // POST) must not be able to assign an unrelated part's serial.
  if (
    trackedEntity.itemId &&
    shipmentLineResponse.data.itemId &&
    trackedEntity.itemId !== shipmentLineResponse.data.itemId
  ) {
    const message = "Tracked entity does not match the line's item";
    return data(
      { success: false, error: message },
      await flash(request, error(message))
    );
  }

  // Return-to-customer shipments (source "Sales Return Order") ship returned
  // stock, which is deliberately On Hold until dispositioned/shipped back —
  // everything else ships Available stock only.
  const isSalesReturnShipment =
    shipmentResponse.data?.sourceDocument === "Sales Return Order";
  const allowedStatus = isSalesReturnShipment ? "On Hold" : "Available";

  // On Hold alone is not provenance: an entity can be On Hold for an
  // unrelated inspection or another customer's RMA. For a return-to-customer
  // shipment the entity must have COME BACK on a receipt of THIS return
  // order (its Receipt attribute is stamped by the return-receipt flow).
  if (isSalesReturnShipment) {
    const entityReceiptId = (
      trackedEntity.attributes as Record<string, unknown> | null
    )?.["Receipt"] as string | undefined;
    const provenance = entityReceiptId
      ? await client
          .from("receipt")
          .select("id")
          .eq("id", entityReceiptId)
          .eq("sourceDocument", "Sales Return Order")
          .eq("sourceDocumentId", shipmentResponse.data.sourceDocumentId ?? "")
          .eq("companyId", companyId)
          .maybeSingle()
      : { data: null, error: null };
    if (provenance.error) {
      return data(
        { success: false, error: "Failed to verify the entity's provenance" },
        await flash(
          request,
          error(provenance.error, "Failed to verify the entity's provenance")
        )
      );
    }
    if (!provenance.data) {
      const message =
        "Tracked entity was not received on this return order and cannot ship back on it";
      return data(
        { success: false, error: message },
        await flash(request, error(message))
      );
    }
  }

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
