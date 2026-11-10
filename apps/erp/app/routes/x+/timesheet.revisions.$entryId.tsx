// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { holdsGate } from "@carbon/database/access";
import { getLogger } from "@carbon/logger";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getTimesheetRevisions } from "~/modules/projects/projects.service";

const logger = getLogger("erp", "timesheet-revisions");

/**
 * The correction trail of one timesheet entry, oldest first, for the cell's
 * history popover. The employee reads their own entries; a user with View
 * on Projects or on Approvals reads any entry of the company.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId, permissions } = await authorize(
    request,
    {}
  );
  const { entryId } = params;
  if (!entryId) throw new Error("Could not find entryId");

  const revisions = await getTimesheetRevisions(client, {
    companyId,
    timesheetEntryId: entryId
  });
  if (revisions.error) {
    logger.error("Failed to load the timesheet revisions", {
      companyId,
      entryId,
      error: revisions.error
    });
    return data(
      { revisions: [], error: "Failed to load the changes" },
      { status: 500 }
    );
  }

  // A revision outlives its entry (no foreign key), so the owner is read
  // from the revision itself.
  const ownsEntry = revisions.data.every((row) => row.employeeId === userId);
  if (!ownsEntry) {
    const canViewProjects = holdsGate(
      permissions,
      [{ "projects.projects": "View" }, { "projects.approvals": "View" }],
      companyId
    );
    if (!canViewProjects) {
      logger.warn("Refused the revisions of another user's entry", {
        companyId,
        entryId
      });
      return data(
        {
          revisions: [],
          error: "You can see the changes to your own time only"
        },
        { status: 403 }
      );
    }
  }

  return { revisions: revisions.data, error: null };
}
