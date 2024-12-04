import { assertIsPost, error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import { Spinner } from "@carbon/react";
import { Await, Outlet, useLoaderData, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { defer, redirect } from "@vercel/remix";
import { Fragment, Suspense } from "react";
import { CadModel } from "~/components";
import { usePermissions } from "~/hooks";
import type { SupplierQuoteLinePrice } from "~/modules/purchasing";
import {
  getSupplierInteractionLineDocuments,
  getSupplierQuoteLinePrices,
  getSupplierQuoteLines,
  SupplierInteractionLineDocuments,
  SupplierInteractionLineNotes,
  SupplierQuoteLineForm,
  supplierQuoteLineValidator,
  upsertSupplierQuoteLine,
} from "~/modules/purchasing";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export const config = {
  runtime: "nodejs",
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { companyId } = await requirePermissions(request, {
    view: "purchasing",
  });

  const { id, lineId } = params;
  if (!id) throw new Error("Could not find id");
  if (!lineId) throw new Error("Could not find lineId");

  const serviceRole = await getCarbonServiceRole();

  const [line, prices] = await Promise.all([
    getSupplierQuoteLines(serviceRole, lineId),
    getSupplierQuoteLinePrices(serviceRole, lineId),
  ]);

  if (line.error) {
    throw redirect(
      path.to.quote(id),
      await flash(request, error(line.error, "Failed to load line"))
    );
  }

  return defer({
    line: line.data,
    files: getSupplierInteractionLineDocuments(serviceRole, companyId, lineId),
    pricesByQuantity: (prices?.data ?? []).reduce<
      Record<number, SupplierQuoteLinePrice>
    >((acc, price) => {
      acc[price.quantity] = price;
      return acc;
    }, {}),
  });
};

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    create: "purchasing",
  });

  const { id, lineId } = params;
  if (!id) throw new Error("Could not find id");
  if (!lineId) throw new Error("Could not find lineId");

  const formData = await request.formData();

  const validation = await validator(supplierQuoteLineValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _id, ...data } = validation.data;

  const updateSupplierQuoteLine = await upsertSupplierQuoteLine(client, {
    id: lineId,
    ...data,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });

  if (updateSupplierQuoteLine.error) {
    throw redirect(
      path.to.quoteLine(id, lineId),
      await flash(
        request,
        error(updateSupplierQuoteLine.error, "Failed to update quote line")
      )
    );
  }

  throw redirect(path.to.quoteLine(id, lineId));
}

export default function QuoteLine() {
  const { line, files, pricesByQuantity } = useLoaderData<typeof loader>();
  const permissions = usePermissions();
  const { id, lineId } = useParams();
  if (!id) throw new Error("Could not find id");
  if (!lineId) throw new Error("Could not find lineId");

  const initialValues = {
    ...line,
    id: line.id ?? undefined,
    purchasingQuoteId: line.purchasingQuoteId ?? "",
    customerPartId: line.customerPartId ?? "",
    customerPartRevision: line.customerPartRevision ?? "",
    description: line.description ?? "",
    estimatorId: line.estimatorId ?? "",
    itemId: line.itemId ?? "",
    itemReadableId: line.itemReadableId ?? "",
    methodType: line.methodType ?? "Make",
    modelUploadId: line.modelUploadId ?? undefined,
    noQuoteReason: line.noQuoteReason ?? undefined,
    status: line.status ?? "Not Started",
    quantity: line.quantity ?? [1],
    unitOfMeasureCode: line.unitOfMeasureCode ?? "",
    taxPercent: line.taxPercent ?? 0,
  };

  return (
    <Fragment key={lineId}>
      <SupplierQuoteLineForm key={lineId} initialValues={initialValues} />
      <SupplierInteractionLineNotes
        id={line.id}
        table="supplierQuoteLine"
        title="Notes"
        subTitle={line.itemReadableId ?? ""}
        notes={line.notes as JSONContent}
      />
      <div className="grid grid-cols-1 2xl:grid-cols-2 w-full flex-grow gap-2 ">
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
                id={id}
                lineId={lineId}
                type="Supplier Quote"
              />
            )}
          </Await>
        </Suspense>

        <CadModel
          isReadOnly={!permissions.can("update", "purchasing")}
          metadata={{
            quoteLineId: line.id ?? undefined,
            itemId: line.itemId ?? undefined,
          }}
          modelPath={line?.modelPath ?? null}
          title="CAD Model"
          uploadClassName="aspect-square min-h-[420px] max-h-[70vh]"
          viewerClassName="aspect-square min-h-[420px] max-h-[70vh]"
        />
      </div>

      <QuoteLinePricing line={line} pricesByQuantity={pricesByQuantity} />

      <Outlet />
    </Fragment>
  );
}
