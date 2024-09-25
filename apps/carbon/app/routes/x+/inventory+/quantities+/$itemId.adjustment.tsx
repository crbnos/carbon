import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import {
  insertManualInventoryAdjustment,
  inventoryAdjustmentValidator,
} from "~/modules/inventory";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "inventory",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const formData = await request.formData();
  const validation = await validator(inventoryAdjustmentValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }
  const { ...data } = validation.data;

  const itemLedger = await insertManualInventoryAdjustment(client, {
    ...data,
    companyId,
    createdBy: userId,
  });

  if (itemLedger.error) {
    const flashMessage =
      itemLedger.error === "Insufficient quantity for negative adjustment"
        ? "Insufficient quantity for negative adjustment"
        : "Failed to create manual inventory adjustment";

    throw redirect(
      path.to.inventoryItem(itemId),
      await flash(request, error(itemLedger.error, flashMessage))
    );
  }

  throw redirect(requestReferrer(request) ?? path.to.inventoryItem(itemId));
}
