// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData, useParams } from "react-router";
import { usePermissions, useRouteData } from "~/hooks";
import type { ServiceOrder } from "~/modules/service";
import {
  getServiceBillableItems,
  getServiceWork,
  serviceBillableItemValidator,
  updateServiceBillableItem
} from "~/modules/service";
import BillableItemsTable from "~/modules/service/ui/Billing/BillableItemsTable";
import { path } from "~/utils/path";

const logger = getLogger("erp", "service-order-billing");

async function getOrderProject(
  client: Awaited<ReturnType<typeof requirePermissions>>["client"],
  id: string,
  companyId: string
) {
  return client
    .from("serviceOrder")
    .select("projectId, status")
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "service"
  });
  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const order = await getOrderProject(client, id, companyId);
  if (order.error) {
    throw redirect(
      path.to.serviceOrderDetails(id),
      await flash(request, error(order.error, "Failed to load the billing"))
    );
  }

  const [items, work] = await Promise.all([
    getServiceBillableItems(client, order.data.projectId, companyId),
    getServiceWork(client, order.data.projectId, companyId)
  ]);
  if (items.error || work.error) {
    logger.error("Failed to load the billing of a service order", {
      companyId,
      serviceOrderId: id,
      error: items.error ?? work.error
    });
  }

  return { items: items.data ?? [], nodes: work.elements };
}

function failure(message: string) {
  return data({ success: false, error: { message } }, { status: 400 });
}

/**
 * Reviews one billable item of the order before it is billed: a new unit
 * price, a hold or its release, or a write-off with a reason.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "service"
  });
  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const validation = await validator(serviceBillableItemValidator).validate(
    await request.formData()
  );
  if (validation.error) {
    return failure(
      validation.error.fieldErrors.statusReason ?? "Check the item's values"
    );
  }

  const order = await getOrderProject(client, id, companyId);
  if (order.error) return failure("The service order was not found");
  if (order.data.status === "Closed" || order.data.status === "Cancelled") {
    return failure("A closed or cancelled service order cannot change");
  }
  const item = await client
    .from("projectBillableItem")
    .select("id")
    .eq("id", validation.data.id)
    .eq("projectId", order.data.projectId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (!item.data) return failure("The item is not on this service order");

  const update = await updateServiceBillableItem(client, {
    ...validation.data,
    companyId,
    updatedBy: userId
  });
  if (update.error) return failure(update.error.message);

  const message =
    validation.data.status === "Written Off"
      ? "Item written off"
      : validation.data.status === "On Hold"
        ? "Item held"
        : validation.data.status === "Unbilled"
          ? "Item released"
          : "Price updated";
  return data(
    { success: true, error: null },
    await flash(request, success(message))
  );
}

export default function ServiceOrderBillingRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");
  const { items, nodes } = useLoaderData<typeof loader>();
  const routeData = useRouteData<{ serviceOrder: ServiceOrder }>(
    path.to.serviceOrder(id)
  );
  const permissions = usePermissions();
  const status = routeData?.serviceOrder?.status;
  const isFinal = status === "Closed" || status === "Cancelled";

  return (
    <BillableItemsTable
      items={items}
      nodes={nodes}
      action={path.to.serviceOrderBilling(id)}
      isDisabled={!permissions.can("update", "service") || isFinal}
    />
  );
}
