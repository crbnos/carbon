import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect } from "react-router";
import {
  getRepairOrder,
  getRepairOrderCharges,
  getRepairOrderLines,
  getWarrantyTermsList
} from "~/modules/sales";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Repairs`, to: path.to.repairOrders },
    (data) => data?.repairOrder?.repairOrderId
  ),
  module: "sales"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [repairOrder, lines, charges, warrantyTerms] = await Promise.all([
    getRepairOrder(client, id, companyId),
    getRepairOrderLines(client, id, companyId),
    getRepairOrderCharges(client, id, companyId),
    getWarrantyTermsList(client, companyId)
  ]);

  if (repairOrder.error) {
    throw redirect(
      path.to.repairOrders,
      await flash(
        request,
        error(repairOrder.error, "Failed to load repair order")
      )
    );
  }

  return {
    repairOrder: repairOrder.data,
    lines: lines.data ?? [],
    charges: charges.data ?? [],
    warrantyTerms: warrantyTerms.data ?? []
  };
}

export default function RepairOrderRoute() {
  return (
    <VStack spacing={0} className="h-full">
      <Outlet />
    </VStack>
  );
}
