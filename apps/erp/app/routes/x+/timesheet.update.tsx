// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost } from "@carbon/auth";
import { validator } from "@carbon/form";
import { type ActionFunctionArgs, data } from "react-router";
import { timesheetCellValidator } from "~/modules/projects/projects.models";

/**
 * Saves one cell of the signed-in user's timesheet (`saveTimesheetEntry`).
 * Answers `{ error }`, which the grid cell reads: a refusal reverts the cell
 * and toasts. A budget overrun comes back as `warning` and never refuses the
 * entry.
 */
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const validation = await validator(timesheetCellValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    const message =
      Object.values(validation.error.fieldErrors)[0] ?? "The hours are invalid";
    return data({ error: { message } }, { status: 400 });
  }

  const api = await carbon(request);
  const result = await api.projects.saveTimesheetEntry(validation.data);
  if (result.error) {
    return data({ error: { message: result.error.message } }, { status: 400 });
  }

  const { warning, ...saved } = result.data;
  return data({ error: null, data: saved, warning });
}
