// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Status } from "@carbon/react";
import { TIMESHEET_ENTRY_STATUS_COLOR_MAP } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { TimesheetEntryStatus as TimesheetEntryStatusType } from "../../projects.models";

export function TimesheetEntryStatus({
  status,
  iconOnly
}: {
  status?: TimesheetEntryStatusType | null;
  /** The icon alone, with the label in its tooltip, for a grid cell. */
  iconOnly?: boolean;
}) {
  const { t } = useLingui();
  if (!status) return null;
  const labels: Record<TimesheetEntryStatusType, string> = {
    Draft: t`Draft`,
    Submitted: t`Submitted`,
    Approved: t`Approved`,
    Posted: t`Posted`,
    Rejected: t`Rejected`,
    "Pending Employee Review": t`Pending Employee Review`
  };
  return (
    <Status
      color={TIMESHEET_ENTRY_STATUS_COLOR_MAP[status] ?? "gray"}
      iconOnly={iconOnly}
    >
      {labels[status] ?? status}
    </Status>
  );
}
