// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { RecordOutlet } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import { getServiceVisits } from "~/modules/service/service.service";
import type { ServiceOrder } from "~/modules/service/types";
import VisitsList from "~/modules/service/ui/Visits/VisitsList";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "service"
  });
  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const visits = await getServiceVisits(client, companyId, {
    serviceOrderId: id
  });
  if (visits.error) {
    throw redirect(
      path.to.serviceOrderDetails(id),
      await flash(request, error(visits.error, "Failed to load the visits"))
    );
  }

  return { visits: visits.data ?? [] };
}

export default function ServiceOrderVisitsRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");
  const { visits } = useLoaderData<typeof loader>();
  const routeData = useRouteData<{ serviceOrder: ServiceOrder }>(
    path.to.serviceOrder(id)
  );
  const permissions = usePermissions();
  const user = useUser();

  const status = routeData?.serviceOrder?.status;
  const isFinal = status === "Closed" || status === "Cancelled";
  const canUpdate = permissions.can("update", "service");

  return (
    <>
      <VisitsList
        serviceOrderId={id}
        visits={visits}
        userId={user.id}
        canSchedule={canUpdate && !isFinal}
        canUpdateAny={canUpdate}
      />
      <RecordOutlet />
    </>
  );
}
