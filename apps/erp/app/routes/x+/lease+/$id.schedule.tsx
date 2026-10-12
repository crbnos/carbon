// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import { draftLeaseSetupPath } from "~/modules/purchasing/purchasing.server";
import type { LeaseRouteData } from "~/modules/purchasing/ui/Leases";
import { LeaseSchedule } from "~/modules/purchasing/ui/Leases";
import { path } from "~/utils/path";

/** A Draft has no schedule yet and is worked on in its setup, so an editor is
 *  sent there, as from the lease page. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "purchasing"
  });
  const { id } = params;
  if (!id) throw new Error("Could not find id");
  const setup = await draftLeaseSetupPath(client, { companyId, userId, id });
  if (setup) throw redirect(setup);
  return null;
}

export default function LeaseScheduleRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<LeaseRouteData>(path.to.lease(id));
  if (!routeData) return null;

  return (
    <LeaseSchedule
      lease={routeData.lease}
      lines={routeData.lines}
      schedule={routeData.schedule}
      journals={routeData.journals}
    />
  );
}
