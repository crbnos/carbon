// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useParams } from "react-router";
import { usePermissions, useRouteData } from "~/hooks";
import { getLaborCategoriesList } from "~/modules/projects";
import type { ServiceOrder } from "~/modules/service";
import { getServiceNode } from "~/modules/service";
import NodePeek from "~/modules/service/ui/Work/NodePeek";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "service"
  });
  const { id, elementId } = params;
  if (!id) throw new Error("Could not find id");
  if (!elementId) throw new Error("Could not find elementId");

  const order = await client
    .from("serviceOrder")
    .select("projectId")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
  if (order.error) {
    throw redirect(
      path.to.serviceOrderWork(id),
      await flash(request, error(order.error, "Failed to load the node"))
    );
  }

  const [node, laborCategories, employeeJob] = await Promise.all([
    getServiceNode(client, {
      projectId: order.data.projectId,
      elementId,
      companyId
    }),
    getLaborCategoriesList(client, companyId),
    client
      .from("employeeJob")
      .select(
        "laborCategoryId, defaultStorageUnitId, storageUnit:storageUnit!employeeJob_defaultStorageUnit_fkey(id, locationId)"
      )
      .eq("id", userId)
      .eq("companyId", companyId)
      .maybeSingle()
  ]);
  if (node.error || !node.data) {
    throw redirect(
      path.to.serviceOrderWork(id),
      await flash(request, error(node.error, "Failed to load the node"))
    );
  }

  const van = employeeJob.data?.storageUnit;
  return {
    ...node.data,
    projectId: order.data.projectId,
    laborCategories: laborCategories.data ?? [],
    defaultLaborCategoryId: employeeJob.data?.laborCategoryId ?? null,
    van: van ? { storageUnitId: van.id, locationId: van.locationId } : null
  };
}

/** A node of the work in a drawer over the tree. */
export default function ServiceOrderNodeRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");
  const navigate = useNavigate();
  const node = useLoaderData<typeof loader>();
  const routeData = useRouteData<{ serviceOrder: ServiceOrder }>(
    path.to.serviceOrder(id)
  );
  const permissions = usePermissions();
  const status = routeData?.serviceOrder?.status;
  const canCharge =
    permissions.can("update", "service") &&
    status !== "Closed" &&
    status !== "Cancelled";

  return (
    <NodePeek
      key={node.element.id}
      {...node}
      chargeAction={path.to.serviceOrderCharge(id)}
      canCharge={canCharge}
      canIssue={permissions.can("update", "inventory")}
      onClose={() => navigate(path.to.serviceOrderWork(id))}
    />
  );
}
