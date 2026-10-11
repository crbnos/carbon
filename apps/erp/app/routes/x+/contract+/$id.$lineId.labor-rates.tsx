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
import {
  contractLaborRateValidator,
  deleteContractLaborRate,
  upsertContractLaborRate
} from "~/modules/sales";

const logger = getLogger("erp", "contract-line-labor-rates");

function failure(message: string) {
  return data({ success: false, error: { message } }, { status: 400 });
}

/** Adds, changes or deletes one bill rate of a Time & Materials line. Rates
 *  change at any time, also on an Active contract. */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { lineId } = params;
  if (!lineId) throw new Error("Could not find lineId");

  const formData = await request.formData();

  if (formData.get("intent") === "delete") {
    const id = formData.get("id");
    if (typeof id !== "string" || !id) return failure("No rate was given");
    const deleted = await deleteContractLaborRate(client, id, companyId);
    if (deleted.error) {
      logger.error("Failed to delete a contract labor rate", {
        companyId,
        lineId,
        error: deleted.error
      });
      return failure("Failed to delete the rate");
    }
    return data(
      { success: true, error: null },
      await flash(request, success("Rate deleted"))
    );
  }

  const validation = await validator(contractLaborRateValidator).validate(
    formData
  );
  if (validation.error) return validationError(validation.error);

  const { id, ...rate } = validation.data;
  // The line is the URL's, never the form's copy.
  const values = { ...rate, customerContractLineId: lineId, companyId };
  const saved = id
    ? await upsertContractLaborRate(client, {
        ...values,
        id,
        updatedBy: userId
      })
    : await upsertContractLaborRate(client, { ...values, createdBy: userId });
  if (saved.error) {
    logger.error("Failed to save a contract labor rate", {
      companyId,
      lineId,
      error: saved.error
    });
    return failure(saved.error.message || "Failed to save the rate");
  }

  return data(
    { success: true, error: null },
    await flash(request, success("Rate saved"))
  );
}
