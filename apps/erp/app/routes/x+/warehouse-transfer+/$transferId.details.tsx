import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type {
  WarehouseTransfer,
  WarehouseTransferLine
} from "~/modules/inventory";
import {
  getWarehouseTransfer,
  isWarehouseTransferLocked,
  updateWarehouseTransfer,
  warehouseTransferValidator
} from "~/modules/inventory";
import {
  WarehouseTransferForm,
  WarehouseTransferLines
} from "~/modules/inventory/ui/WarehouseTransfers";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const { transferId } = params;
  if (!transferId) throw new Error("transferId not found");

  const { client: viewClient } = await requirePermissions(request, {
    view: "inventory"
  });
  const transfer = await getWarehouseTransfer(viewClient, transferId);
  await requireUnlocked({
    request,
    isLocked: isWarehouseTransferLocked(transfer.data?.status),
    redirectTo: path.to.warehouseTransfer(transferId),
    message: "Cannot modify a locked warehouse transfer. Reopen it first."
  });

  const formData = await request.formData();
  const validation = await validator(warehouseTransferValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, transferId: validatedTransferId, ...d } = validation.data;
  if (!id) throw new Error("id not found");

  const updateTransfer = await updateWarehouseTransfer(client, {
    id,
    transferId: validatedTransferId || undefined,
    ...d,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (updateTransfer.error) {
    return data(
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
    expectedReceiptDate:
      routeData.warehouseTransfer.expectedReceiptDate ?? undefined,
    transferDate: routeData.warehouseTransfer.transferDate ?? undefined,
    transferId: routeData.warehouseTransfer.transferId ?? undefined,
    reference: routeData.warehouseTransfer.reference ?? undefined,
    notes: routeData.warehouseTransfer.notes ?? undefined,
    ...getCustomFields(routeData.warehouseTransfer.customFields)
  };

  return (
    <>
      <WarehouseTransferForm
        key={initialValues.id}
        initialValues={initialValues}
        warehouseTransfer={routeData.warehouseTransfer}
      />

      <WarehouseTransferLines
        warehouseTransferLines={routeData.warehouseTransferLines}
        transferId={transferId}
        warehouseTransfer={routeData.warehouseTransfer}
      />
    </>
  );
}
