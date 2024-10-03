import { AiOutlinePartition } from "react-icons/ai";
import { GiWoodBeam } from "react-icons/gi";
import {
  LuAtom,
  LuGrip,
  LuHammer,
  LuPizza,
  LuRuler,
  LuShapes,
} from "react-icons/lu";
import { PiPiggyBank } from "react-icons/pi";
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
        icon: <AiOutlinePartition />,
      },
      {
        name: "Materials",
        to: path.to.materials,
        icon: <LuAtom />,
      },
      {
        name: "Tools",
        to: path.to.tools,
        icon: <LuHammer />,
      },
      {
        name: "Fixtures",
        to: path.to.fixtures,
        icon: <LuGrip />,
      },
      {
        name: "Consumables",
        to: path.to.consumables,
        icon: <LuPizza />,
      },
      // {
      //   name: "Services",
      //   to: path.to.services,
      //   icon: <LuHeadphones />,
      // },
    ],
  },
  {
    name: "Configure",
    routes: [
      {
        name: "Shapes",
        to: path.to.materialForms,
        icon: <LuShapes />,
        role: "employee",
      },
      {
        name: "Substances",
        to: path.to.materialSubstances,
        icon: <GiWoodBeam />,
        role: "employee",
      },
      {
        name: "Posting Groups",
        to: path.to.itemPostingGroups,
        role: "employee",
        icon: <PiPiggyBank />,
      },
      {
        name: "Units of Measure",
        to: path.to.uoms,
        role: "employee",
        icon: <LuRuler />,
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
