// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { timesheetCellValidator } from "~/modules/projects";
import { saveTimesheetEntry } from "~/modules/projects/projects.server";

const logger = getLogger("erp", "project-timesheet-update");

/**
 * Saves one cell of the signed-in user's timesheet through the
 * `save-timesheet-entry` server function. Answers `{ error }`, which the
 * grid cell reads: a refusal reverts the cell and toasts.
 */
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    role: "employee"
  });

  const validation = await validator(timesheetCellValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    const message =
      Object.values(validation.error.fieldErrors)[0] ?? "The hours are invalid";
    return data({ error: { message } }, { status: 400 });
  }

  // The user saves their own time: the server function runs as the system.
  const result = await saveTimesheetEntry({
    ...validation.data,
    companyId,
    employeeId: userId,
    userId
  });

  if (result.error !== null) {
    logger.error("Failed to save a timesheet cell", {
      companyId,
      error: result.error
    });
    return data({ error: { message: result.error } }, { status: 400 });
  }

  return data({ error: null, data: result.data });
}
