import { requirePermissions } from "@carbon/auth/auth.server";
import { useNavigate, useParams } from "@remix-run/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { useRouteData } from "~/hooks";
import type {
  WarehouseTransfer,
  WarehouseTransferLine,
} from "~/modules/inventory";
import { WarehouseTransferLineForm } from "~/modules/inventory/ui/WarehouseTransfers";
import { path } from "~/utils/path";

import {
  upsertWarehouseTransferLine,
  warehouseTransferLineValidator,
} from "~/modules/inventory";

export async function action({ request, params }: ActionFunctionArgs) {
  console.log("DEBUG: new action called");
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory",
  });

  const { transferId } = params;
  if (!transferId) {
    throw new Error("transferId not found");
  }

  const formData = await request.formData();
  const validation = warehouseTransferLineValidator.safeParse(
    Object.fromEntries(formData)
  );

  if (!validation.success) {
    return json({
      success: false,
      message: "Invalid form data",
    });
  }

  const { id, ...data } = validation.data;

  const createWarehouseTransferLine = await upsertWarehouseTransferLine(
    client,
    {
      ...data,

      companyId: companyId,
      createdBy: userId,
    }
  );

  if (createWarehouseTransferLine.error) {
    return json({
      success: false,
      message: "Failed to create warehouse transfer line",
    });
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
    fromShelfId: "",
    toShelfId: "",
    unitOfMeasureCode: "",
    notes: "",
  };

  return (
    <WarehouseTransferLineForm
      initialValues={initialValues}
      warehouseTransfer={routeData.warehouseTransfer}
      onClose={() => navigate(path.to.warehouseTransfer(transferId))}
    />
  );
}
