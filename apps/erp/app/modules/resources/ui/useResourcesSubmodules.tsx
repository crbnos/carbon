import { LuMapPin } from "react-icons/lu";
import { TbRoute } from "react-icons/tb";
import { useSavedViews } from "~/hooks/useSavedViews";
import type { RouteGroup } from "~/types";
import { path } from "~/utils/path";

const resourcesRoutes: RouteGroup[] = [
  {
    name: "Manage",
    routes: [
      {
        name: "Locations",
        to: path.to.locations,
        icon: <LuMapPin />,
        table: "location",
      },
      {
        name: "Processes",
        to: path.to.processes,
        icon: <TbRoute />,
        table: "process",
      },
      {
        name: "Work Centers",
        to: path.to.workCenters,
        icon: <LuMapPin />,
        table: "workCenter",
      },
    ],
  },
];

export default function useResourcesSubmodules() {
  const { addSavedViewsToRoutes } = useSavedViews();

  return {
    groups: resourcesRoutes.map((group) => ({
      ...group,
      routes: group.routes.map(addSavedViewsToRoutes),
    })),
  };
}
