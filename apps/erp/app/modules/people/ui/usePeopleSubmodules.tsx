// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import {
  LuCalendarClock,
  LuCalendarHeart,
  LuClock,
  LuListChecks,
  LuNetwork,
  LuUsers
} from "react-icons/lu";
import { usePermissions } from "~/hooks";
import { useSavedViews } from "~/hooks/useSavedViews";
import { useSettings } from "~/hooks/useSettings";
import type { RouteGroup } from "~/types";
import { path } from "~/utils/path";

export default function usePeopleSubmodules() {
  const { t } = useLingui();

  const peopleRoutes: RouteGroup[] = [
    {
      name: t`Manage`,
      routes: [
        {
          name: t`Employees`,
          to: path.to.people,
          page: "people.employees",
          icon: <LuUsers />,
          table: "employee"
        },
        {
          name: t`Timecards`,
          to: path.to.peopleTimecard,
          page: "people.timecards",
          icon: <LuClock />,
          setting: "timeCardEnabled",
          table: "timeCardEntry"
        }
      ]
    },
    {
      name: t`Configure`,
      routes: [
        {
          name: t`Attributes`,
          to: path.to.attributes,
          page: "people.attributes",
          icon: <LuListChecks />
        },
        {
          name: t`Departments`,
          to: path.to.departments,
          page: "people.departments",
          icon: <LuNetwork />
        },
        {
          name: t`Holidays`,
          to: path.to.holidays,
          page: "people.holidays",
          icon: <LuCalendarHeart />
        },
        {
          name: t`Shifts`,
          to: path.to.shifts,
          page: "people.shifts",
          icon: <LuCalendarClock />
        }
      ]
    }
  ];

  const { addSavedViewsToRoutes } = useSavedViews();

  const settings = useSettings();
  const permissions = usePermissions();

  return {
    groups: peopleRoutes.map((group) => ({
      ...group,
      routes: group.routes
        .filter(
          (route) =>
            (!route.setting ||
              settings[route.setting as keyof typeof settings] === true) &&
            (!route.page || permissions.has({ [route.page]: "View" }))
        )
        .map(addSavedViewsToRoutes)
    }))
  };
}
