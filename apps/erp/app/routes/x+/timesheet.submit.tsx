// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { redirect, weekStartOf } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import {
  postTimesheetEntries,
  submitTimesheetWeek
} from "~/modules/projects/projects.server";
import { getCompanySettings } from "~/modules/settings";
import { path } from "~/utils/path";

const logger = getLogger("erp", "project-timesheet-submit");

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Submits the signed-in user's Draft entries of one week through the
 * `submit-timesheet-week` server function, which also certifies the week in
 * DCAA mode. With approvals off they post at once; with approvals on they
 * wait in Approvals. Each warning (the timecard check) is flashed. It returns
 * to My Time, or to `redirectTo` (the open time list a row submitted from).
 */
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    role: "employee"
  });

  const formData = await request.formData();
  const from = String(formData.get("from") ?? "");
  const to = String(formData.get("to") ?? "");
  const week = String(formData.get("week") ?? "0");
  const certificationText = formData.get("certificationText");
  // A row of "Time not posted yet" submits from its own page and returns
  // there. `redirect` stays on this origin, whatever the value.
  const redirectTo = formData.get("redirectTo");
  const back =
    typeof redirectTo === "string" && redirectTo
      ? redirectTo
      : `${path.to.timesheet}?week=${encodeURIComponent(week)}`;

  if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to)) {
    throw redirect(
      back,
      await flash(request, error(null, "No week was given"))
    );
  }

  // The user submits their own week: the server function runs as the system.
  const submitted = await submitTimesheetWeek({
    employeeId: userId,
    weekStart: weekStartOf(from),
    certificationText:
      typeof certificationText === "string" && certificationText
        ? certificationText
        : undefined,
    companyId,
    userId
  });
  if (submitted.error !== null) {
    logger.error("Failed to submit the timesheet", {
      companyId,
      error: submitted.error
    });
    throw redirect(back, await flash(request, error(null, submitted.error)));
  }
  const { entryIds: ids, warnings } = submitted.data;
  // A warning does not stop the week; the flash names it after the outcome.
  const withWarnings = (message: string) =>
    warnings.length > 0 ? `${message}. ${warnings.join(". ")}` : message;

  if (ids.length === 0) {
    throw redirect(
      back,
      await flash(
        request,
        error(null, "This week has no draft hours to submit")
      )
    );
  }

  const settings = await getCompanySettings(client, companyId);
  if (settings.error) {
    logger.error("Failed to load company settings", {
      companyId,
      error: settings.error
    });
  }
  if (settings.data?.timesheetApprovalRequired ?? true) {
    throw redirect(
      back,
      await flash(request, success(withWarnings("Week submitted for approval")))
    );
  }

  const postingError = await postTimesheetEntries({
    timesheetEntryIds: ids,
    companyId,
    userId
  });
  if (postingError) {
    throw redirect(
      back,
      await flash(
        request,
        error(null, `The week is submitted but did not post: ${postingError}`)
      )
    );
  }

  throw redirect(
    back,
    await flash(request, success(withWarnings("Week submitted and posted")))
  );
}
