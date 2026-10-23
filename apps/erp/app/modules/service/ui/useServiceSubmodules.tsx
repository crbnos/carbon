// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { LuCalendarRange, LuServer, LuWrench } from "react-icons/lu";
import { usePermissions } from "~/hooks";
import { useSavedViews } from "~/hooks/useSavedViews";
import type { AuthenticatedRouteGroup } from "~/types";
import { path } from "~/utils/path";

const customerAssetRecordPrefix = path.to.customerAsset("x").replace(/x$/, "");
const serviceJobRecordPrefix = path.to.serviceJob("x").replace(/x$/, "");

export default function useServiceSubmodules() {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { addSavedViewsToRoutes } = useSavedViews();

  const serviceRoutes: AuthenticatedRouteGroup[] = [
    {
      name: t`Manage`,
      routes: [
        {
          name: t`Jobs`,
          to: path.to.serviceJobs,
          icon: <LuWrench />,
          table: "serviceJob",
          // Schedule and Customer Assets live under /service-jobs too
          isActive: (pathname: string) =>
            (pathname.startsWith(path.to.serviceJobs) &&
              !pathname.startsWith(path.to.serviceSchedule) &&
              !pathname.startsWith(path.to.customerAssets)) ||
            pathname.startsWith(serviceJobRecordPrefix)
        },
        {
          name: t`Schedule`,
          to: path.to.serviceSchedule,
          icon: <LuCalendarRange />,
          isActive: (pathname: string) =>
            pathname.startsWith(path.to.serviceSchedule)
        },
        {
          name: t`Customer Assets`,
          to: path.to.customerAssets,
          icon: <LuServer />,
          table: "customerAsset",
          isActive: (pathname: string) =>
            pathname.startsWith(path.to.customerAssets) ||
            pathname.startsWith(customerAssetRecordPrefix)
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
