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
  customerContractFundingValidator,
  deleteContractFunding,
  upsertContractFunding
} from "~/modules/sales";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "contract-line-funding-actions");

function failure(message: string) {
  return data({ success: false, error: { message } }, { status: 400 });
}

/**
 * Adds, changes or deletes one funding action (a contract modification) of a
 * billing line, then writes the line's funded totals. A funding modification
 * is not a term change, so it is accepted on an Active contract as well as a
 * Draft one.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { lineId } = params;
  if (!lineId) throw new Error("Could not find lineId");

  const formData = await request.formData();
  const intent = formData.get("intent");
  // A grid cell posts `quiet` and reads `{ error }` instead of a flash.
  const quiet = formData.get("quiet") === "true";
  const invalid = (validation: Parameters<typeof validationError>[0]) =>
    quiet
      ? failure(
          Object.values(validation.fieldErrors ?? {})[0] ?? "Invalid values"
        )
      : validationError(validation);
  const done = async (message: string) =>
    quiet
      ? data({ success: true, error: null })
      : data(
          { success: true, error: null },
          await flash(request, success(message))
        );

  if (intent === "delete") {
    const id = formData.get("id");
    if (typeof id !== "string" || !id) {
      return failure("No funding action was given");
    }
    try {
      await deleteContractFunding(getDatabaseClient(), {
        id,
        companyId,
        userId
      });
    } catch (err) {
      logger.error("Failed to delete a contract funding action", {
        companyId,
        lineId,
        error: err
      });
      return failure(
        err instanceof Error
          ? err.message
          : "Failed to delete the funding action"
      );
    }
    return done("Funding action deleted");
  }

  if (intent !== "upsert") return failure("Unknown action");

  const validation = await validator(customerContractFundingValidator).validate(
    formData
  );
  if (validation.error) return invalid(validation.error);

  try {
    // The line is the URL's, never the form's copy.
    await upsertContractFunding(getDatabaseClient(), {
      ...validation.data,
      customerContractLineId: lineId,
      companyId,
      userId
    });
  } catch (err) {
    logger.error("Failed to save a contract funding action", {
      companyId,
      lineId,
      error: err
    });
    return failure(
      err instanceof Error ? err.message : "Failed to save the funding action"
    );
  }

  return done("Funding action saved");
}
