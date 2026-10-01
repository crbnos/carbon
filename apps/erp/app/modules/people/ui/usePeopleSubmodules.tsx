// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
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
          icon: <LuUsers />,
          table: "employee"
        },
        {
          name: t`Timecards`,
          to: path.to.peopleTimecard,
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
          icon: <LuListChecks />
        },
        {
          name: t`Departments`,
          to: path.to.departments,
          icon: <LuNetwork />
        },
        {
          name: t`Holidays`,
          to: path.to.holidays,
          icon: <LuCalendarHeart />
        },
        {
          name: t`Shifts`,
          to: path.to.shifts,
          icon: <LuCalendarClock />
        }
      ]
    }
  ];

  const { addSavedViewsToRoutes } = useSavedViews();

  const settings = useSettings();

  return {
    groups: peopleRoutes.map((group) => ({
      ...group,
      routes: group.routes
        .filter(
          (route) =>
            !route.setting ||
            settings[route.setting as keyof typeof settings] === true
        )
        .map(addSavedViewsToRoutes)
    }))
  };
}
