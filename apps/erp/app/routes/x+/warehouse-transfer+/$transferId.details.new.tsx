import { useNavigate, useParams } from "@remix-run/react";
import { useRouteData } from "~/hooks";
import type {
  WarehouseTransfer,
  WarehouseTransferLine,
} from "~/modules/inventory";
import { WarehouseTransferLineForm } from "~/modules/inventory/ui/WarehouseTransfers";
import { path } from "~/utils/path";

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
