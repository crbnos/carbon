import { LuCalendarClock, LuHardHat } from "react-icons/lu";
import type { RouteGroup } from "~/types";
import { path } from "~/utils/path";

const productionRoutes: RouteGroup[] = [
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
];

export default function useProductionSubmodules() {
  return { groups: productionRoutes };
}
