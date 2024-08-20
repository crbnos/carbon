import { LuGroup, LuHammer, LuMapPin, LuShapes } from "react-icons/lu";
import { TbRoute } from "react-icons/tb";
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
        name: "Processes",
        to: path.to.processes,
        icon: <TbRoute />,
      },
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
