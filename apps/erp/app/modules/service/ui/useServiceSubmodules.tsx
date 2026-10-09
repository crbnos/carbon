// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import {
  LuCalendarDays,
  LuClipboardList,
  LuHardHat,
  LuLayoutTemplate,
  LuServer,
  LuTimer
} from "react-icons/lu";
import { usePermissions } from "~/hooks";
import { useSavedViews } from "~/hooks/useSavedViews";
import type { AuthenticatedRouteGroup } from "~/types";
import { path } from "~/utils/path";

// The Service Orders entry owns every page under /x/service-orders except the
// module's other submodules, plus the order workspace under /x/service-order.
const otherServiceRoutes = [
  path.to.myVisits,
  path.to.serviceSchedule,
  path.to.customerAssets,
  path.to.serviceTemplates
];

function isServiceOrdersRoute(pathname: string) {
  if (pathname.startsWith(path.to.serviceOrder(""))) return true;
  if (pathname === path.to.serviceOrders) return true;
  return (
    pathname.startsWith(`${path.to.serviceOrders}/`) &&
    !otherServiceRoutes.some((route) => pathname.startsWith(route))
  );
}

export default function useServiceSubmodules() {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { addSavedViewsToRoutes } = useSavedViews();

  const serviceRoutes: AuthenticatedRouteGroup[] = [
    {
      name: t`Work`,
      routes: [
        {
          name: t`Service Orders`,
          to: path.to.serviceOrders,
          icon: <LuClipboardList />,
          table: "serviceOrder",
          isActive: isServiceOrdersRoute
        },
        {
          name: t`My Visits`,
          to: path.to.myVisits,
          icon: <LuHardHat />,
          isActive: (pathname: string) => pathname.startsWith(path.to.myVisits)
        },
        {
          name: t`Schedule`,
          to: path.to.serviceSchedule,
          icon: <LuCalendarDays />,
          isActive: (pathname: string) =>
            pathname.startsWith(path.to.serviceSchedule)
        }
      ]
    },
    {
      name: t`Installed Base`,
      routes: [
        {
          name: t`Customer Assets`,
          to: path.to.customerAssets,
          icon: <LuServer />,
          table: "customerAsset",
          isActive: (pathname: string) =>
            pathname.startsWith(path.to.customerAssets) ||
            pathname.startsWith(path.to.customerAsset(""))
        }
      ]
    },
    {
      name: t`Setup`,
      routes: [
        {
          name: t`Service Templates`,
          to: path.to.serviceTemplates,
          icon: <LuLayoutTemplate />,
          isActive: (pathname: string) =>
            pathname.startsWith(path.to.serviceTemplates)
        },
        {
          name: t`My Timesheet`,
          to: path.to.timesheet,
          icon: <LuTimer />,
          role: "employee",
          isActive: (pathname: string) => pathname.startsWith(path.to.timesheet)
        }
      ]
    }
  ];

  const isVisible = (route: AuthenticatedRouteGroup["routes"][number]) =>
    route.role ? permissions.is(route.role) : true;

  return {
    groups: serviceRoutes
      .filter((group) => group.routes.some(isVisible))
      .map((group) => ({
        ...group,
        routes: group.routes.filter(isVisible).map(addSavedViewsToRoutes)
      }))
  };
}
