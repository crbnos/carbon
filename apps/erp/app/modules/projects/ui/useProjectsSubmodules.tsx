// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import {
  LuArrowLeftRight,
  LuBriefcaseBusiness,
  LuClipboardCheck,
  LuFolderKanban,
  LuGroup,
  LuTimer
} from "react-icons/lu";
import { usePermissions } from "~/hooks";
import { useSavedViews } from "~/hooks/useSavedViews";
import { useSettings } from "~/hooks/useSettings";
import type { AuthenticatedRouteGroup } from "~/types";
import { path } from "~/utils/path";

// The Projects route owns every page under /x/projects except the module's
// other submodules, plus the project workspace under /x/project.
const otherProjectsRoutes = [
  path.to.projectTimesheetApprovals,
  path.to.projectStockTransfers,
  path.to.laborCategories,
  path.to.planningGroups
];

function isProjectsRoute(pathname: string) {
  if (pathname.startsWith(path.to.project(""))) return true;
  if (pathname === path.to.projects) return true;
  return (
    pathname.startsWith(`${path.to.projects}/`) &&
    !otherProjectsRoutes.some((route) => pathname.startsWith(route))
  );
}

export default function useProjectsSubmodules() {
  const { t } = useLingui();
  const permissions = usePermissions();
  const settings = useSettings();
  const { addSavedViewsToRoutes } = useSavedViews();

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
          name: t`My Timesheet`,
          to: path.to.timesheet,
          icon: <LuTimer />,
          isActive: (pathname: string) => pathname.startsWith(path.to.timesheet)
        },
        {
          name: t`Transfers`,
          to: path.to.projectStockTransfers,
          icon: <LuArrowLeftRight />,
          isActive: (pathname: string) =>
            pathname.startsWith(path.to.projectStockTransfers) ||
            pathname.startsWith(path.to.projectStockTransfer(""))
        },
        {
          name: t`Approvals`,
          to: path.to.projectTimesheetApprovals,
          icon: <LuClipboardCheck />,
          setting: "timesheetApprovalRequired",
          isActive: (pathname: string) =>
            pathname.startsWith(path.to.projectTimesheetApprovals)
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
          role: "employee"
        },
        {
          // Commercial (PLANNING_GROUPS): always listed; a gated company
          // sees the upgrade overlay on the page.
          name: t`Planning Groups`,
          to: path.to.planningGroups,
          icon: <LuGroup />,
          role: "employee"
        }
      ]
    }
  ];

  const isVisible = (route: AuthenticatedRouteGroup["routes"][number]) =>
    (route.role ? permissions.is(route.role) : true) &&
    (!route.setting ||
      settings[route.setting as keyof typeof settings] === true);

  return {
    groups: projectsRoutes
      .filter((group) => group.routes.some(isVisible))
      .map((group) => ({
        ...group,
        routes: group.routes.filter(isVisible).map(addSavedViewsToRoutes)
      }))
  };
}
