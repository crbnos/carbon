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
  saveTimesheetEntry
} from "~/modules/projects/projects.server";
import { getCompanySettings } from "~/modules/settings";

const logger = getLogger("erp", "project-log-time");

/**
 * Logs time for the signed-in user from the element page, as a new entry
 * through `save-timesheet-entry` (`add` mode, so DCAA mode applies its
 * controls). The entry is Submitted. With approvals off it posts at once; with approvals on it
 * waits in Approvals. A posting refusal is returned as fetcher data, so the
 * modal shows it and stays open.
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

  if (settings.data.timesheetApprovalRequired) {
    return data(
      { success: true, error: null },
      await flash(request, success("Time submitted for approval"))
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
    { success: true, error: null },
    await flash(request, success("Time logged"))
  );
}
