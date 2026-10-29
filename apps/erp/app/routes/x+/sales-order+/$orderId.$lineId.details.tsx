// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { JSONContent } from "@carbon/react";
import { Card, CardHeader, CardTitle, RecordOutlet } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { Fragment, Suspense } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Await, useLoaderData, useParams } from "react-router";
import { CadModel, DeferredFiles } from "~/components";
import { usePermissions, useRouteData } from "~/hooks";
import { getItemReplenishment } from "~/modules/items/items.service";
import { getJobsBySalesOrderLine } from "~/modules/production/production.service";
import {
  isSalesOrderLocked,
  salesOrderLineValidator
} from "~/modules/sales/sales.models";
import {
  getOpportunityLineDocuments,
  getSalesOrderLine,
  getSalesOrderLineShipments
} from "~/modules/sales/sales.service";
import type {
  Opportunity,
  PriceTraceStep,
  SalesOrder,
  SalesOrderLineType
} from "~/modules/sales/types";
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
import { path } from "~/utils/path";

const logger = getLogger("erp", "sales-order-line-details");

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

  // The service role bypasses RLS and lineId comes from the URL: the line must
  // belong to this company and to the order in the URL.
  if (line.data.companyId !== companyId || line.data.salesOrderId !== orderId) {
    logger.error("Sales order line not found for company", {
      companyId,
      orderId,
      lineId
    });
    throw notFound("Sales order line not found");
  }

  const itemId = line.data.itemId;

  return {
    line: line?.data ?? null,
    itemReplenishment:
      itemId && line.data.methodType === "Make to Order"
        ? getItemReplenishment(serviceRole, itemId, companyId)
        : Promise.resolve({ data: null }),
    files: getOpportunityLineDocuments(serviceRole, companyId, lineId, itemId),
    jobs: (jobs?.data ?? []).filter((job) => job.companyId === companyId),
    shipments: (shipments?.data ?? []).filter(
      (shipment) => shipment.companyId === companyId
    )
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(salesOrderLineValidator).request(args, {
    params: ["orderId", "lineId"]
  });
  if ("invalid" in input) return input.invalid;
  const { orderId, lineId } = input.params;
  const formData = input.formData ?? new FormData();
  const api = await carbon(args.request);
  const result = await api.sales.updateSalesOrderLine({
    ...input.data,
    id: lineId,
    salesOrderId: orderId,
    customFields: setCustomFields(formData),
    acknowledged: formData.get("acknowledged") === "true"
  });
  // An error is toasted; the violation modal reads `violations`.
  if (!result.data) return result;
  if ("violations" in result.data) return result.data;
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
    serviceStartDate: line?.serviceStartDate ?? "",
    serviceEndDate: line?.serviceEndDate ?? "",
    saleQuantity: line?.saleQuantity ?? 1,
    setupPrice: line?.setupPrice ?? 0,
    storageUnitId: line?.storageUnitId ?? "",
    unitOfMeasureCode: line?.unitOfMeasureCode ?? "",
    unitPrice: line?.unitPrice ?? 0,
    taxPercent: line?.taxPercent ?? 0,
    shippingCost: line?.shippingCost ?? 0,
    configuration:
      (line?.configuration as Record<string, unknown> | null) ?? null,
    priceTrace: (line?.priceTrace as PriceTraceStep[] | null) ?? null,
    assetReadableId: (line as any)?.assetReadableId ?? undefined,
    assetName: (line as any)?.assetName ?? undefined,
    ...getCustomFields(line?.customFields)
  };

  return (
    <Fragment key={lineId}>
      <SalesOrderLineForm
        key={initialValues.id}
        // @ts-expect-error
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

      {line.salesOrderLineType !== "Service" && (
        <SalesOrderLineShipments
          salesOrder={orderData.salesOrder}
          line={line}
          opportunity={orderData.opportunity}
          shipments={shipments}
        />
      )}

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
        modelUpload={line ?? null}
        title={t`CAD Model`}
        uploadClassName="aspect-square min-h-[420px] max-h-[70vh]"
        viewerClassName="aspect-square min-h-[420px] max-h-[70vh]"
      />

      <RecordOutlet />
    </Fragment>
  );
}
