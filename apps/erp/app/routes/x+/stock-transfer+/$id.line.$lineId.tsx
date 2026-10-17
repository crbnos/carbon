// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { useCloseRoute, useRouteData } from "@carbon/react";
import type { ActionFunctionArgs } from "react-router";
import { useParams } from "react-router";
import { stockTransferLineValidator } from "~/modules/inventory/inventory.models";
import type {
  StockTransfer,
  StockTransferLine
} from "~/modules/inventory/types";
import StockTransferLineForm from "~/modules/inventory/ui/StockTransfers/StockTransferLineForm";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(stockTransferLineValidator).request(args, {
    params: ["id", "lineId"]
  });
  if ("invalid" in input) return input.invalid;
  const {
    id: _,
    requiresBatchTracking,
    requiresSerialTracking,
    ...line
  } = input.data;
  const { id, lineId } = input.params;
  const api = await carbon(args.request);
  const result = await api.inventory.updateStockTransferLine({
    ...line,
    id: lineId,
    stockTransferId: id,
    requiresBatchTracking: requiresBatchTracking ? "true" : "false",
    requiresSerialTracking: requiresSerialTracking ? "true" : "false"
  });
  // An error is toasted and the drawer stays open.
  if (result.error) return result;
  return respond(args.request, result).redirect(path.to.stockTransfer(id), {
    message: "Line updated"
  });
}

export default function NewStockTransferLinesRoute() {
  const { id, lineId } = useParams();
  if (!id) throw new Error("Could not find id");
  if (!lineId) throw new Error("Could not find lineId");
  const closeRoute = useCloseRoute();
  const routeData = useRouteData<{
    stockTransfer: StockTransfer;
    stockTransferLines: StockTransferLine[];
  }>(path.to.stockTransfer(id));

  if (!routeData?.stockTransfer?.locationId)
    throw new Error("No location found");

  const line = routeData?.stockTransferLines?.find(
    (line) => line.id === lineId
  );

  const initialValues = {
    id: lineId,
    stockTransferId: id,
    itemId: line?.itemId ?? "",
    quantity: line?.quantity ?? 1,
    fromStorageUnitId: line?.fromStorageUnitId ?? "",
    toStorageUnitId: line?.toStorageUnitId ?? ""
  };

  return (
    <StockTransferLineForm
      locationId={routeData?.stockTransfer.locationId}
      onClose={() => closeRoute()}
      // @ts-expect-error TS2739 - TODO: fix type
      initialValues={initialValues}
    />
  );
}
