// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { submitTimesheetEntries } from "~/modules/projects";
import { postTimesheetEntries } from "~/modules/projects/projects.server";
import { getCompanySettings } from "~/modules/settings";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "project-timesheet-submit");

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Submits the signed-in user's Draft entries of one week. With approvals
 * off they post at once; with approvals on they wait in Approvals.
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
  const back = `${path.to.timesheet}?week=${encodeURIComponent(week)}`;

  if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to)) {
    throw redirect(
      back,
      await flash(request, error(null, "No week was given"))
    );
  }

  let ids: string[];
  try {
    ids = await submitTimesheetEntries(getDatabaseClient(), {
      companyId,
      employeeId: userId,
      from,
      to,
      userId
    });
  } catch (err) {
    logger.error("Failed to submit the timesheet", { companyId, error: err });
    throw redirect(
      back,
      await flash(request, error(err, "Failed to submit the week"))
    );
  }

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
      await flash(request, success("Week submitted for approval"))
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
    await flash(request, success("Week submitted and posted"))
  );
}
