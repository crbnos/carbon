import { AiOutlinePartition } from "react-icons/ai";
import {
  LuAtom,
  LuBeef,
  LuDessert,
  LuGlassWater,
  LuHammer,
  LuPizza,
  LuRuler,
  LuShapes,
} from "react-icons/lu";
import { usePermissions } from "~/hooks";
import { useSavedViews } from "~/hooks/useSavedViews";
import type { AuthenticatedRouteGroup } from "~/types";
import { path } from "~/utils/path";

const itemsRoutes: AuthenticatedRouteGroup[] = [
  {
    name: "Manage",
    routes: [
      {
        name: "Parts",
        to: path.to.parts,
        icon: <AiOutlinePartition />,
        table: "part",
      },
      {
        name: "Materials",
        to: path.to.materials,
        icon: <LuAtom />,
        table: "material",
      },
      {
        name: "Tools",
        to: path.to.tools,
        icon: <LuHammer />,
        table: "tool",
      },
      {
        name: "Consumables",
        to: path.to.consumables,
        icon: <LuPizza />,
        table: "consumable",
      },
      // {
      //   name: "Services",
      //   to: path.to.services,
      //   icon: <LuHeadphones />,
      // },
    ],
  },
  // {
  //   name: "Methods",
  //   routes: [
  //     {
  //       name: "Materials",
  //       to: path.to.methodMaterials,
  //       icon: <LuPackage />,
  //     },
  //     {
  //       name: "Operations",
  //       to: path.to.methodOperations,
  //       icon: <LuClock />,
  //     },
  //   ],
  // },
  {
    name: "Configure",
    routes: [
      {
        name: "Finishes",
        to: path.to.materialFinishes,
        icon: <LuDessert />,
        role: "employee",
      },
      {
        name: "Grades",
        to: path.to.materialGrades,
        icon: <LuBeef />,
        role: "employee",
      },
      {
        name: "Shapes",
        to: path.to.materialForms,
        icon: <LuShapes />,
        role: "employee",
      },
      {
        name: "Substances",
        to: path.to.materialSubstances,
        icon: <LuGlassWater />,
        role: "employee",
      },
      // {
      //   name: "Posting Groups",
      //   to: path.to.itemPostingGroups,
      //   role: "employee",
      //   icon: <PiPiggyBank />,
      // },
      {
        name: "Units",
        to: path.to.uoms,
        role: "employee",
        icon: <LuRuler />,
      },
    ],
  },
];

export default function useItemsSubmodules() {
  const permissions = usePermissions();
  const { addSavedViewsToRoutes } = useSavedViews();

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
