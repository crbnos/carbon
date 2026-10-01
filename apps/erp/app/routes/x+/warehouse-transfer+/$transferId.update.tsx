// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { updateWarehouseTransferStatus } from "~/modules/inventory";
import { warehouseTransferStatusType } from "~/modules/inventory/inventory.models";

const updateStatusValidator = z.object({
  status: z.enum(warehouseTransferStatusType)
});

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const { transferId } = params;
  if (!transferId) throw new Error("transferId not found");

  const formData = await request.formData();
  const validation = await validator(updateStatusValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const result = await updateWarehouseTransferStatus(
    client,
    transferId,
    validation.data.status,
    userId
  );

  if (result.error) {
    return data(
      { error: result.error },
      await flash(
        request,
        error(result.error, "Failed to update warehouse transfer status")
      )
    );
  }

  return data(
    { success: true },
    await flash(request, success("Updated warehouse transfer status"))
  );
}
