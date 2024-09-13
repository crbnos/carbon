import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet, useLoaderData, useParams } from "@remix-run/react";
import { usePermissions } from "~/hooks";
import type { SalesOrderLineType } from "~/modules/sales";
import {
  OpportunityLineDocuments,
  SalesOrderLineForm,
  getOpportunityLineDocuments,
  getSalesOrderLine,
  salesOrderLineValidator,
  upsertSalesOrderLine,
} from "~/modules/sales";
import { CadModel } from "~/modules/shared";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { assertIsPost, notFound } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales",
    role: "employee",
  });

  const { lineId } = params;
  if (!lineId) throw notFound("lineId not found");

  const [line, files] = await Promise.all([
    getSalesOrderLine(client, lineId),
    getOpportunityLineDocuments(client, companyId, lineId),
  ]);

  return json({
    line: line?.data ?? null,
    files: files?.data ?? [],
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
  const { line, files } = useLoaderData<typeof loader>();
  const permissions = usePermissions();
  const { orderId, lineId } = useParams();
  if (!orderId) throw new Error("orderId not found");
  if (!lineId) throw new Error("lineId not found");

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
    locationId: line?.locationId ?? undefined,
    methodType: line?.methodType ?? "Make",
    promisedDate: line?.promisedDate ?? undefined,
    saleQuantity: line?.saleQuantity ?? 1,
    setupPrice: line?.setupPrice ?? 0,
    shelfId: line?.shelfId ?? "",
    unitOfMeasureCode: line?.unitOfMeasureCode ?? "",
    unitPrice: line?.unitPrice ?? 0,
    ...getCustomFields(line?.customFields),
  };

  return (
    <>
      <SalesOrderLineForm
        key={initialValues.id}
        initialValues={initialValues}
      />

      <div className="grid grid-cols-1 xl:grid-cols-2 w-full flex-grow gap-2 ">
        <CadModel
          autodeskUrn={line?.autodeskUrn ?? null}
          isReadOnly={!permissions.can("update", "sales")}
          metadata={{ salesOrderLineId: line?.id ?? undefined }}
          modelPath={line?.modelPath ?? null}
          title="CAD Model"
          uploadClassName="min-h-[360px]"
          viewerClassName="min-h-[360px]"
        />
        <OpportunityLineDocuments
          files={files ?? []}
          id={orderId}
          lineId={lineId}
          modelUpload={line ?? undefined}
          type="Sales Order"
        />
      </div>
      {/* <SalesOrderLineNotes line={line} /> */}

      <Outlet />
    </>
  );
}
