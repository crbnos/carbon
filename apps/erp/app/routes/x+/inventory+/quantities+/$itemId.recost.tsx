// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { getErrorMessage } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  recostSerialUnit,
  serialUnitRecostValidator
} from "~/modules/inventory";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "inventory-recost");

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  // Recosting puts a number of the user's own on the books.
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const formData = await request.formData();
  const validation = await validator(serialUnitRecostValidator).validate(
    formData
  );
  if (validation.error) {
    return validationError(validation.error);
  }

  const { offsetAccountId, ...recost } = validation.data;
  const result = await recostSerialUnit(client, getDatabaseClient(), {
    companyId,
    userId,
    ...recost,
    offsetAccountId: offsetAccountId || null
  });

  if (result.error) {
    logger.error("Failed to recost the unit", {
      companyId,
      itemId,
      trackedEntityId: recost.trackedEntityId,
      error: result.error
    });
    return data(
      { success: false },
      await flash(
        request,
        error(result.error, getErrorMessage(result.error, "Failed to recost"))
      )
    );
  }

  return data(
    { success: true },
    await flash(request, success("Unit recosted"))
  );
}
