// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { LuHistory, LuWorkflow } from "react-icons/lu";
import { usePermissions } from "~/hooks";
import { useSavedViews } from "~/hooks/useSavedViews";
import type { AuthenticatedRouteGroup } from "~/types";
import { visibleGroups } from "~/utils/nav";
import { path } from "~/utils/path";

export default function useWorkflowsSubmodules() {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { addSavedViewsToRoutes } = useSavedViews();

  const workflowsRoutes: AuthenticatedRouteGroup[] = [
    {
      name: t`Automate`,
      routes: [
        {
          name: t`Workflows`,
          to: path.to.workflows,
          icon: <LuWorkflow />,
          table: "workflow"
        },
        {
          name: t`Runs`,
          to: path.to.workflowRuns,
          icon: <LuHistory />,
          table: "workflowRun"
        }
      ]
    }
  ];

  return {
    groups: visibleGroups(workflowsRoutes, permissions).map((group) => ({
      ...group,
      routes: group.routes.map(addSavedViewsToRoutes)
    }))
  };
}
