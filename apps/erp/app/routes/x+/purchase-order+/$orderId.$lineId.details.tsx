import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import { Fragment } from "react/jsx-runtime";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData, useParams } from "react-router";
import { CadModel, DeferredFiles } from "~/components";
import { usePermissions, useRouteData } from "~/hooks";
import {
  getPurchaseOrder,
  getPurchaseOrderLine,
  getSupplierInteractionLineDocuments,
  isPurchaseOrderLocked,
  purchaseOrderLineValidator,
  upsertPurchaseOrderLine
} from "~/modules/purchasing";
import { PurchaseOrderLineForm } from "~/modules/purchasing/ui/PurchaseOrder";
import {
  SupplierInteractionLineDocuments,
  SupplierInteractionLineNotes
} from "~/modules/purchasing/ui/SupplierInteraction";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "purchasing",
    role: "employee",
    bypassRls: true
  });

  const { orderId, lineId } = params;
  if (!orderId) throw notFound("orderId not found");
  if (!lineId) throw notFound("lineId not found");

  const line = await getPurchaseOrderLine(client, lineId);
  if (line.error) {
    throw redirect(
      path.to.purchaseOrderDetails(orderId),
      await flash(request, error(line.error, "Failed to load sales order line"))
    );
  }

  return {
    line: line?.data ?? null,
    files: getSupplierInteractionLineDocuments(client, companyId, lineId)
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { orderId, lineId } = params;
  if (!orderId) throw new Error("Could not find orderId");
  if (!lineId) throw new Error("Could not find lineId");

  // First check with view permission to get the PO status
  const { client: viewClient } = await requirePermissions(request, {
    view: "purchasing"
  });

  // Get PO status and current line data
  const [purchaseOrder, currentLine] = await Promise.all([
    getPurchaseOrder(viewClient, orderId),
    getPurchaseOrderLine(viewClient, lineId)
  ]);

  if (purchaseOrder.error) {
    throw redirect(
      path.to.purchaseOrderLine(orderId, lineId),
      await flash(
        request,
        error(purchaseOrder.error, "Failed to load purchase order")
      )
    );
  }

  if (currentLine.error || !currentLine.data) {
    throw redirect(
      path.to.purchaseOrderLine(orderId, lineId),
      await flash(
        request,
        error(currentLine.error, "Failed to load purchase order line")
      )
    );
  }

  await requireUnlocked({
    request,
    isLocked: isPurchaseOrderLocked(purchaseOrder.data?.status),
    redirectTo: path.to.purchaseOrderLine(orderId, lineId),
    message: "Cannot modify a confirmed purchase order."
  });

  const { client, userId } = await requirePermissions(request, {
    update: "purchasing"
  });

  const formData = await request.formData();
  const validation = await validator(purchaseOrderLineValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  const updatePurchaseOrderLine = await upsertPurchaseOrderLine(client, {
    id: lineId,
    ...d,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (updatePurchaseOrderLine.error) {
    throw redirect(
      path.to.purchaseOrderLine(orderId, lineId),
      await flash(
        request,
        error(
          updatePurchaseOrderLine.error,
          "Failed to update purchase order line"
        )
      )
    );
  }

  throw redirect(path.to.purchaseOrderLine(orderId, lineId));
}

export default function EditPurchaseOrderLineRoute() {
  const { orderId, lineId } = useParams();
  if (!orderId) throw new Error("orderId not found");
  if (!lineId) throw new Error("lineId not found");

  const permissions = usePermissions();
  const routeData = useRouteData<{
    purchaseOrder: { status: string };
  }>(path.to.purchaseOrder(orderId));
  const isReadOnly = isPurchaseOrderLocked(routeData?.purchaseOrder?.status);

  const { line, files } = useLoaderData<typeof loader>();

  const initialValues = {
    id: line?.id ?? undefined,
    purchaseOrderId: line?.purchaseOrderId ?? "",
    purchaseOrderLineType: (line?.purchaseOrderLineType ?? "Part") as "Part",
    itemId: line?.itemId ?? "",
    accountId: line?.accountId ?? "",
    assetId: line?.assetId ?? "",
    conversionFactor: line?.conversionFactor ?? 1,
    description: line?.description ?? "",
    exchangeRate: line?.exchangeRate ?? 1,
    inventoryUnitOfMeasureCode: line?.inventoryUnitOfMeasureCode ?? "",
    jobId: line?.jobId ?? "",
    jobOperationId: line?.jobOperationId ?? "",
    locationId: line?.locationId ?? "",
    purchaseQuantity: line?.purchaseQuantity ?? 1,
    purchaseUnitOfMeasureCode: line?.purchaseUnitOfMeasureCode ?? "",
    requiredDate: line?.requiredDate ?? undefined,
    storageUnitId: line?.storageUnitId ?? "",
    supplierPartId: line?.supplierPartId ?? "",
    supplierShippingCost: line?.supplierShippingCost ?? 0,
    supplierTaxAmount: line?.supplierTaxAmount ?? 0,
    supplierUnitPrice: line?.supplierUnitPrice ?? 0,
    costCenterId: line?.costCenterId ?? "",
    taxPercent: line?.taxPercent ?? 0,
    assetReadableId: (line as any)?.assetReadableId ?? "",
    assetName: (line as any)?.assetName ?? "",
    ...getCustomFields(line?.customFields)
  };

  return (
    <Fragment key={lineId}>
      <PurchaseOrderLineForm
        key={initialValues.id}
        initialValues={initialValues}
      />
      <SupplierInteractionLineNotes
        id={line?.id ?? ""}
        table="purchaseOrderLine"
        title="Notes"
        subTitle={
          line.purchaseOrderLineType === "Fixed Asset"
            ? (line.assetName ?? line.description ?? "")
            : line.purchaseOrderLineType === "G/L Account"
              ? (line.description ?? "")
              : (line.itemReadableId ?? "")
        }
        internalNotes={line.internalNotes as JSONContent}
        externalNotes={line.externalNotes as JSONContent}
      />

      <DeferredFiles resolve={files}>
        {(resolvedFiles) => (
          <SupplierInteractionLineDocuments
            files={resolvedFiles ?? []}
            id={orderId}
            lineId={lineId}
            type="Purchase Order"
          />
        )}
      </DeferredFiles>
      <CadModel
        isReadOnly={isReadOnly || !permissions.can("update", "purchasing")}
        metadata={{
          itemId: line?.itemId ?? undefined
        }}
        modelPath={line?.modelPath ?? null}
        title="CAD Model"
        uploadClassName="aspect-square min-h-[420px] max-h-[70vh]"
        viewerClassName="aspect-square min-h-[420px] max-h-[70vh]"
      />

      <Outlet />
    </Fragment>
  );
}
