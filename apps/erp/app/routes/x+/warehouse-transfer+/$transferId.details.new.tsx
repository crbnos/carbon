// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { useNavigate, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import { warehouseTransferLineValidator } from "~/modules/inventory/inventory.models";
import type {
  WarehouseTransfer,
  WarehouseTransferLine
} from "~/modules/inventory/types";
import { WarehouseTransferLineForm } from "~/modules/inventory/ui/WarehouseTransfers";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(warehouseTransferLineValidator).request(args, {
    params: ["transferId"]
  });
  if ("invalid" in input) return input.invalid;
  const { transferId } = input.params;
  // The line's locations are the transfer's own.
  const {
    id: _id,
    transferId: _transferId,
    fromLocationId: _from,
    toLocationId: _to,
    ...line
  } = input.data;
  const api = await carbon(args.request);
  const result = await api.inventory.createWarehouseTransferLine({
    transferId,
    ...line
  });
  // An error is toasted by the form's fetcher.
  if (!result.data) return result;
  throw redirect(path.to.warehouseTransfer(transferId));
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
