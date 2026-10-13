// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import {
  LuBanknote,
  LuCalendarClock,
  LuCalendarHeart,
  LuClock,
  LuListChecks,
  LuNetwork,
  LuUsers
} from "react-icons/lu";
import { useSavedViews } from "~/hooks/useSavedViews";
import { useSettings } from "~/hooks/useSettings";
import { useGovernmentContracting } from "~/modules/projects/ui/useGovernmentContracting";
import type { RouteGroup } from "~/types";
import { path } from "~/utils/path";

export default function usePeopleSubmodules() {
  const { t } = useLingui();
  // Payroll totals feed the labor distribution report's payroll check; a
  // company that does no government contracting never sees them (Layer 5).
  const isGovernmentContracting = useGovernmentContracting();

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
        },
        ...(isGovernmentContracting
          ? [
              {
                name: t`Payroll Totals`,
                to: path.to.payrollTotals,
                icon: <LuBanknote />
              }
            ]
          : [])
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
