import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  inventoryCountLineValidator,
  updateInventoryCountLine
} from "~/modules/inventory";
import { getDatabaseClient } from "~/services/database.server";

// Inline count entry persists one line at a time via a fetcher. The Draft-only
// guard is enforced atomically inside `updateInventoryCountLine` (a single
// conditional UPDATE), so there's no read-then-write race with a concurrent
// Confirm.
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
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

  let updated: { id: string } | undefined;
  try {
    updated = await updateInventoryCountLine(getDatabaseClient(), {
      id,
      countedQuantity,
      companyId,
      countedBy: userId
    });
  } catch (err) {
    return data(
      { error: error(err, "Failed to update count") },
      { status: 500 }
    );
  }

  // No row matched: the line doesn't exist or the count is no longer Draft.
  if (!updated) {
    return data(
      { error: "Counts can only be edited while the document is Draft" },
      { status: 409 }
    );
  }

  return { success: true };
}
