import { requirePermissions } from "@carbon/auth/auth.server";
import { json, type ActionFunctionArgs } from "@remix-run/node";
import { nanoid } from "nanoid";

export async function action({ request, context }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    create: "inventory",
  });

  const formData = await request.formData();
  const receiptLineId = formData.get("receiptLineId") as string;
  const receiptId = formData.get("receiptId") as string;
  const itemId = formData.get("itemId") as string;
  const trackingType = formData.get("trackingType") as "lot" | "serial";

  if (trackingType === "lot") {
    const lotNumber = formData.get("lotNumber") as string;
    const manufacturingDate = formData.get("manufacturingDate") as
      | string
      | null;
    const expirationDate = formData.get("expirationDate") as string | null;
    const quantity = Number(formData.get("quantity"));

    // First, get or create the lot number record
    const { data: existingLot, error: lotQueryError } = await client
      .from("lotNumber")
      .select("id")
      .eq("number", lotNumber)
      .eq("itemId", itemId)
      .eq("companyId", companyId)
      .maybeSingle();

    if (lotQueryError) {
      return json({ error: "Failed to query lot number" }, { status: 500 });
    }

    const lotId = existingLot?.id ?? nanoid();

    // Use a transaction to ensure data consistency
    const { error } = await client.rpc("update_receipt_line_lot_tracking", {
      p_receipt_line_id: receiptLineId,
      p_receipt_id: receiptId,
      p_lot_number: lotNumber,
      p_lot_id: lotId,
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

    // Use a transaction to ensure data consistency
    const { error } = await client.rpc("update_receipt_line_serial_tracking", {
      p_receipt_line_id: receiptLineId,
      p_receipt_id: receiptId,
      p_serial_number: serialNumber,
      p_index: index,
    });

    if (error) {
      console.error(error);
      return json({ error: "Failed to update tracking" }, { status: 500 });
    }
  }

  return json({ success: true });
}
