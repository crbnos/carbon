// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost, error, success } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { type ActionFunctionArgs, data } from "react-router";
import { timesheetCorrectionValidator } from "~/modules/projects/projects.models";

/**
 * Corrects one of the signed-in user's posted entries
 * (`createTimesheetCorrection`): a reversal of the posted hours and the new
 * hours, both Submitted. The new hours can move to another charge number and
 * labor category (a labor transfer). With approvals off both post at once,
 * except a labor transfer in DCAA mode, which always waits for another user's
 * approval. A refusal is returned as fetcher data, so the modal shows it.
 */
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const validation = await validator(timesheetCorrectionValidator).validate(
    await request.formData()
  );
  if (validation.error) return validationError(validation.error);

  const api = await carbon(request);
  const result = await api.projects.createTimesheetCorrection(validation.data);
  if (result.error) {
    return data({
      success: false,
      error: { message: result.error.message }
    });
  }

  const { outcome, postingError } = result.data;
  if (outcome === "transferAwaitingApproval") {
    return data(
      { success: true, error: null },
      await flash(request, success("The transfer waits for approval"))
    );
  }
  if (outcome === "awaitingApproval") {
    return data(
      { success: true, error: null },
      await flash(request, success("Correction submitted for approval"))
    );
  }
  if (postingError) {
    return data(
      {
        success: false,
        error: {
          message: `The correction is submitted but did not post: ${postingError}`
        }
      },
      await flash(request, error(null, postingError))
    );
  }

  return data(
    { success: true, error: null },
    await flash(request, success("Correction posted"))
  );
}
