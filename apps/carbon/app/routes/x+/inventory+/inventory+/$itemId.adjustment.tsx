import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import {
  insertManualInventoryAdjustment,
  inventoryAdjustmentValidator,
} from "~/modules/inventory";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    update: "inventory",
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
  });

  if (itemLedger.error) {
    const flashMessage = "Failed to create manual inventory adjustment";

    throw redirect(
      path.to.partSales(itemId),
      await flash(request, error(itemLedger.error, flashMessage))
    );
  }

  throw redirect(path.to.inventoryItem(itemId));
}
