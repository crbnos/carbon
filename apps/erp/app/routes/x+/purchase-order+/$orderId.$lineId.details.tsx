import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import { Spinner } from "@carbon/react";
import { Suspense } from "react";
import { Fragment } from "react/jsx-runtime";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Await,
  Outlet,
  redirect,
  useLoaderData,
  useParams
} from "react-router";
import { CadModel } from "~/components";
import { usePermissions } from "~/hooks";
import {
  getPurchaseOrder,
  getPurchaseOrderLine,
  getSupplierInteractionLineDocuments,
  isPurchaseOrderLocked,
  purchaseOrderLineValidator,
  upsertPurchaseOrderLine,
  validateLockedPOSingleLineEdit
} from "~/modules/purchasing";
import { PurchaseOrderLineForm } from "~/modules/purchasing/ui/PurchaseOrder";
import {
  SupplierInteractionLineDocuments,
  SupplierInteractionLineNotes
} from "~/modules/purchasing/ui/SupplierInteraction";
import { getCustomFields, setCustomFields } from "~/utils/form";
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

  const isLocked = isPurchaseOrderLocked(purchaseOrder.data?.status);

  // If locked, require delete permission; otherwise require update permission
  const { client, userId } = await requirePermissions(request, {
    ...(isLocked ? { delete: "purchasing" } : { update: "purchasing" })
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

  // If locked, validate that changes only reduce the line total
  if (isLocked) {
    const validationResult = validateLockedPOSingleLineEdit(
      {
        id: lineId,
        purchaseQuantity: currentLine.data.purchaseQuantity,
        supplierUnitPrice: currentLine.data.supplierUnitPrice,
        supplierTaxAmount: currentLine.data.supplierTaxAmount,
        supplierShippingCost: currentLine.data.supplierShippingCost
      },
      {
        purchaseQuantity: d.purchaseQuantity,
        supplierUnitPrice: d.supplierUnitPrice,
        supplierTaxAmount: d.supplierTaxAmount,
        supplierShippingCost: d.supplierShippingCost
      }
    );

    if (!validationResult.allowed) {
      throw redirect(
        path.to.purchaseOrderLine(orderId, lineId),
        await flash(request, error(null, validationResult.error))
      );
    }
  }

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

  const { line, files } = useLoaderData<typeof loader>();

  const initialValues = {
    id: line?.id ?? undefined,
    purchaseOrderId: line?.purchaseOrderId ?? "",
    purchaseOrderLineType: (line?.purchaseOrderLineType ?? "Part") as "Part",
    itemId: line?.itemId ?? "",
    accountNumber: line?.accountNumber ?? "",
    assetId: line?.assetId ?? "",
    description: line?.description ?? "",
    purchaseQuantity: line?.purchaseQuantity ?? 1,
    supplierUnitPrice: line?.supplierUnitPrice ?? 0,
    supplierShippingCost: line?.supplierShippingCost ?? 0,
    supplierTaxAmount: line?.supplierTaxAmount ?? 0,
    exchangeRate: line?.exchangeRate ?? 1,
    locationId: line?.locationId ?? "",
    purchaseUnitOfMeasureCode: line?.purchaseUnitOfMeasureCode ?? "",
    inventoryUnitOfMeasureCode: line?.inventoryUnitOfMeasureCode ?? "",
    jobId: line?.jobId ?? "",
    jobOperationId: line?.jobOperationId ?? "",
    conversionFactor: line?.conversionFactor ?? 1,
    shelfId: line?.shelfId ?? "",
    taxPercent: line?.taxPercent ?? 0,
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
        subTitle={line.itemReadableId ?? ""}
        internalNotes={line.internalNotes as JSONContent}
        externalNotes={line.externalNotes as JSONContent}
      />

      <Suspense
        fallback={
          <div className="flex w-full h-full rounded bg-gradient-to-tr from-background to-card items-center justify-center">
            <Spinner className="h-10 w-10" />
          </div>
        }
      >
        <Await resolve={files}>
          {(resolvedFiles) => (
            <SupplierInteractionLineDocuments
              files={resolvedFiles ?? []}
              id={orderId}
              lineId={lineId}
              type="Purchase Order"
            />
          )}
        </Await>
      </Suspense>
      <CadModel
        isReadOnly={!permissions.can("update", "purchasing")}
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
