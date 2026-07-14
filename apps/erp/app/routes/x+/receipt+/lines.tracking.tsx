import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";
import type { TrackedEntityAttributes } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

const logger = getLogger("erp", "receipt", "tracking");

export async function action({ request, context }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    create: "inventory"
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
    const passedTrackedEntityId = formData.get("trackedEntityId") as
      | string
      | null;

    // Resolve the tracked entity id. Prefer the id passed from the form (the
    // existing entity for this receipt line). Fall back to lookup by Receipt
    // Line so a stale batch-number rename never orphans the prior entity.
    let trackedEntityId: string | undefined =
      passedTrackedEntityId ?? undefined;
    if (!trackedEntityId) {
      const { data: existing, error: batchQueryError } = await client
        .from("trackedEntity")
        .select("id")
        .eq("attributes ->> Receipt Line", receiptLineId)
        .eq("companyId", companyId)
        .maybeSingle();

      if (batchQueryError) {
        return data({ error: "Failed to query batch number" }, { status: 500 });
      }
      trackedEntityId = existing?.id;
    }

    let propertiesJson = {};
    try {
      propertiesJson = properties ? JSON.parse(properties) : {};
    } catch (error) {
      logger.error("Failed to parse tracking properties", { error });
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
        p_properties: propertiesJson
      }
    );

    if (error) {
      logger.error("Failed to update batch tracking", { error });
      return data({ error: "Failed to update tracking" }, { status: 500 });
    }
  } else if (trackingType === "serial") {
    const serialNumber = formData.get("serialNumber") as string;
    const index = Number(formData.get("index"));
    const expiryDate = formData.get("expiryDate") as string | null;

    // Check if the serial number is already used for a different receipt line or index
    const { data: existingEntityWithIndex, error: indexQueryError } =
      await client
        .from("trackedEntity")
        .select("*")
        .eq("sourceDocumentId", itemId)
        .eq("readableId", serialNumber)
        .eq("companyId", companyId)
        .maybeSingle();

    if (indexQueryError) {
      return data(
        { error: "Failed to check serial number index" },
        { status: 500 }
      );
    }

    // If the serial number exists but for a different receipt line or index, return an error
    // Only check entities that are serial tracking (have Receipt Line Index attribute)
    if (existingEntityWithIndex) {
      const attributes =
        existingEntityWithIndex.attributes as TrackedEntityAttributes;
      const hasReceiptLineIndex = "Receipt Line Index" in attributes;
      const receiptLineMatches = attributes["Receipt Line"] === receiptLineId;
      const indexMatches = attributes["Receipt Line Index"] === index;

      logger.info("Serial number check", {
        serialNumber,
        existingEntityId: existingEntityWithIndex.id,
        hasReceiptLineIndex,
        existingReceiptLine: attributes["Receipt Line"],
        currentReceiptLine: receiptLineId,
        receiptLineMatches,
        existingIndex: attributes["Receipt Line Index"],
        currentIndex: index,
        indexMatches
      });

      if (hasReceiptLineIndex && (!receiptLineMatches || !indexMatches)) {
        return data(
          {
            error:
              "Serial number is already used for a different item or position"
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
        p_expiry_date: expiryDate || undefined
      }
    );

    if (error) {
      logger.error("Failed to update serial tracking", { error });
      // Check if error is due to unique constraint violation
      if (error.message?.includes("duplicate key value")) {
        return data(
          { error: "Serial number already exists for this item" },
          { status: 400 }
        );
      }
      return data({ error: "Failed to update tracking" }, { status: 500 });
    }
  }

  return { success: true };
}
