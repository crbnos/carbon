// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { LuHistory, LuWorkflow } from "react-icons/lu";
import { usePermissions } from "~/hooks";
import { useSavedViews } from "~/hooks/useSavedViews";
import type { AuthenticatedRouteGroup } from "~/types";
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
          page: "workflows.workflows",
          icon: <LuWorkflow />,
          table: "workflow",
          isActive: (pathname: string) =>
            pathname === path.to.workflows ||
            (pathname.startsWith(`${path.to.workflows}/`) &&
              !pathname.startsWith(`${path.to.workflowRuns}`))
        },
        {
          name: t`Runs`,
          to: path.to.workflowRuns,
          page: "workflows.runs",
          icon: <LuHistory />,
          table: "workflowRun",
          isActive: (pathname: string) =>
            pathname === path.to.workflowRuns ||
            pathname.startsWith(`${path.to.workflowRuns}/`)
        }
      ]
    }
  ];

  const isRouteVisible = (route: AuthenticatedRouteGroup["routes"][number]) =>
    (!route.role || permissions.is(route.role)) &&
    (!route.page || permissions.has({ [route.page]: "View" }));

  return {
    groups: workflowsRoutes
      .filter((group) => {
        const filteredRoutes = group.routes.filter(isRouteVisible);

        return filteredRoutes.length > 0;
      })
      .map((group) => ({
        ...group,
        routes: group.routes.filter(isRouteVisible).map(addSavedViewsToRoutes)
      }))
  };
}
