// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost, error, success } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { timesheetReviewAcceptValidator } from "~/modules/projects/projects.models";

/**
 * The signed-in employee accepts the changes another user made to their
 * timesheet (DCAA mode, `acceptTimesheetReview`). Each entry returns to Draft
 * with one revision.
 */
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const validation = await validator(timesheetReviewAcceptValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    return data(
      { success: false },
      await flash(request, error(null, "No entries were given"))
    );
  }

  const api = await carbon(request);
  const result = await api.projects.acceptTimesheetReview(validation.data);
  if (result.error) {
    return data(
      { success: false },
      await flash(request, error(null, result.error.message))
    );
  }

  return data(
    { success: true },
    await flash(request, success("Changes accepted"))
  );
}
