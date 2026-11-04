// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost, success } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { customerContractFundingValidator } from "~/modules/sales/sales.models";

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
    const api = await carbon(request);
    const result = await api.sales.deleteContractFunding({ id });
    if (result.error) return failure(result.error.message);
    return done("Funding action deleted");
  }

  if (intent !== "upsert") return failure("Unknown action");

  const validation = await validator(customerContractFundingValidator).validate(
    formData
  );
  if (validation.error) return invalid(validation.error);

  const api = await carbon(request);
  // The line is the URL's, never the form's copy.
  const result = await api.sales.upsertContractFunding({
    ...validation.data,
    customerContractLineId: lineId
  });
  if (result.error) return failure(result.error.message);

  return done("Funding action saved");
}
