import { useLingui } from "@lingui/react/macro";
import {
  LuAward,
  LuCalendarClock,
  LuCircleAlert,
  LuClipboardCheck,
  LuGraduationCap,
  LuLocateFixed,
  LuMailbox,
  LuMapPin,
  LuRedoDot,
  LuWrench
} from "react-icons/lu";
import { useSavedViews } from "~/hooks/useSavedViews";
import type { RouteGroup } from "~/types";
import { path } from "~/utils/path";

export default function useResourcesSubmodules() {
  const { t } = useLingui();
  const { addSavedViewsToRoutes } = useSavedViews();

  const translatedRoutes: RouteGroup[] = [
    {
      name: t`Maintenance`,
      routes: [
        {
          name: t`Dispatches`,
          to: path.to.maintenanceDispatches,
          icon: <LuWrench />,
          table: "maintenanceDispatch"
        },
        {
          name: t`Schedules`,
          to: path.to.maintenanceSchedules,
          icon: <LuCalendarClock />,
          table: "maintenanceSchedule"
        },
        {
          name: t`Failure Modes`,
          to: path.to.failureModes,
          icon: <LuCircleAlert />
        }
      ]
    },
    {
      name: t`Infrastructure`,
      routes: [
        {
          name: t`Locations`,
          to: path.to.locations,
          icon: <LuMapPin />,
          table: "location"
        },
        {
          name: t`Processes`,
          to: path.to.processes,
          icon: <LuRedoDot />,
          table: "process"
        },
        {
          name: t`Work Centers`,
          to: path.to.workCenters,
          icon: <LuLocateFixed />,
          table: "workCenter"
        }
      ]
    },
    {
      name: t`People`,
      routes: [
        {
          name: t`Abilities`,
          to: path.to.abilities,
          icon: <LuAward />,
          table: "ability"
        },
        {
          name: t`Training`,
          to: path.to.trainings,
          icon: <LuGraduationCap />,
          table: "training"
        },
        {
          name: t`Assignments`,
          to: path.to.trainingAssignments,
          icon: <LuClipboardCheck />
        },
        {
          name: t`Suggestions`,
          to: path.to.suggestions,
          icon: <LuMailbox />,
          table: "suggestion"
        }
      ]
    }
  ];

  return {
    groups: translatedRoutes.map((group) => ({
      ...group,
      routes: group.routes.map(addSavedViewsToRoutes)
    }))
  };
}
