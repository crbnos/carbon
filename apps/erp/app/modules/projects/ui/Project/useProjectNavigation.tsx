// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ShortcutInput } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import {
  LuCoins,
  LuFileText,
  LuFlag,
  LuGitPullRequestArrow,
  LuHistory,
  LuLayoutDashboard,
  LuLink2,
  LuListTree,
  LuPackage,
  LuReceipt,
  LuSettings2,
  LuTimer
} from "react-icons/lu";
import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import { PROJECT_TAB_SHORTCUTS } from "~/shortcuts";
import { path } from "~/utils/path";
import type { Project } from "../../types";

export function useProjectNavigation() {
  const { t } = useLingui();
  const { projectId } = useParams();
  if (!projectId) throw new Error("projectId not found");
  const routeData = useRouteData<{ project: Project }>(
    path.to.project(projectId)
  );
  // The Stock tab shows for a project that keeps project stock.
  const hasProjectStock = routeData?.project?.projectStock === true;
  // The Pegging tab shows for a member of a planning group. A company without
  // PLANNING_GROUPS still sees it, with the upgrade overlay.
  const isGroupMember = Boolean(routeData?.project?.planningGroupId);
  // The Billing tab shows for a Contract project: only its cost bills a
  // customer contract line.
  const billsContract = routeData?.project?.costTreatment === "Contract";

  return [
    {
      name: t`Elements`,
      to: path.to.projectElements(projectId),
      icon: LuListTree,
      shortcut: PROJECT_TAB_SHORTCUTS.elements,
      isActive: (pathname: string) =>
        pathname.startsWith(path.to.projectElements(projectId)) ||
        pathname.startsWith(`${path.to.project(projectId)}/element/`)
    },
    {
      name: t`Milestones`,
      to: path.to.projectMilestones(projectId),
      icon: LuFlag,
      shortcut: PROJECT_TAB_SHORTCUTS.milestones
    },
    {
      name: t`Baselines`,
      to: path.to.projectBaselines(projectId),
      icon: LuHistory,
      shortcut: PROJECT_TAB_SHORTCUTS.baselines
    },
    {
      name: t`Change requests`,
      to: path.to.projectChangeRequests(projectId),
      icon: LuGitPullRequestArrow,
      shortcut: PROJECT_TAB_SHORTCUTS.changeRequests
    },
    {
      name: t`Costs`,
      to: path.to.projectCosts(projectId),
      icon: LuCoins,
      shortcut: PROJECT_TAB_SHORTCUTS.costs
    },
    {
      name: t`Time & materials`,
      to: path.to.projectTime(projectId),
      icon: LuTimer,
      shortcut: PROJECT_TAB_SHORTCUTS.time
    },
    ...(billsContract
      ? [
          {
            name: t`Billing`,
            to: path.to.projectBilling(projectId),
            icon: LuReceipt,
            shortcut: PROJECT_TAB_SHORTCUTS.billing
          }
        ]
      : []),
    ...(hasProjectStock
      ? [
          {
            name: t`Stock`,
            to: path.to.projectStock(projectId),
            icon: LuPackage,
            shortcut: PROJECT_TAB_SHORTCUTS.stock
          }
        ]
      : []),
    ...(isGroupMember
      ? [
          {
            name: t`Pegging`,
            to: path.to.projectPegging(projectId),
            icon: LuLink2,
            shortcut: PROJECT_TAB_SHORTCUTS.pegging
          }
        ]
      : []),
    {
      name: t`Settings`,
      to: path.to.projectSettings(projectId),
      icon: LuSettings2,
      shortcut: PROJECT_TAB_SHORTCUTS.settings
    },
    {
      name: t`Details`,
      to: path.to.projectDetails(projectId),
      icon: LuFileText,
      shortcut: PROJECT_TAB_SHORTCUTS.details
    }
  ];
}

export type ProjectSidebarLink = {
  name: string;
  to: string;
  icon: ReactNode;
  shortcut?: ShortcutInput;
  isActive?: (pathname: string) => boolean;
  indent?: boolean;
};

/**
 * The project sidebar's page links (Layer 2): Overview, Plan, Schedule,
 * Costs with Stock, Pegging and Billing under it when they apply, and Time.
 * Settings is returned on its own: the sidebar pins it to the bottom.
 */
export function useProjectSidebarLinks({
  hasBillingLines
}: {
  hasBillingLines: boolean;
}): { links: ProjectSidebarLink[]; settings: ProjectSidebarLink } {
  const { t } = useLingui();
  const { projectId } = useParams();
  if (!projectId) throw new Error("projectId not found");
  const routeData = useRouteData<{ project: Project }>(
    path.to.project(projectId)
  );
  const project = routeData?.project;
  const overview = path.to.project(projectId);

  const links: ProjectSidebarLink[] = [
    {
      name: t`Overview`,
      to: overview,
      icon: <LuLayoutDashboard />,
      isActive: (pathname) => pathname === overview
    },
    {
      name: t`Plan`,
      to: path.to.projectElements(projectId),
      icon: <LuListTree />,
      shortcut: PROJECT_TAB_SHORTCUTS.elements,
      isActive: (pathname) =>
        pathname.startsWith(path.to.projectElements(projectId)) ||
        pathname.startsWith(`${overview}/element/`)
    },
    {
      name: t`Schedule`,
      to: path.to.projectMilestones(projectId),
      icon: <LuFlag />,
      shortcut: PROJECT_TAB_SHORTCUTS.milestones
    },
    {
      name: t`Costs`,
      to: path.to.projectCosts(projectId),
      icon: <LuCoins />,
      shortcut: PROJECT_TAB_SHORTCUTS.costs
    },
    // Under Costs, each only while it applies (Layer 5).
    ...(project?.projectStock
      ? [
          {
            name: t`Stock`,
            to: path.to.projectStock(projectId),
            icon: <LuPackage />,
            shortcut: PROJECT_TAB_SHORTCUTS.stock,
            indent: true
          }
        ]
      : []),
    ...(project?.planningGroupId
      ? [
          {
            name: t`Pegging`,
            to: path.to.projectPegging(projectId),
            icon: <LuLink2 />,
            shortcut: PROJECT_TAB_SHORTCUTS.pegging,
            indent: true
          }
        ]
      : []),
    ...(hasBillingLines
      ? [
          {
            name: t`Billing`,
            to: path.to.projectBilling(projectId),
            icon: <LuReceipt />,
            shortcut: PROJECT_TAB_SHORTCUTS.billing,
            indent: true
          }
        ]
      : []),
    {
      name: t`Time`,
      to: path.to.projectTime(projectId),
      icon: <LuTimer />,
      shortcut: PROJECT_TAB_SHORTCUTS.time
    }
  ];

  return {
    links,
    settings: {
      name: t`Settings`,
      to: path.to.projectSettings(projectId),
      icon: <LuSettings2 />,
      shortcut: PROJECT_TAB_SHORTCUTS.settings,
      isActive: (pathname) =>
        pathname.startsWith(path.to.projectSettings(projectId)) ||
        pathname.startsWith(path.to.projectDetails(projectId))
    }
  };
}
