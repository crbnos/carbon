import { useLingui } from "@lingui/react/macro";
import { LuWorkflow } from "react-icons/lu";
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
          icon: <LuWorkflow />,
          table: "workflow"
        }
      ]
    }
  ];

  return {
    groups: workflowsRoutes
      .filter((group) => {
        const filteredRoutes = group.routes.filter((route) =>
          route.role ? permissions.is(route.role) : true
        );

        return filteredRoutes.length > 0;
      })
      .map((group) => ({
        ...group,
        routes: group.routes
          .filter((route) => (route.role ? permissions.is(route.role) : true))
          .map(addSavedViewsToRoutes)
      }))
  };
}
