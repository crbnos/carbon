// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { LuCalendarRange, LuServer, LuWrench } from "react-icons/lu";
import { usePermissions } from "~/hooks";
import { useSavedViews } from "~/hooks/useSavedViews";
import type { AuthenticatedRouteGroup } from "~/types";
import { visibleGroups } from "~/utils/nav";
import { path } from "~/utils/path";

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
          table: "serviceJob"
        },
        {
          name: t`Schedule`,
          to: path.to.serviceSchedule,
          icon: <LuCalendarRange />
        },
        {
          name: t`Customer Assets`,
          to: path.to.customerAssets,
          icon: <LuServer />,
          table: "customerAsset"
        }
      ]
    }
  ];

  return {
    groups: visibleGroups(serviceRoutes, permissions).map((group) => ({
      ...group,
      routes: group.routes.map(addSavedViewsToRoutes)
    }))
  };
}
