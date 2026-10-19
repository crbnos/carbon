// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { useCloseRoute, useRouteData } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useParams } from "react-router";
import { stockTransferLineValidator } from "~/modules/inventory/inventory.models";
import type { StockTransfer } from "~/modules/inventory/types";
import StockTransferLineForm from "~/modules/inventory/ui/StockTransfers/StockTransferLineForm";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "inventory"
  });

  return null;
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(stockTransferLineValidator).request(args, {
    params: ["id"]
  });
  if ("invalid" in input) return input.invalid;
  const {
    id: _,
    requiresBatchTracking,
    requiresSerialTracking,
    ...line
  } = input.data;
  const { id } = input.params;
  const api = await carbon(args.request);
  const result = await api.inventory.createStockTransferLine({
    ...line,
    // The line goes on the transfer in the URL, the one whose lock is checked.
    stockTransferId: id,
    requiresBatchTracking: requiresBatchTracking ? "true" : "false",
    requiresSerialTracking: requiresSerialTracking ? "true" : "false"
  });
  // An error is toasted and the drawer stays open.
  if (result.error) return result;
  return respond(args.request, result).redirect(path.to.stockTransfer(id), {
    message: "Line created"
  });
}

export default function NewStockTransferLinesRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");
  const closeRoute = useCloseRoute();
  const routeData = useRouteData<{
    stockTransfer: StockTransfer;
  }>(path.to.stockTransfer(id));

  if (!routeData?.stockTransfer?.locationId)
    throw new Error("No location found");

  const initialValues = {
    stockTransferId: id,
    itemId: "",
    quantity: 1,
    fromStorageUnitId: "",
    toStorageUnitId: ""
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
