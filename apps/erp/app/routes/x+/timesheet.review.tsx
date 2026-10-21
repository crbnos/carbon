// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { timesheetReviewAcceptValidator } from "~/modules/projects/projects.models";
import { acceptTimesheetReview } from "~/modules/projects/projects.service";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "timesheet-review");

/**
 * The signed-in employee accepts the changes another user made to their
 * timesheet (DCAA mode). Each entry returns to Draft with one revision.
 */
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    role: "employee"
  });

  const validation = await validator(timesheetReviewAcceptValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    return data(
      { success: false },
      await flash(request, error(null, "No entries were given"))
    );
  }

  try {
    await acceptTimesheetReview(getDatabaseClient(), {
      companyId,
      employeeId: userId,
      ids: validation.data.ids,
      userId
    });
  } catch (err) {
    logger.error("Failed to accept timesheet changes", {
      companyId,
      error: err
    });
    return data(
      { success: false },
      await flash(
        request,
        error(err, err instanceof Error ? err.message : "Failed to accept")
      )
    );
  }

  return data(
    { success: true },
    await flash(request, success("Changes accepted"))
  );
}
