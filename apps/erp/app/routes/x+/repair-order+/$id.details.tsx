import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { VStack } from "@carbon/react";
import type { ActionFunctionArgs } from "react-router";
import { redirect, useParams } from "react-router";
import { repairOrderValidator, upsertRepairOrder } from "~/modules/sales";
import RepairOrderForm from "~/modules/sales/ui/Repairs/RepairOrderForm";
import { setCustomFields } from "~/utils/form";
import { useRouteData } from "~/hooks";
import RepairChargesTable from "~/modules/sales/ui/Repairs/RepairChargesTable";
import RepairOrderHeader from "~/modules/sales/ui/Repairs/RepairOrderHeader";
import RepairOrderLinesTable from "~/modules/sales/ui/Repairs/RepairOrderLinesTable";
import type {
  RepairOrderCharge,
  RepairOrderLine
} from "~/modules/sales/ui/Repairs/types";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const validation = await validator(repairOrderValidator).validate(formData);
  if (validation.error) return validationError(validation.error);

  // biome-ignore lint/correctness/noUnusedVariables: status is not user-editable here
  const { id: _id, status, ...d } = validation.data;

  const update = await upsertRepairOrder(client, {
    ...d,
    id,
    companyId,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (update.error) {
    throw redirect(
      path.to.repairOrderDetails(id),
      await flash(
        request,
        error(update.error, "Failed to update the repair order")
      )
    );
  }

  throw redirect(
    path.to.repairOrderDetails(id),
    await flash(request, success("Repair order updated"))
  );
}

export default function RepairOrderDetailsRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<{
    repairOrder: any;
    lines: RepairOrderLine[];
    charges: RepairOrderCharge[];
    warrantyTerms: { id: string; name: string }[];
  }>(path.to.repairOrder(id));

  if (!routeData?.repairOrder) {
    throw new Error("Failed to load repair order");
  }

  return (
    <VStack spacing={0} className="h-full overflow-y-auto">
      <RepairOrderHeader
        repairOrder={routeData.repairOrder}
        lines={routeData.lines}
      />
      <div className="w-full p-2 flex flex-col gap-4">
        <RepairOrderLinesTable
          repairOrderId={id}
          status={routeData.repairOrder.status}
          lines={routeData.lines}
          warrantyTerms={routeData.warrantyTerms}
        />
        <RepairChargesTable
          repairOrderId={id}
          status={routeData.repairOrder.status}
          charges={routeData.charges}
          lines={routeData.lines}
        />
        {/* An RMA-spawned repair order starts with no supplier — this is where
            the OEM and its RMA number get filled in before shipping out. */}
        <RepairOrderForm
          initialValues={{
            id: routeData.repairOrder.id,
            customerId: routeData.repairOrder.customerId,
            customerLocationId:
              routeData.repairOrder.customerLocationId ?? undefined,
            customerContactId:
              routeData.repairOrder.customerContactId ?? undefined,
            customerReference:
              routeData.repairOrder.customerReference ?? undefined,
            locationId: routeData.repairOrder.locationId ?? undefined,
            supplierId: routeData.repairOrder.supplierId ?? undefined,
            supplierReference:
              routeData.repairOrder.supplierReference ?? undefined,
            orderDate: routeData.repairOrder.orderDate,
            promisedDate: routeData.repairOrder.promisedDate ?? undefined
          }}
        />
      </div>
    </VStack>
  );
}
