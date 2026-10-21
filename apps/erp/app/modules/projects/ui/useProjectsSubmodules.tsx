// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
import { path } from "~/utils/path";

// `generatePath` drops a trailing slash, so `path.to.project("")` is
// "/x/project" — a prefix of "/x/projects" too, which lit Projects on every
// page of the module. These are the literal record prefixes.
const projectRecordPrefix = `${path.to.projects.replace(/s$/, "")}/`;
const stockTransferRecordPrefix = path.to
  .projectStockTransfer("x")
  .replace(/x$/, "");

// The Projects entry owns every page under /x/projects except the module's
// other entries, plus the project workspace and the stock transfers (a
// transfer opens from a project's Stock page).
const otherProjectsRoutes = [
  path.to.projectsBilling,
  path.to.projectTimesheetApprovals,
  path.to.projectReports,
  path.to.laborCategories,
  path.to.planningGroups
];

function isProjectsRoute(pathname: string) {
  if (pathname.startsWith(projectRecordPrefix)) return true;
  if (pathname.startsWith(stockTransferRecordPrefix)) return true;
  if (pathname === path.to.projects) return true;
  return (
    pathname.startsWith(`${path.to.projects}/`) &&
    !otherProjectsRoutes.some((route) => pathname.startsWith(route))
  );
}

/** The Approvals count from the projects layouts' loaders, when one is on screen. */
function useApprovalCount() {
  const matches = useMatches();
  for (const match of matches) {
    const data = match.data as { approvalCount?: unknown } | undefined;
    if (data && typeof data.approvalCount === "number") {
      return data.approvalCount;
    }
  }
  return undefined;
}

export default function useProjectsSubmodules() {
  const { t } = useLingui();
  const permissions = usePermissions();
  const settings = useSettings();
  const { addSavedViewsToRoutes } = useSavedViews();
  const approvalCount = useApprovalCount();

  // A DCAA labor transfer always waits for approval, so Approvals shows in
  // DCAA mode even when the company does not require approval of all time.
  const showApprovals =
    settings.timesheetApprovalRequired === true ||
    settings.timekeepingControls === "DCAA";

  const projectsRoutes: AuthenticatedRouteGroup[] = [
    {
      name: t`Manage`,
      routes: [
        {
          name: t`Projects`,
          to: path.to.projects,
          icon: <LuFolderKanban />,
          table: "project",
          isActive: isProjectsRoute
        },
        {
          name: t`My Time`,
          to: path.to.timesheet,
          icon: <LuTimer />,
          isActive: (pathname: string) => pathname.startsWith(path.to.timesheet)
        },
        ...(showApprovals
          ? [
              {
                name: t`Approvals`,
                to: path.to.projectTimesheetApprovals,
                icon: <LuClipboardCheck />,
                count: approvalCount,
                // Billing review joins Approvals (it is a review queue too).
                isActive: (pathname: string) =>
                  pathname.startsWith(path.to.projectTimesheetApprovals) ||
                  pathname.startsWith(path.to.projectsBilling)
              }
            ]
          : []),
        {
          name: t`Reports`,
          to: path.to.projectReports,
          icon: <LuFileSpreadsheet />,
          role: "employee",
          isActive: (pathname: string) =>
            pathname.startsWith(path.to.projectReports)
        }
      ]
    },
    {
      name: t`Configure`,
      routes: [
        {
          name: t`Labor Categories`,
          to: path.to.laborCategories,
          icon: <LuBriefcaseBusiness />,
          role: "employee",
          isActive: (pathname: string) =>
            pathname.startsWith(path.to.laborCategories)
        },
        {
          // Commercial (PLANNING_GROUPS): always listed; a gated company
          // sees the upgrade overlay on the page.
          name: t`Planning Groups`,
          to: path.to.planningGroups,
          icon: <LuGroup />,
          role: "employee",
          isActive: (pathname: string) =>
            pathname.startsWith(path.to.planningGroups)
        }
      ]
    }
  ];

  const isVisible = (route: AuthenticatedRouteGroup["routes"][number]) =>
    route.role ? permissions.is(route.role) : true;

  return {
    groups: projectsRoutes
      .filter((group) => group.routes.some(isVisible))
      .map((group) => ({
        ...group,
        routes: group.routes.filter(isVisible).map(addSavedViewsToRoutes)
      }))
  };
}
