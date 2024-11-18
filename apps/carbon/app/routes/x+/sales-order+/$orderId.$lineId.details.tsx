import {
  assertIsPost,
  error,
  getCarbonServiceRole,
  notFound,
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import { Card, CardHeader, CardTitle, Spinner } from "@carbon/react";
import { Await, Outlet, useLoaderData, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { defer, redirect } from "@vercel/remix";
import { Suspense } from "react";
import { CadModel } from "~/components";
import { usePermissions, useRouteData } from "~/hooks";
import { getItemReplenishment } from "~/modules/items";
import { getJobsBySalesOrderLine } from "~/modules/production";
import type {
  Opportunity,
  SalesOrder,
  SalesOrderLineType,
} from "~/modules/sales";
import {
  OpportunityLineDocuments,
  OpportunityLineNotes,
  SalesOrderLineForm,
  SalesOrderLineJobs,
  getOpportunityLineDocuments,
  getSalesOrderLine,
  salesOrderLineValidator,
  upsertSalesOrderLine,
} from "~/modules/sales";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    view: "sales",
    role: "employee",
  });

  const { orderId, lineId } = params;
  if (!orderId) throw notFound("orderId not found");
  if (!lineId) throw notFound("lineId not found");

  const serviceRole = await getCarbonServiceRole();

  const [line, jobs] = await Promise.all([
    getSalesOrderLine(serviceRole, lineId),
    getJobsBySalesOrderLine(serviceRole, lineId),
  ]);

  if (line.error) {
    throw redirect(
      path.to.salesOrder(orderId),
      await flash(request, error(line.error, "Failed to load sales order line"))
    );
  }

  return defer({
    line: line?.data ?? null,
    itemReplenishment:
      line.data.itemId && line.data.methodType === "Make"
        ? getItemReplenishment(serviceRole, line.data.itemId, companyId)
        : Promise.resolve({ data: null }),
    files: getOpportunityLineDocuments(serviceRole, companyId, lineId),
    jobs: jobs?.data ?? [],
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    create: "sales",
  });

  const { orderId, lineId } = params;
  if (!orderId) throw new Error("Could not find orderId");
  if (!lineId) throw new Error("Could not find lineId");

  const formData = await request.formData();
  const validation = await validator(salesOrderLineValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  if (data.salesOrderLineType === "Comment") {
    data.accountNumber = undefined;
    data.assetId = undefined;
    data.itemId = undefined;
  } else if (data.salesOrderLineType === "Fixed Asset") {
    data.accountNumber = undefined;
    data.itemId = undefined;
  } else {
    data.accountNumber = undefined;
    data.assetId = undefined;
  }

  const updateSalesOrderLine = await upsertSalesOrderLine(client, {
    id: lineId,
    ...data,
    updatedBy: userId,
    customFields: setCustomFields(formData),
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
  const { line, jobs, itemReplenishment, files } =
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

  const initialValues = {
    id: line?.id ?? undefined,
    salesOrderId: line?.salesOrderId ?? "",
    salesOrderLineType:
      line?.salesOrderLineType ?? ("Part" as SalesOrderLineType),
    itemId: line?.itemId ?? "",
    accountNumber: line?.accountNumber ?? "",
    addOnCost: line?.addOnCost ?? 0,
    assetId: line?.assetId ?? "",
    description: line?.description ?? "",
    itemReadableId: line?.itemReadableId ?? "",
    locationId: line?.locationId ?? "",
    methodType: line?.methodType ?? "Make",
    promisedDate: line?.promisedDate ?? undefined,
    saleQuantity: line?.saleQuantity ?? 1,
    setupPrice: line?.setupPrice ?? 0,
    shelfId: line?.shelfId ?? "",
    unitOfMeasureCode: line?.unitOfMeasureCode ?? "",
    unitPrice: line?.unitPrice ?? 0,
    taxPercent: line?.taxPercent ?? 0,
    shippingCost: line?.shippingCost ?? 0,
    ...getCustomFields(line?.customFields),
  };

  return (
    <>
      <SalesOrderLineForm
        key={initialValues.id}
        // @ts-ignore
        initialValues={initialValues}
      />
      <OpportunityLineNotes
        id={line.id}
        table="salesOrderLine"
        title={orderData.salesOrder.salesOrderId ?? ""}
        subTitle={line.customerPartId ?? ""}
        notes={line.notes as JSONContent}
      />
      {line.methodType === "Make" && (
        <Suspense
          fallback={
            <Card className="min-h-[264px]">
              <CardHeader>
                <CardTitle>Jobs</CardTitle>
              </CardHeader>
            </Card>
          }
        >
          <Await
            resolve={itemReplenishment}
            errorElement={<div>Error loading make method</div>}
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
                    scrapPercentage: 0,
                  }
                }
              />
            )}
          </Await>
        </Suspense>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 w-full flex-grow gap-2 ">
        <CadModel
          isReadOnly={!permissions.can("update", "sales")}
          metadata={{
            salesOrderLineId: line?.id ?? undefined,
            itemId: line?.itemId ?? undefined,
          }}
          modelPath={line?.modelPath ?? null}
          title="CAD Model"
          uploadClassName="min-h-[420px]"
          viewerClassName="min-h-[420px]"
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
              <OpportunityLineDocuments
                files={resolvedFiles ?? []}
                id={orderId}
                lineId={lineId}
                modelUpload={line ?? undefined}
                type="Sales Order"
              />
            )}
          </Await>
        </Suspense>
      </div>
      <Outlet />
    </>
  );
}
