import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect, useNavigate, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type {
  WarehouseTransfer,
  WarehouseTransferLine
} from "~/modules/inventory";
import {
  getWarehouseTransfer,
  isWarehouseTransferLocked,
  upsertWarehouseTransferLine,
  warehouseTransferLineValidator
} from "~/modules/inventory";
import { WarehouseTransferLineForm } from "~/modules/inventory/ui/WarehouseTransfers";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const { transferId } = params;
  if (!transferId) {
    throw new Error("transferId not found");
  }

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
  const validation = warehouseTransferLineValidator.safeParse(
    Object.fromEntries(formData)
  );

  if (!validation.success) {
    return {
      success: false,
      message: "Invalid form data"
    };
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  const createWarehouseTransferLine = await upsertWarehouseTransferLine({
    ...d,

    companyId: companyId,
    createdBy: userId
  });

  if (createWarehouseTransferLine.error) {
    return {
      success: false,
      message: "Failed to create warehouse transfer line"
    };
  }

  return redirect(path.to.warehouseTransfer(transferId));
}

export default function NewWarehouseTransferLineRoute() {
  const navigate = useNavigate();
  const { transferId } = useParams();

  if (!transferId) throw new Error("Could not find transferId");

  const routeData = useRouteData<{
    warehouseTransfer: WarehouseTransfer;
    warehouseTransferLines: WarehouseTransferLine[];
  }>(path.to.warehouseTransfer(transferId));

  if (!routeData?.warehouseTransfer) {
    throw new Error("Could not find warehouse transfer in routeData");
  }

  const initialValues = {
    type: "create" as const,
    transferId,
    fromLocationId: routeData.warehouseTransfer.fromLocationId,
    toLocationId: routeData.warehouseTransfer.toLocationId,
    itemId: "",
    quantity: 1,
    fromStorageUnitId: "",
    toStorageUnitId: "",
    unitOfMeasureCode: "",
    notes: ""
  };

  return (
    <WarehouseTransferLineForm
      initialValues={initialValues}
      warehouseTransfer={routeData.warehouseTransfer}
      onClose={() => navigate(path.to.warehouseTransfer(transferId))}
    />
  );
}
