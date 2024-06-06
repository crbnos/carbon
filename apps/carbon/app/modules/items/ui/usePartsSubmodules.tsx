import { usePermissions } from "~/hooks";
import type { AuthenticatedRouteGroup } from "~/types";
import { path } from "~/utils/path";

const partsRoutes: AuthenticatedRouteGroup[] = [
  {
    name: "Manage",
    routes: [
      {
        name: "Parts",
        to: path.to.parts,
      },
      {
        name: "Services",
        to: path.to.services,
      },
      // {
      //   name: "Routing",
      //   to: path.to.routings,
      //   role: "employee",
      // },
    ],
  },
  {
    name: "Configure",
    routes: [
      {
        name: "Posting Groups",
        to: path.to.itemGroups,
        role: "employee",
      },
      {
        name: "Units of Measure",
        to: path.to.uoms,
        role: "employee",
      },
    ],
  },
];

export default function usePartsSubmodules() {
  const permissions = usePermissions();
  return {
    groups: partsRoutes
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
