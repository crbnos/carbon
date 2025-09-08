import {
  LuChartLine,
  LuHardHat,
  LuListChecks,
  LuSquareChartGantt,
  LuSquareKanban,
  LuTrash,
} from "react-icons/lu";
import { usePermissions } from "~/hooks";
import { useSavedViews } from "~/hooks/useSavedViews";
import type { AuthenticatedRouteGroup } from "~/types";
import { path } from "~/utils/path";

const productionRoutes: AuthenticatedRouteGroup[] = [
  {
    name: "Manage",
    routes: [
      {
        name: "Jobs",
        to: path.to.jobs,
        icon: <LuHardHat />,
        table: "job",
      },
    ],
  },
  {
    name: "Plan",
    routes: [
      {
        name: "Forecasts",
        to: path.to.demandForecasts,
        icon: <LuChartLine />,
        table: "demand-forecast",
      },
      {
        name: "Planning",
        to: path.to.productionPlanning,
        icon: <LuSquareChartGantt />,
        table: "production-planning",
      },

      {
        name: "Schedule",
        to: path.to.schedule,
        icon: <LuSquareKanban />,
      },
    ],
  },
  {
    name: "Configure",
    routes: [
      {
        name: "Procedures",
        to: path.to.procedures,
        icon: <LuListChecks />,
        table: "procedure",
        role: "employee",
      },
      {
        name: "Scrap Reasons",
        to: path.to.scrapReasons,
        role: "employee",
        icon: <LuTrash />,
      },
    ],
  },
];

export default function useProductionSubmodules() {
  const permissions = usePermissions();
  const { addSavedViewsToRoutes } = useSavedViews();

  return {
    groups: productionRoutes
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
