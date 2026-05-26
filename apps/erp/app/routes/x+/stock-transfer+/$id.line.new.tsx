import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useRouteData } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useNavigate, useParams } from "react-router";
import {
  isStockTransferLocked,
  stockTransferLineValidator
} from "~/modules/inventory";
import {
  getStockTransfer,
  upsertStockTransferLine
} from "~/modules/inventory/inventory.service.server";
import type { StockTransfer } from "~/modules/inventory/types";
import StockTransferLineForm from "~/modules/inventory/ui/StockTransfers/StockTransferLineForm";
import { requireUnlocked } from "~/utils/lockedGuard.server";

import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "inventory"
  });

  return null;
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "inventory"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  await requirePermissions(request, {
    view: "inventory"
  });
  const transfer = await getStockTransfer(id);
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

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id: lineId, ...d } = validation.data;

  const insertStockTransferLine = await upsertStockTransferLine({
    ...d,
    companyId,
    createdBy: userId
  });
  if (insertStockTransferLine.error) {
    return data(
      {},
      await flash(
        request,
        error(insertStockTransferLine.error, "Failed to insert line")
      )
    );
  }

  return redirect(
    path.to.stockTransfer(id),
    await flash(request, success("Line created"))
  );
}

export default function NewStockTransferLinesRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");
  const navigate = useNavigate();
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
      onClose={() => navigate(-1)}
      // @ts-expect-error TS2739 - TODO: fix type
      initialValues={initialValues}
    />
  );
}
