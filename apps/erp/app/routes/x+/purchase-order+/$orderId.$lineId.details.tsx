import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import { Spinner } from "@carbon/react";
import { Await, Outlet, useLoaderData, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { defer, redirect } from "@vercel/remix";
import { Suspense } from "react";
import { Fragment } from "react/jsx-runtime";
import { CadModel } from "~/components";
import { usePermissions } from "~/hooks";
import {
  getPurchaseOrderLine,
  getSupplierInteractionLineDocuments,
  purchaseOrderLineValidator,
  upsertPurchaseOrderLine,
} from "~/modules/purchasing";
import { PurchaseOrderLineForm } from "~/modules/purchasing/ui/PurchaseOrder";
import {
  SupplierInteractionLineDocuments,
  SupplierInteractionLineNotes,
} from "~/modules/purchasing/ui/SupplierInteraction";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "purchasing",
    role: "employee",
    bypassRls: true,
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

  return defer({
    line: line?.data ?? null,
    files: getSupplierInteractionLineDocuments(client, companyId, lineId),
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    create: "purchasing",
  });

  const { orderId, lineId } = params;
  if (!orderId) throw new Error("Could not find orderId");
  if (!lineId) throw new Error("Could not find lineId");

  const formData = await request.formData();
  const validation = await validator(purchaseOrderLineValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  // if (data.purchaseOrderLineType === "G/L Account") {
  //   data.assetId = undefined;
  //   data.itemId = undefined;
  // } else if (data.purchaseOrderLineType === "Fixed Asset") {
  //   data.accountNumber = undefined;
  //   data.itemId = undefined;
  // } else
  // if (data.purchaseOrderLineType === "Comment") {
  //   data.accountNumber = undefined;
  //   data.assetId = undefined;
  //   data.itemId = undefined;
  // } else {
  //   data.accountNumber = undefined;
  //   data.assetId = undefined;
  // }

  const updatePurchaseOrderLine = await upsertPurchaseOrderLine(client, {
    id: lineId,
    ...data,
    updatedBy: userId,
    customFields: setCustomFields(formData),
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
    ...getCustomFields(line?.customFields),
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
          itemId: line?.itemId ?? undefined,
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
