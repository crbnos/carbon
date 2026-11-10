// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { pageOfUrl } from "@carbon/database/access";
import { useLingui } from "@lingui/react/macro";
import {
  LuBriefcaseBusiness,
  LuClipboardCheck,
  LuFileSpreadsheet,
  LuFolderKanban,
  LuGroup,
  LuTimer
} from "react-icons/lu";
import { useMatches } from "react-router";
import { usePermissions } from "~/hooks";
import { useSavedViews } from "~/hooks/useSavedViews";
import { useSettings } from "~/hooks/useSettings";
import type { AuthenticatedRouteGroup } from "~/types";
import { visibleGroups } from "~/utils/nav";
import { path } from "~/utils/path";

/** The Approvals counts from the projects layouts' loaders, when one is on
 *  screen: submitted time and contract billable items to review. */
function useApprovalCounts() {
  const matches = useMatches();
  for (const match of matches) {
    const data = match.data as
      | { approvalCount?: unknown; billingReviewCount?: unknown }
      | undefined;
    if (data && typeof data.approvalCount === "number") {
      return {
        approvalCount: data.approvalCount,
        billingReviewCount:
          typeof data.billingReviewCount === "number"
            ? data.billingReviewCount
            : 0
      };
    }
  }
  return undefined;
}

export default function useProjectsSubmodules() {
  const { t } = useLingui();
  const permissions = usePermissions();
  const settings = useSettings();
  const { addSavedViewsToRoutes } = useSavedViews();
  const counts = useApprovalCounts();
  const billingReviewCount = counts?.billingReviewCount ?? 0;

  // A DCAA labor transfer always waits for approval, so Approvals shows in
  // DCAA mode even when the company does not require approval of all time.
  // Contract billable items that wait for review also show it.
  const showsTime =
    settings.timesheetApprovalRequired === true ||
    settings.timekeepingControls === "DCAA";
  const showApprovals = showsTime || billingReviewCount > 0;

  const projectsRoutes: AuthenticatedRouteGroup[] = [
    {
      name: t`Manage`,
      routes: [
        {
          name: t`Projects`,
          to: path.to.projects,
          icon: <LuFolderKanban />,
          table: "project"
        },
        {
          name: t`My Time`,
          to: path.to.timesheet,
          icon: <LuTimer />
        },
        ...(showApprovals
          ? [
              {
                name: t`Approvals`,
                // Only billable items wait: open their tab, not an empty
                // Time tab.
                to: showsTime
                  ? path.to.projectTimesheetApprovals
                  : `${path.to.projectTimesheetApprovals}?tab=billing`,
                icon: <LuClipboardCheck />,
                count: counts
                  ? counts.approvalCount + counts.billingReviewCount
                  : undefined,
                // `to` may carry `?tab=`: match the page, not the query.
                isActive: (pathname: string) =>
                  pageOfUrl(pathname) === "projects.approvals"
              }
            ]
          : []),
        {
          name: t`Reports`,
          to: path.to.projectReports,
          icon: <LuFileSpreadsheet />
        }
      ]
    },
    {
      name: t`Configure`,
      routes: [
        {
          name: t`Labor Categories`,
          to: path.to.laborCategories,
          icon: <LuBriefcaseBusiness />
        },
        {
          // Commercial (PLANNING_GROUPS): always listed; a gated company
          // sees the upgrade overlay on the page.
          name: t`Planning Groups`,
          to: path.to.planningGroups,
          icon: <LuGroup />
        }
      ]
    }
  ];

  return {
    groups: visibleGroups(projectsRoutes, permissions).map((group) => ({
      ...group,
      routes: group.routes.map(addSavedViewsToRoutes)
    }))
  };
}
