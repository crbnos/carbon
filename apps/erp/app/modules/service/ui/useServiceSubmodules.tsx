// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import {
  LuCalendarDays,
  LuClipboardList,
  LuHardHat,
  LuLayoutTemplate,
  LuServer
} from "react-icons/lu";
import { usePermissions } from "~/hooks";
import { useSavedViews } from "~/hooks/useSavedViews";
import type { AuthenticatedRouteGroup } from "~/types";
import { path } from "~/utils/path";

// `generatePath` drops a trailing slash, so `path.to.serviceOrder("")` is
// "/x/service-order" — a prefix of "/x/service-orders" too, which lit Service
// Orders on every page of the module. These are the literal record prefixes.
const serviceOrderRecordPrefix = `${path.to.serviceOrders.replace(/s$/, "")}/`;
const customerAssetRecordPrefix = path.to.customerAsset("x").replace(/x$/, "");

// The Service Orders entry owns every page under /x/service-orders except the
// module's other entries, plus the order workspace under /x/service-order.
const otherServiceRoutes = [
  path.to.myVisits,
  path.to.serviceSchedule,
  path.to.customerAssets,
  path.to.serviceTemplates
];

function isServiceOrdersRoute(pathname: string) {
  if (pathname.startsWith(serviceOrderRecordPrefix)) return true;
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

  // My Time is not listed here: it opens from the avatar menu.
  const serviceRoutes: AuthenticatedRouteGroup[] = [
    {
      name: t`Manage`,
      routes: [
        {
          name: t`Service Orders`,
          to: path.to.serviceOrders,
          icon: <LuClipboardList />,
          table: "serviceOrder",
          isActive: isServiceOrdersRoute
        },
        {
          name: t`Schedule`,
          to: path.to.serviceSchedule,
          icon: <LuCalendarDays />,
          isActive: (pathname: string) =>
            pathname.startsWith(path.to.serviceSchedule)
        },
        {
          name: t`My Visits`,
          to: path.to.myVisits,
          icon: <LuHardHat />,
          isActive: (pathname: string) => pathname.startsWith(path.to.myVisits)
        }
      ]
    },
    {
      name: t`Setup`,
      routes: [
        {
          name: t`Customer Assets`,
          to: path.to.customerAssets,
          icon: <LuServer />,
          table: "customerAsset",
          isActive: (pathname: string) =>
            pathname.startsWith(path.to.customerAssets) ||
            pathname.startsWith(customerAssetRecordPrefix)
        },
        {
          name: t`Service Templates`,
          to: path.to.serviceTemplates,
          icon: <LuLayoutTemplate />,
          isActive: (pathname: string) =>
            pathname.startsWith(path.to.serviceTemplates)
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
