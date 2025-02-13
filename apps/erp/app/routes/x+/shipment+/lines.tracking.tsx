import { requirePermissions } from "@carbon/auth/auth.server";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { nanoid } from "nanoid";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    create: "inventory",
  });

  const formData = await request.formData();

  const shipmentLineId = formData.get("shipmentLineId") as string;
  const shipmentId = formData.get("shipmentId") as string;
  const itemId = formData.get("itemId") as string;
  const trackingType = formData.get("trackingType") as "batch" | "serial";

  if (trackingType === "batch") {
    const batchNumber = formData.get("batchNumber") as string;
    const manufacturingDate = formData.get("manufacturingDate") as
      | string
      | null;
    const expirationDate = formData.get("expirationDate") as string | null;
    const quantity = Number(formData.get("quantity"));
    const properties = formData.get("properties") as string | null;
    // First, get or create the batch number record
    const { data: existingBatch, error: batchQueryError } = await client
      .from("batchNumber")
      .select("id")
      .eq("number", batchNumber)
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .maybeSingle();

    if (batchQueryError) {
      return json({ error: "Failed to query batch number" }, { status: 500 });
    }

    const batchId = existingBatch?.id ?? nanoid();
    let propertiesJson = {};
    try {
      propertiesJson = properties ? JSON.parse(properties) : {};
    } catch (error) {
      console.error(error);
    }

    // Use a transaction to ensure data consistency
    const { error } = await client.rpc("update_shipment_line_batch_tracking", {
      p_shipment_line_id: shipmentLineId,
      p_shipment_id: shipmentId,
      p_batch_number: batchNumber,
      p_batch_id: batchId,
      // @ts-ignore
      p_manufacturing_date: manufacturingDate || null,
      // @ts-ignore
      p_expiration_date: expirationDate || null,
      p_quantity: quantity,
      p_properties: propertiesJson,
    });

    if (error) {
      console.error(error);
      return json({ error: "Failed to update tracking" }, { status: 500 });
    }
  } else if (trackingType === "serial") {
    const serialNumberId = formData.get("serialNumberId") as string;
    const index = Number(formData.get("index"));

    // Check if serial number already exists for this item
    const { error: queryError } = await client
      .from("serialNumber")
      .select("id, itemTracking(id, sourceDocument, posted)")
      .eq("id", serialNumberId)
      .eq("itemId", itemId)
      .neq("itemTracking.sourceDocumentLineId", shipmentLineId)
      .eq("companyId", companyId)
      .eq("status", "Available")
      .single();

    if (queryError) {
      return json({ error: "Serial number does not exist" }, { status: 400 });
    }

    // Use a transaction to ensure data consistency
    const { error } = await client.rpc("update_shipment_line_serial_tracking", {
      p_shipment_line_id: shipmentLineId,
      p_shipment_id: shipmentId,
      p_serial_number_id: serialNumberId,
      p_index: index,
    });

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
