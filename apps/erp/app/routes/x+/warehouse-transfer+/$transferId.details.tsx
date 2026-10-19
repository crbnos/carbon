// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import { warehouseTransferValidator } from "~/modules/inventory/inventory.models";
import type {
  WarehouseTransfer,
  WarehouseTransferLine
} from "~/modules/inventory/types";
import {
  WarehouseTransferForm,
  WarehouseTransferLines
} from "~/modules/inventory/ui/WarehouseTransfers";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(warehouseTransferValidator).request(args, {
    params: ["transferId"]
  });
  if ("invalid" in input) return input.invalid;
  // The transfer in the URL is the one updated, whatever the form's id says.
  const { id: _, transferId: readableId, ...transfer } = input.data;
  const { transferId } = input.params;
  const api = await carbon(args.request);
  const result = await api.inventory.updateWarehouseTransfer({
    ...transfer,
    id: transferId,
    transferId: readableId || undefined,
    customFields: input.formData && setCustomFields(input.formData)
  });
  return respond(args.request, result).redirect(
    path.to.warehouseTransfer(transferId),
    { message: "Updated warehouse transfer" }
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
