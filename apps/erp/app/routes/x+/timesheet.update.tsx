// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  timesheetCellValidator,
  upsertTimesheetCell
} from "~/modules/projects";

const logger = getLogger("erp", "project-timesheet-update");

/**
 * Saves one cell of the signed-in user's timesheet. Answers `{ error }`,
 * which the grid cell reads: a refusal reverts the cell and toasts.
 */
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
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

  const result = await upsertTimesheetCell(client, {
    ...validation.data,
    companyId,
    employeeId: userId,
    userId
  });

  if (result.error) {
    logger.error("Failed to save a timesheet cell", {
      companyId,
      error: result.error
    });
    return data(
      {
        error: { message: result.error.message || "Failed to save the hours" }
      },
      { status: 400 }
    );
  }

  return data({ error: null });
}
