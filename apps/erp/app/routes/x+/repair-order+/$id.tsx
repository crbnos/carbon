import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getCompanyTimeZone } from "@carbon/database";
import { VStack } from "@carbon/react";
import { datetime } from "@carbon/utils";
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

  // Coverage is judged against the company's today, not the server's UTC day —
  // the two disagree for a slice of every day, and a warranty that lapsed
  // overnight must bill as Billable from the customer's morning, not ours.
  const timezone = await getCompanyTimeZone(client, companyId);
  const today = datetime.today(timezone).toString();

  const [repairOrder, lines, charges, warrantyTerms] = await Promise.all([
    getRepairOrder(client, id, companyId),
    getRepairOrderLines(client, id, companyId, today),
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
