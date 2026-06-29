import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  getInventoryCount,
  inventoryCountLineValidator,
  updateInventoryCountLine
} from "~/modules/inventory";

// Inline count entry persists one line at a time via a fetcher. Counts are only
// editable while the document is Draft.
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const formData = await request.formData();
  const validation = await validator(inventoryCountLineValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, countedQuantity } = validation.data;

  // Guard: lines can only be edited while the parent count is Draft.
  const line = await client
    .from("inventoryCountLine")
    .select("inventoryCountId")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();

  if (line.error || !line.data) {
    return data({ error: "Line not found" }, { status: 404 });
  }

  const header = await getInventoryCount(
    client,
    line.data.inventoryCountId,
    companyId
  );
  if (header.data?.status !== "Draft") {
    return data(
      { error: "Counts can only be edited while the document is Draft" },
      { status: 409 }
    );
  }

  const update = await updateInventoryCountLine(client, {
    id,
    countedQuantity,
    companyId,
    countedBy: userId
  });

  if (update.error) {
    return data(
      { error: error(update.error, "Failed to update count") },
      { status: 500 }
    );
  }

  return { success: true };
}
