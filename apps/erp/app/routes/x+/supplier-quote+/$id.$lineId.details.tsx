import { assertIsPost, error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import { Spinner } from "@carbon/react";
import { useRouteData } from "@carbon/remix";
import { Await, Outlet, useLoaderData, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { defer, redirect } from "@vercel/remix";
import { Fragment, Suspense } from "react";
import type {
  SupplierQuote,
  SupplierQuoteLinePrice,
} from "~/modules/purchasing";
import {
  getSupplierInteractionLineDocuments,
  getSupplierQuoteLine,
  getSupplierQuoteLinePrices,
  supplierQuoteLineValidator,
  upsertSupplierQuoteLine,
} from "~/modules/purchasing";
import {
  SupplierInteractionLineDocuments,
  SupplierInteractionLineNotes,
} from "~/modules/purchasing/ui/SupplierInteraction";
import {
  SupplierQuoteLineForm,
  SupplierQuoteLinePricing,
} from "~/modules/purchasing/ui/SupplierQuote";
import type { MethodItemType } from "~/modules/shared";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { companyId } = await requirePermissions(request, {
    view: "purchasing",
  });

  const { id, lineId } = params;
  if (!id) throw new Error("Could not find id");
  if (!lineId) throw new Error("Could not find lineId");

  const serviceRole = await getCarbonServiceRole();

  const [line, prices] = await Promise.all([
    getSupplierQuoteLine(serviceRole, lineId),
    getSupplierQuoteLinePrices(serviceRole, lineId),
  ]);

  if (line.error) {
    throw redirect(
      path.to.supplierQuote(id),
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
      path.to.supplierQuoteLine(id, lineId),
      await flash(
        request,
        error(
          updateSupplierQuoteLine.error,
          "Failed to update supplierQuote line"
        )
      )
    );
  }

  throw redirect(path.to.supplierQuoteLine(id, lineId));
}

export default function SupplierQuoteLine() {
  const { line, files, pricesByQuantity } = useLoaderData<typeof loader>();

  const { id, lineId } = useParams();
  if (!id) throw new Error("Could not find id");
  if (!lineId) throw new Error("Could not find lineId");

  const routeData = useRouteData<{
    quote: SupplierQuote;
  }>(path.to.supplierQuote(id));

  const exchangeRate = routeData?.quote?.exchangeRate ?? 1;

  const initialValues = {
    ...line,
    id: line.id ?? undefined,
    supplierQuoteId: line.supplierQuoteId ?? "",
    supplierPartId: line.supplierPartId ?? "",
    supplierPartRevision: line.supplierPartRevision ?? "",
    description: line.description ?? "",
    itemId: line.itemId ?? "",
    quantity: line.quantity ?? [1],
    inventoryUnitOfMeasureCode: line.inventoryUnitOfMeasureCode ?? "",
    purchaseUnitOfMeasureCode: line.purchaseUnitOfMeasureCode ?? "",
    conversionFactor: line.conversionFactor ?? undefined,
    itemType: (line.itemType ?? "Part") as MethodItemType,
  };

  return (
    <Fragment key={lineId}>
      <SupplierQuoteLineForm key={lineId} initialValues={initialValues} />
      <SupplierQuoteLinePricing
        line={line}
        pricesByQuantity={pricesByQuantity}
        exchangeRate={exchangeRate}
      />
      <SupplierInteractionLineNotes
        id={line.id}
        table="supplierQuoteLine"
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
              id={id}
              lineId={lineId}
              type="Supplier Quote"
            />
          )}
        </Await>
      </Suspense>

      <Outlet />
    </Fragment>
  );
}
