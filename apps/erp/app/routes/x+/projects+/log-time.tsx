// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost, error, success } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { type ActionFunctionArgs, data } from "react-router";
import { logTimeValidator } from "~/modules/projects/projects.models";

/**
 * Logs time for the signed-in user from the element page, as a new entry
 * (`logTimesheetEntry`). In Standard mode the entry is Submitted: with
 * approvals off it posts at once, with approvals on it waits in Approvals. In
 * DCAA mode the entry is Draft and waits for the weekly certification on My
 * Time. A refusal is returned as fetcher data, so the modal shows it and
 * stays open.
 */
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const validation = await validator(logTimeValidator).validate(
    await request.formData()
  );
  if (validation.error) return validationError(validation.error);

  const api = await carbon(request);
  const result = await api.projects.logTimesheetEntry(validation.data);
  if (result.error) {
    return data({
      success: false,
      error: { message: result.error.message }
    });
  }

  // Budget control (Government Contracting 5c): a timesheet only warns
  // (DCAAM 7641.90). The warning goes back as fetcher data and in the flash.
  const { outcome, warning, postingError } = result.data;
  const note = warning ? ` ${warning}` : "";

  if (outcome === "saved") {
    return data(
      { success: true, error: null, warning },
      await flash(
        request,
        success(`Time saved. Submit your week on My Time to certify it.${note}`)
      )
    );
  }

  if (outcome === "submitted") {
    return data(
      { success: true, error: null, warning },
      await flash(
        request,
        success(
          warning
            ? `Time submitted for approval.${note}`
            : "Time submitted for approval"
        )
      )
    );
  }

  if (postingError) {
    return data(
      {
        success: false,
        error: {
          message: `The time is logged but did not post: ${postingError}`
        }
      },
      await flash(request, error(null, postingError))
    );
  }

  return data(
    { success: true, error: null, warning },
    await flash(
      request,
      success(warning ? `Time logged.${note}` : "Time logged")
    )
  );
}
