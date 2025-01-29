import { requirePermissions } from "@carbon/auth/auth.server";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { nanoid } from "nanoid";

export async function action({ request, context }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    create: "inventory",
  });

  const formData = await request.formData();
  const receiptLineId = formData.get("receiptLineId") as string;
  const receiptId = formData.get("receiptId") as string;
  const itemId = formData.get("itemId") as string;
  const trackingType = formData.get("trackingType") as "batch" | "serial";

  if (trackingType === "batch") {
    const batchNumber = formData.get("batchNumber") as string;
    const manufacturingDate = formData.get("manufacturingDate") as
      | string
      | null;
    const expirationDate = formData.get("expirationDate") as string | null;
    const quantity = Number(formData.get("quantity"));

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

    // Use a transaction to ensure data consistency
    const { error } = await client.rpc("update_receipt_line_batch_tracking", {
      p_receipt_line_id: receiptLineId,
      p_receipt_id: receiptId,
      p_batch_number: batchNumber,
      p_batch_id: batchId,
      // @ts-ignore
      p_manufacturing_date: manufacturingDate || null,
      // @ts-ignore
      p_expiration_date: expirationDate || null,
      p_quantity: quantity,
    });

    if (error) {
      console.error(error);
      return json({ error: "Failed to update tracking" }, { status: 500 });
    }
  } else if (trackingType === "serial") {
    const serialNumber = formData.get("serialNumber") as string;
    const index = Number(formData.get("index"));

    // Check if serial number already exists for this item
    const { data: existingSerial, error: queryError } = await client
      .from("serialNumber")
      .select("id, receiptLineTracking(id)")
      .eq("number", serialNumber)
      .eq("itemId", itemId)
      .neq("receiptLineTracking.receiptLineId", receiptLineId)
      .eq("companyId", companyId)
      .maybeSingle();

    if (queryError) {
      return json({ error: "Failed to check serial number" }, { status: 500 });
    }

    if (
      Array.isArray(existingSerial?.receiptLineTracking) &&
      existingSerial?.receiptLineTracking?.length > 0
    ) {
      return json(
        { error: "Serial number already exists for this item" },
        { status: 400 }
      );
    }

    // Use a transaction to ensure data consistency
    const { error } = await client.rpc("update_receipt_line_serial_tracking", {
      p_receipt_line_id: receiptLineId,
      p_receipt_id: receiptId,
      p_serial_number: serialNumber,
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
