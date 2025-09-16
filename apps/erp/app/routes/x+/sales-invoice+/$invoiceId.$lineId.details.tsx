import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import { Spinner } from "@carbon/react";
import { getItemReadableId } from "@carbon/utils";
import { Await, Outlet, useLoaderData, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { defer, redirect } from "@vercel/remix";
import { Suspense } from "react";
import { Fragment } from "react/jsx-runtime";
import {
  getSalesInvoiceLine,
  salesInvoiceLineValidator,
  upsertSalesInvoiceLine,
} from "~/modules/invoicing";
import SalesInvoiceLineForm from "~/modules/invoicing/ui/SalesInvoice/SalesInvoiceLineForm";
import { getOpportunityLineDocuments } from "~/modules/sales";
import {
  OpportunityLineDocuments,
  OpportunityLineNotes,
} from "~/modules/sales/ui/Opportunity";
import { useItems } from "~/stores";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "invoicing",
    role: "employee",
  });

  const { lineId } = params;
  if (!lineId) throw notFound("lineId not found");

  const salesInvoiceLine = await getSalesInvoiceLine(client, lineId);

  const itemId = salesInvoiceLine?.data?.itemId;

  return defer({
    salesInvoiceLine: salesInvoiceLine?.data ?? null,
    files: getOpportunityLineDocuments(client, companyId, lineId, itemId),
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    create: "invoicing",
  });

  const { invoiceId, lineId } = params;
  if (!invoiceId) throw new Error("Could not find invoiceId");
  if (!lineId) throw new Error("Could not find lineId");

  const formData = await request.formData();
  const validation = await validator(salesInvoiceLineValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  // if (data.invoiceLineType === "G/L Account") {
  //   data.assetId = undefined;
  //   data.itemId = undefined;
  // } else if (data.invoiceLineType === "Fixed Asset") {
  //   data.accountNumber = undefined;
  //   data.itemId = undefined;
  // } else
  // if (data.invoiceLineType === "Comment") {
  //   data.accountNumber = undefined;
  //   data.assetId = undefined;
  //   data.itemId = undefined;
  // } else {
  //   data.accountNumber = undefined;
  //   data.assetId = undefined;
  // }

  const updateSalesInvoiceLine = await upsertSalesInvoiceLine(client, {
    id: lineId,
    ...data,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });

  if (updateSalesInvoiceLine.error) {
    throw redirect(
      path.to.salesInvoiceLine(invoiceId, lineId),
      await flash(
        request,
        error(
          updateSalesInvoiceLine.error,
          "Failed to update sales invoice line"
        )
      )
    );
  }

  throw redirect(path.to.salesInvoiceLine(invoiceId, lineId));
}

export default function EditSalesInvoiceLineRoute() {
  const { invoiceId, lineId } = useParams();
  if (!invoiceId) throw notFound("invoiceId not found");
  if (!lineId) throw notFound("lineId not found");

  const { salesInvoiceLine, files } = useLoaderData<typeof loader>();

  const initialValues = {
    id: salesInvoiceLine?.id ?? undefined,
    invoiceId: salesInvoiceLine?.invoiceId ?? "",
    invoiceLineType: (salesInvoiceLine?.invoiceLineType ?? "Part") as "Part",
    methodType: (salesInvoiceLine?.methodType ?? "Pick") as "Pick",
    itemId: salesInvoiceLine?.itemId ?? "",
    accountNumber: salesInvoiceLine?.accountNumber ?? "",
    addOnCost: salesInvoiceLine?.addOnCost ?? 0,
    assetId: salesInvoiceLine?.assetId ?? "",
    description: salesInvoiceLine?.description ?? "",
    quantity: salesInvoiceLine?.quantity ?? 1,
    unitPrice: salesInvoiceLine?.unitPrice ?? 0,
    shippingCost: salesInvoiceLine?.shippingCost ?? 0,
    taxPercent: salesInvoiceLine?.taxPercent ?? 0,
    exchangeRate: salesInvoiceLine?.exchangeRate ?? 1,
    unitOfMeasureCode: salesInvoiceLine?.unitOfMeasureCode ?? "",
    shelfId: salesInvoiceLine?.shelfId ?? "",
    ...getCustomFields(salesInvoiceLine?.customFields),
  };

  const [items] = useItems();

  return (
    <Fragment key={salesInvoiceLine?.id}>
      <SalesInvoiceLineForm
        key={initialValues.id}
        initialValues={initialValues}
        isSalesOrderLine={salesInvoiceLine?.salesOrderLineId !== undefined}
      />
      <OpportunityLineNotes
        id={salesInvoiceLine?.id ?? ""}
        table="salesInvoiceLine"
        title="Notes"
        subTitle={getItemReadableId(items, salesInvoiceLine?.itemId) ?? ""}
        internalNotes={salesInvoiceLine?.internalNotes as JSONContent}
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
              id={invoiceId}
              lineId={lineId}
              itemId={salesInvoiceLine?.itemId}
              type="Sales Invoice"
            />
          )}
        </Await>
      </Suspense>

      <Outlet />
    </Fragment>
  );
}
