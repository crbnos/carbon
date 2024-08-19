import { LuGroup, LuHammer, LuMapPin, LuShapes } from "react-icons/lu";
import type { RouteGroup } from "~/types";
import { path } from "~/utils/path";

const resourcesRoutes: RouteGroup[] = [
  {
    name: "Manage",
    routes: [
      // {
      //   name: "Contractors",
      //   to: path.to.contractors,
      //   icon: <LuHardHat />,
      // },
      // {
      //   name: "Partners",
      //   to: path.to.partners,
      //   icon: <FaPeopleArrows />,
      // },
      {
        name: "Abilities",
        to: path.to.abilities,
        icon: <LuHammer />,
      },
      {
        name: "Work Cells",
        to: path.to.workCells,
        icon: <LuGroup />,
      },
      {
        name: "Equipment",
        to: path.to.equipment,
        icon: <LuShapes />,
      },
    ],
  },
  {
    name: "Configure",
    routes: [
      {
        name: "Locations",
        to: path.to.locations,
        icon: <LuMapPin />,
      },
    ],
  },
];

export default function useResourcesSubmodules() {
  return { groups: resourcesRoutes };
}
