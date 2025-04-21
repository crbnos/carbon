import { LuOctagonX, LuShieldX, LuWorkflow } from "react-icons/lu";
import { usePermissions } from "~/hooks";
import { useSavedViews } from "~/hooks/useSavedViews";
import type { AuthenticatedRouteGroup } from "~/types";
import { path } from "~/utils/path";

const qualityRoutes: AuthenticatedRouteGroup[] = [
  {
    name: "Manage",
    routes: [
      {
        name: "Non-Conformances",
        to: path.to.nonConformances,
        icon: <LuShieldX />,
        table: "nonConformance",
      },
      // {
      //   name: "Inspections",
      //   to: "#",
      //   icon: <LuSearchCheck />,
      //   table: "inspection",
      // },
    ],
  },
  // {
  //   name: "Gauges",
  //   routes: [
  //     {
  //       name: "Gauges",
  //       to: "#",
  //       icon: <LuDraftingCompass />,
  //     },
  //     {
  //       name: "Calibrations",
  //       to: "#",
  //       icon: <LuCircleGauge />,
  //     },
  //   ],
  // },
  {
    name: "Configure",
    routes: [
      {
        name: "NCR Types",
        to: path.to.nonConformanceTypes,
        icon: <LuOctagonX />,
      },
      {
        name: "NCR Workflows",
        to: path.to.nonConformanceWorkflows,
        icon: <LuWorkflow />,
      },
    ],
  },
];
export default function useQualitySubmodules() {
  const permissions = usePermissions();
  const { addSavedViewsToRoutes } = useSavedViews();

  return {
    groups: qualityRoutes
      .filter((group) => {
        const filteredRoutes = group.routes.filter((route) => {
          if (route.role) {
            return permissions.is(route.role);
          } else {
            return true;
          }
        });

        return filteredRoutes.length > 0;
      })
      .map((group) => ({
        ...group,
        routes: group.routes
          .filter((route) => {
            if (route.role) {
              return permissions.is(route.role);
            } else {
              return true;
            }
          })
          .map(addSavedViewsToRoutes),
      })),
  };
}
