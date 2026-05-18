import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useRouteData } from "@carbon/react";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect, useNavigate, useParams } from "react-router";
import {
  getStockTransfer,
  isStockTransferLocked,
  stockTransferLineValidator,
  upsertStockTransferLine
} from "~/modules/inventory";
import type {
  StockTransfer,
  StockTransferLine
} from "~/modules/inventory/types";
import StockTransferLineForm from "~/modules/inventory/ui/StockTransfers/StockTransferLineForm";
import { requireUnlocked } from "~/utils/lockedGuard.server";

import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {
    create: "inventory"
  });

  const { id, lineId } = params;
  if (!id) throw notFound("id not found");
  if (!lineId) throw notFound("lineId not found");

  const { client: viewClient } = await requirePermissions(request, {
    view: "inventory"
  });
  const transfer = await getStockTransfer(viewClient, id);
  await requireUnlocked({
    request,
    isLocked: isStockTransferLocked(transfer.data?.status),
    redirectTo: path.to.stockTransfer(id),
    message: "Cannot modify a locked stock transfer. Reopen it first."
  });

  const formData = await request.formData();

  const validation = await validator(stockTransferLineValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _id, ...d } = validation.data;

  const updateStockTransferLine = await upsertStockTransferLine({
    id: lineId,
    ...d,
    updatedBy: userId
  });
  if (updateStockTransferLine.error) {
    return data(
      {},
      await flash(
        request,
        error(updateStockTransferLine.error, "Failed to update line")
      )
    );
  }

  return redirect(
    path.to.stockTransfer(id),
    await flash(request, success("Line updated"))
  );
}

export default function NewStockTransferLinesRoute() {
  const { id, lineId } = useParams();
  if (!id) throw new Error("Could not find id");
  if (!lineId) throw new Error("Could not find lineId");
  const navigate = useNavigate();
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
      onClose={() => navigate(-1)}
      // @ts-expect-error TS2739 - TODO: fix type
      initialValues={initialValues}
    />
  );
}
