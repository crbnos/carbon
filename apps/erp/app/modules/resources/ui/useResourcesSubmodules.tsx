// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
import { usePermissions } from "~/hooks";
import { useSavedViews } from "~/hooks/useSavedViews";
import type { RouteGroup } from "~/types";
import { path } from "~/utils/path";

export default function useResourcesSubmodules() {
  const { t } = useLingui();
  const { addSavedViewsToRoutes } = useSavedViews();
  const permissions = usePermissions();

  const translatedRoutes: RouteGroup[] = [
    {
      name: t`Maintenance`,
      routes: [
        {
          name: t`Dispatches`,
          to: path.to.maintenanceDispatches,
          page: "resources.dispatches",
          icon: <LuWrench />,
          table: "maintenanceDispatch"
        },
        {
          name: t`Schedules`,
          to: path.to.maintenanceSchedules,
          page: "resources.schedules",
          icon: <LuCalendarClock />,
          table: "maintenanceSchedule"
        },
        {
          name: t`Failure Modes`,
          to: path.to.failureModes,
          page: "resources.failureModes",
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
          page: "resources.locations",
          icon: <LuMapPin />,
          table: "location"
        },
        {
          name: t`Processes`,
          to: path.to.processes,
          page: "resources.processes",
          icon: <LuRedoDot />,
          table: "process"
        },
        {
          name: t`Work Centers`,
          to: path.to.workCenters,
          page: "resources.workCenters",
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
          page: "resources.abilities",
          icon: <LuAward />,
          table: "ability"
        },
        {
          name: t`Training`,
          to: path.to.trainings,
          page: "resources.training",
          icon: <LuGraduationCap />,
          table: "training"
        },
        {
          name: t`Assignments`,
          to: path.to.trainingAssignments,
          page: "resources.assignments",
          icon: <LuClipboardCheck />
        },
        {
          name: t`Suggestions`,
          to: path.to.suggestions,
          page: "resources.suggestions",
          icon: <LuMailbox />,
          table: "suggestion"
        }
      ]
    }
  ];

  return {
    groups: translatedRoutes.map((group) => ({
      ...group,
      routes: group.routes
        .filter(
          (route) => !route.page || permissions.has({ [route.page]: "View" })
        )
        .map(addSavedViewsToRoutes)
    }))
  };
}
