// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData, useNavigate, useParams } from "react-router";
import { usePermissions, useRouteData } from "~/hooks";
import { getLaborCategoriesList } from "~/modules/projects";
import type { ServiceOrder } from "~/modules/service";
import {
  getServiceNode,
  serviceNodeFixedPriceValidator,
  updateServiceNodeFixedPrice
} from "~/modules/service";
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

function failure(message: string) {
  return data({ success: false, error: { message } }, { status: 400 });
}

/**
 * Sets or removes the node's fixed price (`intent=fixedPrice`) while the
 * order is not Closed or Cancelled.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "service"
  });
  const { id, elementId } = params;
  if (!id) throw new Error("Could not find id");
  if (!elementId) throw new Error("Could not find elementId");

  const formData = await request.formData();
  if (formData.get("intent") !== "fixedPrice") return failure("Unknown intent");
  const validation = await validator(serviceNodeFixedPriceValidator).validate(
    formData
  );
  if (validation.error) return failure("Enter a price of 0 or more");

  const order = await client
    .from("serviceOrder")
    .select("projectId, status")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
  if (order.error) return failure("The service order was not found");
  if (order.data.status === "Closed" || order.data.status === "Cancelled") {
    return failure("A closed or cancelled service order cannot change");
  }

  const update = await updateServiceNodeFixedPrice(client, {
    projectId: order.data.projectId,
    elementId,
    fixedPrice: validation.data.fixedPrice ?? null,
    companyId,
    updatedBy: userId
  });
  if (update.error) return failure("Failed to save the fixed price");

  return data(
    { success: true, error: null },
    await flash(
      request,
      success(
        validation.data.fixedPrice === undefined
          ? "Fixed price removed"
          : "Fixed price saved"
      )
    )
  );
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
      nodeAction={path.to.serviceOrderWorkNode(id, node.element.id)}
      canCharge={canCharge}
      canEditPrice={canCharge}
      canIssue={permissions.can("update", "inventory")}
      onClose={() => navigate(path.to.serviceOrderWork(id))}
    />
  );
}
