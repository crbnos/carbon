import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useParams } from "@remix-run/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { useRouteData } from "~/hooks";
import type { WarehouseTransfer, WarehouseTransferLine } from "~/modules/inventory";
import {
  getWarehouseTransfer,
  upsertWarehouseTransfer,
  warehouseTransferValidator,
} from "~/modules/inventory";
import {
  WarehouseTransferForm,
  WarehouseTransferLines,
} from "~/modules/inventory/ui/WarehouseTransfers";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "inventory",
  });

  const formData = await request.formData();
  const validation = await validator(warehouseTransferValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;
  if (!id) throw new Error("id not found");

  const updateTransfer = await upsertWarehouseTransfer(client, {
    id,
    ...data,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });

  if (updateTransfer.error) {
    return json(
      {},
      await flash(
        request,
        error(updateTransfer.error, "Failed to update warehouse transfer")
      )
    );
  }

  throw redirect(
    path.to.warehouseTransfer(id),
    await flash(request, success("Updated warehouse transfer"))
  );
}

export default function WarehouseTransferDetailsRoute() {
  const { transferId } = useParams();
  if (!transferId) throw new Error("Could not find transferId");

  const routeData = useRouteData<{
    warehouseTransfer: WarehouseTransfer;
    warehouseTransferLines: WarehouseTransferLine[];
  }>(path.to.warehouseTransfer(transferId));

  if (!routeData?.warehouseTransfer)
    throw new Error("Could not find warehouse transfer in routeData");

  const initialValues = {
    ...routeData.warehouseTransfer,
    transferId: routeData.warehouseTransfer.transferId ?? undefined,
    reference: routeData.warehouseTransfer.reference ?? undefined,
    notes: routeData.warehouseTransfer.notes ?? undefined,
    ...getCustomFields(routeData.warehouseTransfer.customFields),
  };

  return (
    <div className="flex flex-col gap-2 pb-16 w-full">
      <WarehouseTransferForm 
        key={initialValues.id}
        initialValues={initialValues}
      />
      
      <WarehouseTransferLines 
        warehouseTransferLines={routeData.warehouseTransferLines}
        transferId={transferId}
        warehouseTransfer={routeData.warehouseTransfer}
      />
    </div>
  );
}