import { LuGroup, LuHammer, LuMapPin } from "react-icons/lu";
import { TbRoute } from "react-icons/tb";
import type { RouteGroup } from "~/types";
import { path } from "~/utils/path";

const resourcesRoutes: RouteGroup[] = [
  {
    name: "Manage",
    routes: [
      {
        name: "Abilities",
        to: path.to.abilities,
        icon: <LuHammer />,
      },
      {
        name: "Work Centers",
        to: path.to.workCenters,
        icon: <LuGroup />,
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
      {
        name: "Processes",
        to: path.to.processes,
        icon: <TbRoute />,
      },
    ],
  },
];

export default function useResourcesSubmodules() {
  return { groups: resourcesRoutes };
}
