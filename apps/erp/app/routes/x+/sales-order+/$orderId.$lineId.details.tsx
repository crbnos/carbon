import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import { Card, CardHeader, CardTitle } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Fragment, Suspense } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Await,
  Outlet,
  redirect,
  useLoaderData,
  useParams
} from "react-router";
import { CadModel, DeferredFiles } from "~/components";
import { usePermissions, useRouteData } from "~/hooks";
import { getItemReplenishment } from "~/modules/items";
import { getJobsBySalesOrderLine } from "~/modules/production";
import type {
  Opportunity,
  SalesOrder,
  SalesOrderLineType
} from "~/modules/sales";
import {
  getOpportunityLineDocuments,
  getSalesOrder,
  getSalesOrderLine,
  getSalesOrderLineShipments,
  isSalesOrderLocked,
  salesOrderLineValidator,
  upsertSalesOrderLine
} from "~/modules/sales";
import {
  OpportunityLineDocuments,
  OpportunityLineNotes
} from "~/modules/sales/ui/Opportunity";
import {
  SalesOrderLineForm,
  SalesOrderLineJobs
} from "~/modules/sales/ui/SalesOrder";
import { SalesOrderLineShipments } from "~/modules/sales/ui/SalesOrder/SalesOrderLineShipments";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    view: "sales",
    bypassRls: true
  });

  const { orderId, lineId } = params;
  if (!orderId) throw notFound("orderId not found");
  if (!lineId) throw notFound("lineId not found");

  const serviceRole = await getCarbonServiceRole();

  const [line, jobs, shipments] = await Promise.all([
    getSalesOrderLine(serviceRole, lineId),
    getJobsBySalesOrderLine(serviceRole, lineId),
    getSalesOrderLineShipments(serviceRole, lineId)
  ]);

  if (line.error) {
    throw redirect(
      path.to.salesOrderDetails(orderId),
      await flash(request, error(line.error, "Failed to load sales order line"))
    );
  }

  const itemId = line.data.itemId;

  return {
    line: line?.data ?? null,
    itemReplenishment:
      itemId && line.data.methodType === "Make to Order"
        ? getItemReplenishment(serviceRole, itemId, companyId)
        : Promise.resolve({ data: null }),
    files: getOpportunityLineDocuments(serviceRole, companyId, lineId, itemId),
    jobs: jobs?.data ?? [],
    shipments: shipments?.data ?? []
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { orderId, lineId } = params;
  if (!orderId) throw new Error("Could not find orderId");
  if (!lineId) throw new Error("Could not find lineId");

  const { client: viewClient } = await requirePermissions(request, {
    view: "sales"
  });

  const salesOrder = await getSalesOrder(viewClient, orderId);
  await requireUnlocked({
    request,
    isLocked: isSalesOrderLocked(salesOrder.data?.status),
    redirectTo: path.to.salesOrderLine(orderId, lineId),
    message: "Cannot modify a locked sales order. Reopen it first."
  });

  const { client, userId } = await requirePermissions(request, {
    create: "sales"
  });

  const formData = await request.formData();
  const validation = await validator(salesOrderLineValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  if (d.salesOrderLineType === "Comment") {
    d.accountId = undefined;
    d.assetId = undefined;
    d.itemId = undefined;
  } else if (d.salesOrderLineType === "Fixed Asset") {
    d.accountId = undefined;
    d.itemId = undefined;
  } else {
    d.accountId = undefined;
    d.assetId = undefined;
  }

  const updateSalesOrderLine = await upsertSalesOrderLine(client, {
    id: lineId,
    ...d,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (updateSalesOrderLine.error) {
    throw redirect(
      path.to.salesOrderLine(orderId, lineId),
      await flash(
        request,
        error(updateSalesOrderLine.error, "Failed to update sales order line")
      )
    );
  }

  throw redirect(path.to.salesOrderLine(orderId, lineId));
}

export default function EditSalesOrderLineRoute() {
  const { t } = useLingui();
  const { line, jobs, itemReplenishment, files, shipments } =
    useLoaderData<typeof loader>();
  const permissions = usePermissions();
  const { orderId, lineId } = useParams();
  if (!orderId) throw new Error("orderId not found");
  if (!lineId) throw new Error("lineId not found");

  const orderData = useRouteData<{
    salesOrder: SalesOrder;
    opportunity: Opportunity;
  }>(path.to.salesOrder(orderId));

  if (!orderData?.opportunity) throw new Error("Failed to load opportunity");
  if (!orderData?.salesOrder) throw new Error("Failed to load sales order");

  const isReadOnly = isSalesOrderLocked(orderData.salesOrder.status);

  const initialValues = {
    id: line?.id ?? undefined,
    salesOrderId: line?.salesOrderId ?? "",
    salesOrderLineType:
      line?.salesOrderLineType ?? ("Part" as SalesOrderLineType),
    itemId: line?.itemId ?? "",
    accountId: line?.accountId ?? "",
    addOnCost: line?.addOnCost ?? 0,
    assetId: line?.assetId ?? "",
    description: line?.description ?? "",
    locationId: line?.locationId ?? "",
    methodType: line?.methodType ?? "Make to Order",
    nonTaxableAddOnCost: line?.nonTaxableAddOnCost ?? 0,
    promisedDate: line?.promisedDate ?? undefined,
    saleQuantity: line?.saleQuantity ?? 1,
    setupPrice: line?.setupPrice ?? 0,
    storageUnitId: line?.storageUnitId ?? "",
    unitOfMeasureCode: line?.unitOfMeasureCode ?? "",
    unitPrice: line?.unitPrice ?? 0,
    taxPercent: line?.taxPercent ?? 0,
    shippingCost: line?.shippingCost ?? 0,
    assetReadableId: (line as any)?.assetReadableId ?? undefined,
    assetName: (line as any)?.assetName ?? undefined,
    ...getCustomFields(line?.customFields)
  };

  return (
    <Fragment key={lineId}>
      <SalesOrderLineForm
        key={initialValues.id}
        // @ts-ignore
        initialValues={initialValues}
      />

      <OpportunityLineNotes
        id={line.id}
        table="salesOrderLine"
        title={t`Notes`}
        subTitle={line.itemReadableId ?? ""}
        internalNotes={line.internalNotes as JSONContent}
        externalNotes={line.externalNotes as JSONContent}
      />

      {line.methodType === "Make to Order" && (
        <Suspense
          fallback={
            <Card className="min-h-[264px]">
              <CardHeader>
                <CardTitle>
                  <Trans>Jobs</Trans>
                </CardTitle>
              </CardHeader>
            </Card>
          }
        >
          <Await
            resolve={itemReplenishment}
            errorElement={
              <div>
                <Trans>Error loading make method</Trans>
              </div>
            }
          >
            {(resolvedItemReplenishment) => (
              <SalesOrderLineJobs
                salesOrder={orderData.salesOrder}
                line={line}
                opportunity={orderData.opportunity}
                jobs={jobs}
                itemReplenishment={
                  resolvedItemReplenishment.data ?? {
                    lotSize: 0,
                    scrapPercentage: 0
                  }
                }
              />
            )}
          </Await>
        </Suspense>
      )}

      <SalesOrderLineShipments
        salesOrder={orderData.salesOrder}
        line={line}
        opportunity={orderData.opportunity}
        shipments={shipments}
      />

      <DeferredFiles resolve={files}>
        {(resolvedFiles) => (
          <OpportunityLineDocuments
            files={resolvedFiles ?? []}
            id={orderId}
            lineId={lineId}
            itemId={line?.itemId}
            modelUpload={line ?? undefined}
            type="Sales Order"
          />
        )}
      </DeferredFiles>
      <CadModel
        isReadOnly={isReadOnly || !permissions.can("update", "sales")}
        metadata={{
          salesOrderLineId: line?.id ?? undefined,
          itemId: line?.itemId ?? undefined
        }}
        modelPath={line?.modelPath ?? null}
        title={t`CAD Model`}
        uploadClassName="aspect-square min-h-[420px] max-h-[70vh]"
        viewerClassName="aspect-square min-h-[420px] max-h-[70vh]"
      />

      <Outlet />
    </Fragment>
  );
}
