// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { LeaseRouteData } from "~/modules/purchasing/ui/Leases";
import { LeaseSchedule } from "~/modules/purchasing/ui/Leases";
import { path } from "~/utils/path";

export default function LeaseScheduleRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<LeaseRouteData>(path.to.lease(id));
  if (!routeData) return null;

  return (
    <LeaseSchedule
      lease={routeData.lease}
      schedule={routeData.schedule}
      journals={routeData.journals}
    />
  );
}
