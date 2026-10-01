// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
    const flashMessage =
      itemLedger.error.message ===
      "Insufficient quantity for negative adjustment"
        ? "Insufficient quantity for negative adjustment"
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
