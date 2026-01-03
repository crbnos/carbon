import {
  LuCalendarClock,
  LuChartLine,
  LuCircleAlert,
  LuHardHat,
  LuListChecks,
  LuSquareChartGantt,
  LuSquareKanban,
  LuTrash,
  LuWrench
} from "react-icons/lu";
import { usePermissions } from "~/hooks";
import { useSavedViews } from "~/hooks/useSavedViews";
import type { AuthenticatedRouteGroup } from "~/types";
import { path } from "~/utils/path";

const productionRoutes: AuthenticatedRouteGroup[] = [
  {
    name: "Production",
    routes: [
      {
        name: "Jobs",
        to: path.to.jobs,
        icon: <LuHardHat />,
        table: "job"
      },
      {
        name: "Procedures",
        to: path.to.procedures,
        icon: <LuListChecks />,
        table: "procedure",
        role: "employee"
      }
    ]
  },
  {
    name: "Plan",
    routes: [
      {
        name: "Planning",
        to: path.to.productionPlanning,
        icon: <LuSquareChartGantt />,
        table: "production-planning"
      },
      {
        name: "Projections",
        to: path.to.demandProjections,
        icon: <LuChartLine />,
        table: "demand-projection"
      },
      {
        name: "Schedule",
        to: path.to.scheduleDates,
        icon: <LuSquareKanban />
      }
    ]
  },
  {
    name: "Configure",
    routes: [
      {
        name: "Scrap Reasons",
        to: path.to.scrapReasons,
        role: "employee",
        icon: <LuTrash />
      }
    ]
  }
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
          .map(addSavedViewsToRoutes)
      }))
  };
}
