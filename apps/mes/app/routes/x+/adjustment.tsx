import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import {
  insertManualInventoryAdjustment,
  inventoryAdjustmentValidator
} from "~/services/inventory.service";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {});
  const serviceRole = await getCarbonServiceRole();

  const formData = await request.formData();
  const validation = await validator(inventoryAdjustmentValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }
  const { ...d } = validation.data;

  const itemLedger = await insertManualInventoryAdjustment(serviceRole, {
    ...d,
    companyId,
    createdBy: userId
  });

  if (itemLedger.error) {
    // Same passthrough set as the ERP adjustment route — these are business
    // validations the operator can act on, not internal failures.
    const flashMessage = [
      "Insufficient quantity for negative adjustment",
      "Serial number not found",
      "Batch number not found",
      "Tracked entity not found",
      "Multiple tracked entities in this storage unit — select a specific row to adjust"
    ].includes(itemLedger.error.message)
      ? itemLedger.error.message
      : "Failed to create manual inventory adjustment";

    return {
      success: false,
      message: flashMessage
    };
  }

  return {
    success: true
  };
}
