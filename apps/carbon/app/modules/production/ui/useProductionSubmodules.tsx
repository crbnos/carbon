import { FaTrash } from "react-icons/fa";
import { LuCalendarClock, LuHardHat } from "react-icons/lu";
import { usePermissions } from "~/hooks";
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
      },
      {
        name: "Schedule",
        to: path.to.schedule,
        icon: <LuCalendarClock />,
      },
    ],
  },
  {
    name: "Configure",
    routes: [
      {
        name: "Scrap Reasons",
        to: path.to.scrapReasons,
        role: "employee",
        icon: <FaTrash />,
      },
    ],
  },
];

export default function useProductionSubmodules() {
  const permissions = usePermissions();
  // to modify
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
        routes: group.routes.filter((route) => {
          if (route.role) {
            return permissions.is(route.role);
          } else {
            return true;
          }
        }),
      })),
  };
}
