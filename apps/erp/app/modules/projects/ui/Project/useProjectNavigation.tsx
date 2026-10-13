// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ShortcutInput } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import {
  LuCoins,
  LuFlag,
  LuLayoutDashboard,
  LuLink2,
  LuListTree,
  LuPackage,
  LuReceipt,
  LuSettings2,
  LuTimer
} from "react-icons/lu";
import { useParams } from "react-router";
import { usePermissions } from "~/hooks";
import { PROJECT_TAB_SHORTCUTS } from "~/shortcuts";
import { path } from "~/utils/path";

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
 * Billing also needs the sales permission (contract billing).
 * Settings is returned on its own: the sidebar pins it to the bottom.
 */
export function useProjectSidebarLinks({
  hasBillingLines,
  hasProjectStock,
  hasPegs
}: {
  hasBillingLines: boolean;
  /** The project holds or has held stock of its own (an item ledger row). */
  hasProjectStock: boolean;
  /** The project has a current peg. */
  hasPegs: boolean;
}): { links: ProjectSidebarLink[]; settings: ProjectSidebarLink } {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { projectId } = useParams();
  if (!projectId) throw new Error("projectId not found");
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
    ...(hasProjectStock
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
    ...(hasPegs
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
    ...(hasBillingLines && permissions.can("view", "sales")
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
        pathname.startsWith(path.to.projectSettings(projectId))
    }
  };
}
