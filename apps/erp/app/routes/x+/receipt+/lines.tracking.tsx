import { getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { TrackedEntityAttributes } from "~/modules/shared/types";

export async function action({ request, context }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    create: "inventory",
  });

  const formData = await request.formData();
  const itemId = formData.get("itemId") as string;
  const receiptLineId = formData.get("receiptLineId") as string;
  const receiptId = formData.get("receiptId") as string;
  const trackingType = formData.get("trackingType") as "batch" | "serial";

  if (trackingType === "batch") {
    const batchNumber = formData.get("batchNumber") as string;
    const quantity = Number(formData.get("quantity"));
    const properties = formData.get("properties") as string | null;
    // First, get or create the batch number record
    const { data: trackedEntity, error: batchQueryError } = await client
      .from("trackedEntity")
      .select("*")
      .eq("attributes ->> Receipt", receiptId)
      .eq("attributes ->> Batch Number", batchNumber)
      .eq("companyId", companyId)
      .maybeSingle();

    if (batchQueryError) {
      return json({ error: "Failed to query batch number" }, { status: 500 });
    }

    const trackedEntityId = trackedEntity?.id;
    let propertiesJson = {};
    try {
      propertiesJson = properties ? JSON.parse(properties) : {};
    } catch (error) {
      console.error(error);
    }

    const serviceRole = await getCarbonServiceRole();
    // Use a transaction to ensure data consistency
    const { error } = await serviceRole.rpc(
      "update_receipt_line_batch_tracking",
      {
        p_tracked_entity_id: trackedEntityId,
        p_receipt_line_id: receiptLineId,
        p_receipt_id: receiptId,
        p_batch_number: batchNumber,
        p_quantity: quantity,
        p_properties: propertiesJson,
      }
    );

    if (error) {
      console.error(error);
      return json({ error: "Failed to update tracking" }, { status: 500 });
    }
  } else if (trackingType === "serial") {
    const serialNumber = formData.get("serialNumber") as string;
    const index = Number(formData.get("index"));

    // Check if the serial number is already used for a different receipt line or index
    const { data: existingEntityWithIndex, error: indexQueryError } =
      await client
        .from("trackedEntity")
        .select("*")
        .eq("sourceDocumentId", itemId)
        .eq("attributes->> Serial Number", serialNumber)
        .eq("companyId", companyId)
        .maybeSingle();

    if (indexQueryError) {
      return json(
        { error: "Failed to check serial number index" },
        { status: 500 }
      );
    }

    // If the serial number exists but for a different receipt line or index, return an error
    if (existingEntityWithIndex) {
      const attributes =
        existingEntityWithIndex.attributes as TrackedEntityAttributes;
      if (
        attributes["Receipt Line"] !== receiptLineId ||
        attributes["Index"] !== index
      ) {
        return json(
          {
            error:
              "Serial number is already used for a different item or position",
          },
          { status: 400 }
        );
      }
    }

    const serviceRole = await getCarbonServiceRole();
    // Use a transaction to ensure data consistency
    const { error } = await serviceRole.rpc(
      "update_receipt_line_serial_tracking",
      {
        p_tracked_entity_id: existingEntityWithIndex?.id,
        p_receipt_line_id: receiptLineId,
        p_receipt_id: receiptId,
        p_serial_number: serialNumber,
        p_index: index,
      }
    );

    if (error) {
      console.error(error);
      // Check if error is due to unique constraint violation
      if (error.message?.includes("duplicate key value")) {
        return json(
          { error: "Serial number already exists for this item" },
          { status: 400 }
        );
      }
      return json({ error: "Failed to update tracking" }, { status: 500 });
    }
  }

  return json({ success: true });
}
