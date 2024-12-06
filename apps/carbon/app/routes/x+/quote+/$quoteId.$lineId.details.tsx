import { assertIsPost, error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import { Spinner } from "@carbon/react";
import { Await, Outlet, useLoaderData, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { defer, redirect } from "@vercel/remix";
import { Fragment, Suspense, useMemo } from "react";
import { CadModel } from "~/components";
import type { Tree } from "~/components/TreeView";
import { usePermissions, useRealtime, useRouteData } from "~/hooks";
import type {
  Quotation,
  QuotationOperation,
  QuotationPrice,
  QuoteMethod,
} from "~/modules/sales";
import {
  getOpportunityLineDocuments,
  getQuoteLine,
  getQuoteLinePrices,
  getQuoteOperationsByLine,
  OpportunityLineDocuments,
  OpportunityLineNotes,
  QuoteLineCosting,
  QuoteLineForm,
  QuoteLinePricing,
  quoteLineValidator,
  upsertQuoteLine,
  useLineCosts,
} from "~/modules/sales";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { companyId } = await requirePermissions(request, {
    view: "sales",
  });

  const { quoteId, lineId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!lineId) throw new Error("Could not find lineId");

  const serviceRole = await getCarbonServiceRole();

  const [line, operations, prices] = await Promise.all([
    getQuoteLine(serviceRole, lineId),
    getQuoteOperationsByLine(serviceRole, lineId),
    getQuoteLinePrices(serviceRole, lineId),
  ]);

  if (line.error) {
    throw redirect(
      path.to.quote(quoteId),
      await flash(request, error(line.error, "Failed to load line"))
    );
  }

  return defer({
    line: line.data,
    operations: operations?.data ?? [],
    files: getOpportunityLineDocuments(serviceRole, companyId, lineId),
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
  const { line, operations, files, pricesByQuantity } =
    useLoaderData<typeof loader>();
  const permissions = usePermissions();
  const { quoteId, lineId } = useParams();
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!lineId) throw new Error("Could not find lineId");

  // useRealtime("quoteLine", `id=eq.${lineId}`);
  useRealtime("quoteMaterial", `quoteLineId=eq.${lineId}`);
  useRealtime("quoteOperation", `quoteLineId=eq.${lineId}`);

  const quoteData = useRouteData<{
    methods: Tree<QuoteMethod>[];
    quote: Quotation;
  }>(path.to.quote(quoteId));

  const methodTree = useMemo(
    () => quoteData?.methods?.find((m) => m.data.quoteLineId === line.id),
    [quoteData, line.id]
  );

  const getLineCosts = useLineCosts({
    methodTree,
    operations: operations as QuotationOperation[],
    unitCost: line.unitCost ?? 0,
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
    noQuoteReason: line.noQuoteReason ?? undefined,
    status: line.status ?? "Not Started",
    quantity: line.quantity ?? [1],
    unitOfMeasureCode: line.unitOfMeasureCode ?? "",
    taxPercent: line.taxPercent ?? 0,
  };

  return (
    <Fragment key={lineId}>
      <QuoteLineForm key={lineId} initialValues={initialValues} />
      {line.status !== "No Quote" && (
        <QuoteLinePricing
          key={lineId}
          line={line}
          pricesByQuantity={pricesByQuantity}
          getLineCosts={getLineCosts}
        />
      )}
      {line.methodType === "Make" && line.status !== "No Quote" && (
        <QuoteLineCosting
          quantities={line.quantity ?? [1]}
          getLineCosts={getLineCosts}
        />
      )}
      <OpportunityLineNotes
        id={line.id}
        table="quoteLine"
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
              <OpportunityLineDocuments
                files={resolvedFiles ?? []}
                id={quoteId}
                lineId={lineId}
                modelUpload={line ?? undefined}
                type="Quote"
              />
            )}
          </Await>
        </Suspense>

        <CadModel
          isReadOnly={!permissions.can("update", "sales")}
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

      <Outlet />
    </Fragment>
  );
}
