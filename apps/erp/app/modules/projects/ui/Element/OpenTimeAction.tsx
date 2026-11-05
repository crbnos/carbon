// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@carbon/react";
import { weekStartOf } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { Link, useLocation } from "react-router";
import { useCompanyToday, usePermissions, useUser } from "~/hooks";
import { useSettings } from "~/hooks/useSettings";
import { path } from "~/utils/path";

/** The fields of a timesheet entry that is not Posted yet. */
type OpenTimeEntry = {
  id: string;
  entryDate: string;
  employeeId: string;
  status: string;
};

/**
 * The one step that moves an entry of "Time not posted yet" on, beside it:
 * an employee submits their own Draft week (posted at once while approval is
 * off), and a project user approves a Submitted entry (approve posts it).
 * Time the weekly certification or a review must handle opens My Time on the
 * entry's week. Another employee's Draft has no step here.
 */
export function OpenTimeAction({ entry }: { entry: OpenTimeEntry }) {
  const { t } = useLingui();
  const user = useUser();
  const permissions = usePermissions();
  const settings = useSettings();
  const today = useCompanyToday();
  const location = useLocation();
  const fetcher = useAction<unknown>({});
  const isBusy = fetcher.state !== "idle";

  const isOwn = entry.employeeId === user.id;
  const isDcaa = settings.timekeepingControls === "DCAA";
  const approvalRequired = settings.timesheetApprovalRequired ?? true;
  const here = `${location.pathname}${location.search}`;

  if (entry.status === "Submitted" && permissions.can("update", "projects")) {
    return (
      <Button
        variant="secondary"
        size="sm"
        isLoading={isBusy}
        isDisabled={isBusy}
        onClick={() =>
          fetcher.submit(
            { intent: "approve", ids: entry.id },
            { method: "post", action: path.to.projectTimesheetApprovals }
          )
        }
      >
        {approvalRequired ? <Trans>Approve</Trans> : <Trans>Post</Trans>}
      </Button>
    );
  }

  if (!isOwn) return null;

  if (entry.status === "Draft" && !isDcaa) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="secondary"
            size="sm"
            isLoading={isBusy}
            isDisabled={isBusy}
            onClick={() =>
              fetcher.submit(
                {
                  from: entry.entryDate,
                  to: entry.entryDate,
                  redirectTo: here
                },
                { method: "post", action: path.to.timesheetSubmit }
              )
            }
          >
            <Trans>Submit week</Trans>
          </Button>
        </TooltipTrigger>
        <TooltipContent className="max-w-72">
          {approvalRequired
            ? t`Submits all your draft time of this week for approval.`
            : t`Submits and posts all your draft time of this week.`}
        </TooltipContent>
      </Tooltip>
    );
  }

  // The certification (DCAA), a review of changes and a rejected entry are
  // handled on My Time, on the entry's week.
  if (
    entry.status === "Draft" ||
    entry.status === "Rejected" ||
    entry.status === "Pending Employee Review"
  ) {
    const weekOffset =
      parseDate(weekStartOf(entry.entryDate)).compare(
        parseDate(weekStartOf(today))
      ) / 7;
    return (
      <Button variant="secondary" size="sm" asChild>
        <Link to={`${path.to.timesheet}?week=${weekOffset}`}>
          <Trans>Open My Time</Trans>
        </Link>
      </Button>
    );
  }

  return null;
}
