import {
  LuCalendarClock,
  LuCircleAlert,
  LuClipboardCheck,
  LuCog,
  LuGraduationCap,
  LuMailbox,
  LuMapPin,
  LuWrench
} from "react-icons/lu";
import { useSavedViews } from "~/hooks/useSavedViews";
import type { RouteGroup } from "~/types";
import { path } from "~/utils/path";

const resourcesRoutes: RouteGroup[] = [
  {
    name: "Maintenance",
    routes: [
      {
        name: "Dispatches",
        to: path.to.maintenanceDispatches,
        icon: <LuWrench />,
        table: "maintenanceDispatch"
      },
      {
        name: "Schedules",
        to: path.to.maintenanceSchedules,
        icon: <LuCalendarClock />,
        table: "maintenanceSchedule"
      },
      {
        name: "Failure Modes",
        to: path.to.failureModes,
        icon: <LuCircleAlert />
      }
    ]
  },
  {
    name: "Infrastructure",
    routes: [
      {
        name: "Locations",
        to: path.to.locations,
        icon: <LuMapPin />,
        table: "location"
      },
      {
        name: "Processes",
        to: path.to.processes,
        icon: <LuCog />,
        table: "process"
      },
      {
        name: "Work Centers",
        to: path.to.workCenters,
        icon: <LuWrench />,
        table: "workCenter"
      }
    ]
  },
  {
    name: "People",
    routes: [
      {
        name: "Training",
        to: path.to.trainings,
        icon: <LuGraduationCap />,
        table: "training"
      },
      {
        name: "Assignments",
        to: path.to.trainingAssignments,
        icon: <LuClipboardCheck />
      },
      {
        name: "Suggestions",
        to: path.to.suggestions,
        icon: <LuMailbox />,
        table: "suggestion"
      }
    ]
  }
];

export default function useResourcesSubmodules() {
  const { addSavedViewsToRoutes } = useSavedViews();

  return {
    groups: resourcesRoutes.map((group) => ({
      ...group,
      routes: group.routes.map(addSavedViewsToRoutes)
    }))
  };
}
