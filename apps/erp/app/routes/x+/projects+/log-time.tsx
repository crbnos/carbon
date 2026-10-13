// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { logTimeValidator } from "~/modules/projects";
import {
  postTimesheetEntries,
  saveTimesheetEntry,
  timesheetBudgetWarning
} from "~/modules/projects/projects.server";
import { getCompanySettings } from "~/modules/settings";

const logger = getLogger("erp", "project-log-time");

/**
 * Logs time for the signed-in user from the element page, as a new entry
 * through `save-timesheet-entry` (`add` mode, so DCAA mode applies its
 * controls). In Standard mode the entry is Submitted: with approvals off it
 * posts at once, with approvals on it waits in Approvals. In DCAA mode the
 * entry is Draft and waits for the weekly certification on My Time. A
 * refusal is returned as fetcher data, so the modal shows it and stays open.
 */
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    role: "employee"
  });

  const validation = await validator(logTimeValidator).validate(
    await request.formData()
  );
  if (validation.error) return validationError(validation.error);

  const settings = await getCompanySettings(client, companyId);
  if (settings.error) {
    logger.error("Failed to load company settings", {
      companyId,
      error: settings.error
    });
    return data({
      success: false,
      error: { message: "Failed to load the company settings" }
    });
  }

  // The user logs their own time: the server function runs as the system.
  const saved = await saveTimesheetEntry({
    ...validation.data,
    mode: "add",
    status: "Submitted",
    companyId,
    employeeId: userId,
    userId
  });
  if (saved.error !== null || !saved.data.entryId) {
    logger.error("Failed to log time", { companyId, error: saved.error });
    return data({
      success: false,
      error: { message: saved.error ?? "Failed to log the time" }
    });
  }
  const entryId = saved.data.entryId;

  // Budget control (Government Contracting 5c): a timesheet only warns
  // (DCAAM 7641.90). The warning goes back as fetcher data and in the flash.
  const warning = await timesheetBudgetWarning(client, {
    ...validation.data,
    companyId
  });
  const note = warning ? ` ${warning}` : "";

  // DCAA mode: the entry is Draft until the employee certifies the week.
  if (saved.data.status !== "Submitted") {
    return data(
      { success: true, error: null, warning },
      await flash(
        request,
        success(`Time saved. Submit your week on My Time to certify it.${note}`)
      )
    );
  }

  if (settings.data.timesheetApprovalRequired) {
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

  const postingError = await postTimesheetEntries({
    timesheetEntryIds: [entryId],
    companyId,
    userId
  });
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
