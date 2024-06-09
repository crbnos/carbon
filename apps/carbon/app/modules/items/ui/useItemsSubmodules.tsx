import { usePermissions } from "~/hooks";
import type { AuthenticatedRouteGroup } from "~/types";
import { path } from "~/utils/path";

const itemsRoutes: AuthenticatedRouteGroup[] = [
  {
    name: "Manage",
    routes: [
      {
        name: "Parts",
        to: path.to.parts,
      },
      {
        name: "Materials",
        to: path.to.materials,
      },
      {
        name: "Tools",
        to: path.to.tools,
      },
      {
        name: "Fixtures",
        to: path.to.fixtures,
      },
      {
        name: "Consumables",
        to: path.to.consumables,
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
        name: "Forms",
        to: path.to.materialForms,
      },
      {
        name: "Substances",
        to: path.to.materialSubstances,
      },
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

export default function useItemsSubmodules() {
  const permissions = usePermissions();
  return {
    groups: itemsRoutes
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
