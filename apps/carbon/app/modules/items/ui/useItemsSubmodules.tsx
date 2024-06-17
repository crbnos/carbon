import { AiOutlinePartition } from "react-icons/ai";
import { CiFries } from "react-icons/ci";
import { FaRulerVertical } from "react-icons/fa";
import { GiIBeam, GiWoodBeam } from "react-icons/gi";
import { LuGrip, LuHammer, LuShapes } from "react-icons/lu";
import { PiPiggyBank } from "react-icons/pi";
import { RiCustomerServiceLine } from "react-icons/ri";
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
        icon: <GiIBeam />,
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
        icon: <CiFries />,
      },
      {
        name: "Services",
        to: path.to.services,
        icon: <RiCustomerServiceLine />,
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
        name: "Shapes",
        to: path.to.materialForms,
        icon: <LuShapes />,
      },
      {
        name: "Substances",
        to: path.to.materialSubstances,
        icon: <GiWoodBeam />,
      },
      {
        name: "Posting Groups",
        to: path.to.itemGroups,
        role: "employee",
        icon: <PiPiggyBank />,
      },
      {
        name: "Units of Measure",
        to: path.to.uoms,
        role: "employee",
        icon: <FaRulerVertical />,
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
