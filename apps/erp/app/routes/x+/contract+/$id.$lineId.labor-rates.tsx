// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { EntitlementError } from "@carbon/ee/entitlements.server";
import { contractRateCeilingValidator } from "@carbon/ee/indirect-rates";
import {
  deleteContractRateCeiling,
  upsertContractRateCeiling
} from "@carbon/ee/indirect-rates.server";
import { requireFeature } from "@carbon/ee/plan.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { contractLaborRateValidator } from "~/modules/sales/sales.models";
import {
  deleteContractLaborRate,
  upsertContractLaborRate
} from "~/modules/sales/sales.service";
import { path } from "~/utils/path";

const logger = getLogger("erp", "contract-line-labor-rates");

function failure(message: string) {
  return data({ success: false, error: { message } }, { status: 400 });
}

/** Adds, changes or deletes one bill rate of a Time & Materials line, or one
 *  indirect rate ceiling of a Cost Plus line (intents `ceiling-upsert` and
 *  `ceiling-delete`, GOVERNMENT_CONTRACTING). Both change at any time, also on
 *  an Active contract. */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
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

  if (intent === "ceiling-upsert" || intent === "ceiling-delete") {
    const { id: contractId } = params;
    await requireFeature({
      request,
      client,
      companyId,
      feature: "GOVERNMENT_CONTRACTING",
      redirectTo: contractId
        ? path.to.contractLineBilling(contractId, lineId)
        : path.to.contracts
    });
    try {
      if (intent === "ceiling-delete") {
        const id = formData.get("id");
        if (typeof id !== "string" || !id) {
          return failure("No ceiling was given");
        }
        const deleted = await deleteContractRateCeiling(client, {
          id,
          companyId
        });
        if (deleted.error) {
          logger.error("Failed to delete a contract rate ceiling", {
            companyId,
            lineId,
            error: deleted.error
          });
          return failure("Failed to delete the ceiling");
        }
        return done("Ceiling deleted");
      }

      const validation = await validator(contractRateCeilingValidator).validate(
        formData
      );
      if (validation.error) return invalid(validation.error);
      // The line is the URL's, never the form's copy.
      const saved = await upsertContractRateCeiling(client, {
        ...validation.data,
        customerContractLineId: lineId,
        companyId,
        userId
      });
      if (saved.error) {
        logger.error("Failed to save a contract rate ceiling", {
          companyId,
          lineId,
          error: saved.error
        });
        return failure(
          saved.error.code === "23505"
            ? "This line already has a ceiling for the pool"
            : "Failed to save the ceiling"
        );
      }
      return done("Ceiling saved");
    } catch (err) {
      if (!(err instanceof EntitlementError)) throw err;
      logger.error("Indirect rates are not in the company's plan", {
        companyId
      });
      return failure("Upgrade to use rate ceilings");
    }
  }

  if (intent === "delete") {
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
    return done("Rate deleted");
  }

  const validation = await validator(contractLaborRateValidator).validate(
    formData
  );
  if (validation.error) return invalid(validation.error);

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

  return done("Rate saved");
}
