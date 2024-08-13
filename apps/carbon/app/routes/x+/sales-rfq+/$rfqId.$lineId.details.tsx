import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet, useLoaderData, useParams } from "@remix-run/react";
import { Fragment, useMemo } from "react";
import type { Tree } from "~/components/TreeView";
import { usePermissions, useRouteData } from "~/hooks";
import { CadModel } from "~/modules/items";
import type { QuotationPrice, QuoteMethod } from "~/modules/sales";
import {
  getFilesByQuoteLineId,
  getQuoteLine,
  getQuoteLinePrices,
  getQuoteOperationsByLine,
  QuoteLineCosting,
  QuoteLineDocuments,
  QuoteLineForm,
  QuoteLineNotes,
  quoteLineValidator,
  upsertQuoteLine,
  useLineCosts,
} from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales",
  });

  const { quoteId, lineId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!lineId) throw new Error("Could not find lineId");

  const [line, operations, files, prices] = await Promise.all([
    getQuoteLine(client, lineId),
    getQuoteOperationsByLine(client, lineId),
    getFilesByQuoteLineId(client, companyId, lineId),
    getQuoteLinePrices(client, lineId),
  ]);

  if (line.error) {
    throw redirect(
      path.to.quote(quoteId),
      await flash(request, error(line.error, "Failed to load line"))
    );
  }

  return json({
    line: line.data,
    operations: operations?.data ?? [],
    files: files?.data ?? [],
    pricesByQuantity: (prices?.data ?? []).reduce<
      Record<number, QuotationPrice>
    >((acc, price) => {
      acc[price.quantity] = price;
      return acc;
    }, {}),
  });
};

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    create: "sales",
  });

  const { quoteId, lineId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!lineId) throw new Error("Could not find lineId");

  const formData = await request.formData();

  const validation = await validator(quoteLineValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const updateQuotationLine = await upsertQuoteLine(client, {
    id: lineId,
    ...data,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });

  if (updateQuotationLine.error) {
    throw redirect(
      path.to.quoteLine(quoteId, lineId),
      await flash(
        request,
        error(updateQuotationLine.error, "Failed to update quote line")
      )
    );
  }

  throw redirect(path.to.quoteLine(quoteId, lineId));
}

export default function QuoteLine() {
  const { line, operations, files } = useLoaderData<typeof loader>();
  const permissions = usePermissions();
  const { quoteId, lineId } = useParams();
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!lineId) throw new Error("Could not find lineId");

  const quoteData = useRouteData<{ methods: Tree<QuoteMethod>[] }>(
    path.to.quote(quoteId)
  );

  const methodTree = useMemo(
    () => quoteData?.methods?.find((m) => m.data.quoteLineId === line.id),
    [quoteData, line.id]
  );

  const getLineCosts = useLineCosts({
    methodTree,
    operations,
  });

  const initialValues = {
    ...line,
    id: line.id ?? undefined,
    quoteId: line.quoteId ?? "",
    customerPartId: line.customerPartId ?? "",
    customerPartRevision: line.customerPartRevision ?? "",
    description: line.description ?? "",
    estimatorId: line.estimatorId ?? "",
    itemId: line.itemId ?? "",
    itemReadableId: line.itemReadableId ?? "",
    methodType: line.methodType ?? "Make",
    modelUploadId: line.modelUploadId ?? undefined,
    status: line.status ?? "Draft",
    quantity: line.quantity ?? [1],
    unitOfMeasureCode: line.unitOfMeasureCode ?? "",
  };

  return (
    <Fragment key={lineId}>
      <QuoteLineForm key={lineId} initialValues={initialValues} />
      {permissions.is("employee") && (
        <Fragment key={lineId}>
          <div className="grid grid-cols-1 xl:grid-cols-2 w-full flex-grow gap-2 ">
            <CadModel
              autodeskUrn={line?.autodeskUrn ?? null}
              isReadOnly={!permissions.can("update", "sales")}
              metadata={{ quoteLineId: line.id ?? undefined }}
              modelPath={line?.modelPath ?? null}
              title="CAD Model"
              uploadClassName="min-h-[360px]"
              viewerClassName="min-h-[360px]"
            />
            <QuoteLineDocuments
              files={files ?? []}
              quoteId={quoteId}
              quoteLineId={lineId}
              modelUpload={line ?? undefined}
            />
          </div>
          <QuoteLineNotes line={line} />
          {line.methodType === "Make" && (
            <QuoteLineCosting
              quantities={line.quantity ?? [1]}
              getLineCosts={getLineCosts}
            />
          )}

          <Outlet />
        </Fragment>
      )}
    </Fragment>
  );
}
