// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { contractLineFundingValidator } from "~/modules/sales/sales.models";
import { updateContractLineFunding } from "~/modules/sales/sales.service";

const logger = getLogger("erp", "contract-line-funding");

/** Edit Funding: the funded amount and cost, the ceiling and the notice
 *  terms of a billing line, on a Draft or Active contract (plan P9). */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { lineId } = params;
  if (!lineId) throw new Error("Could not find lineId");

  const validation = await validator(contractLineFundingValidator).validate(
    await request.formData()
  );
  if (validation.error) return validationError(validation.error);

  const update = await updateContractLineFunding(client, {
    ...validation.data,
    id: lineId,
    companyId,
    updatedBy: userId
  });
  if (update.error) {
    logger.error("Failed to update a line's funding", {
      companyId,
      lineId,
      error: update.error
    });
    return data(
      {
        success: false,
        error: { message: update.error.message || "Failed to save funding" }
      },
      { status: 400 }
    );
  }

  return data(
    { success: true, error: null },
    await flash(request, success("Funding updated"))
  );
}
