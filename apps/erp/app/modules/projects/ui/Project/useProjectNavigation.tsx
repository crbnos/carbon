// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import {
  LuCoins,
  LuFileText,
  LuFlag,
  LuHistory,
  LuListTree,
  LuSettings2,
  LuTimer
} from "react-icons/lu";
import { useParams } from "react-router";
import { PROJECT_TAB_SHORTCUTS } from "~/shortcuts";
import { path } from "~/utils/path";

export function useProjectNavigation() {
  const { t } = useLingui();
  const { projectId } = useParams();
  if (!projectId) throw new Error("projectId not found");

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
