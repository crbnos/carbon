import { assertIsPost, error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import { Spinner, VStack } from "@carbon/react";
import { Fragment, Suspense, useMemo } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Await,
  Outlet,
  redirect,
  useLoaderData,
  useParams
} from "react-router";
import { CadModel } from "~/components";
import type { Tree } from "~/components/TreeView";
import { usePermissions, useRealtime, useRouteData, useUser } from "~/hooks";
import type {
  Quotation,
  QuotationOperation,
  QuotationPrice,
  QuoteMethod
} from "~/modules/sales";
import {
  getConfigurationParametersByQuoteLineId,
  getModelByQuoteLineId,
  getOpportunityLineDocuments,
  getQuoteLine,
  getQuoteLinePrices,
  getQuoteMaterialsByMethodId,
  getQuoteOperationsByLine,
  getQuoteOperationsByMethodId,
  getRelatedPricesForQuoteLine,
  getRootQuoteMakeMethod,
  quoteLineValidator,
  upsertQuoteLine
} from "~/modules/sales";
import {
  OpportunityLineDocuments,
  OpportunityLineNotes
} from "~/modules/sales/ui/Opportunity";
import {
  QuoteBillOfMaterial,
  QuoteBillOfProcess,
  QuoteLineCosting,
  QuoteLineForm,
  QuoteLinePricing,
  QuoteMakeMethodTools,
  useLineCosts
} from "~/modules/sales/ui/Quotes";
import QuoteLinePricingHistory from "~/modules/sales/ui/Quotes/QuoteLinePricingHistory";
import QuoteLineRiskRegister from "~/modules/sales/ui/Quotes/QuoteLineRiskRegister";
import { getTagsList } from "~/modules/shared";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });

  const { quoteId, lineId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!lineId) throw new Error("Could not find lineId");

  const serviceRole = await getCarbonServiceRole();

  const [line, operations, prices] = await Promise.all([
    getQuoteLine(serviceRole, lineId),
    getQuoteOperationsByLine(serviceRole, lineId),
    getQuoteLinePrices(serviceRole, lineId)
  ]);

  if (line.error) {
    throw redirect(
      path.to.quote(quoteId),
      await flash(request, error(line.error, "Failed to load line"))
    );
  }

  const itemId = line.data.itemId!;

  const rootMethod = await getRootQuoteMakeMethod(serviceRole, lineId);

  const methodData = rootMethod.data
    ? await (async () => {
        const methodId = rootMethod.data.id;
        const [materials, methodOperations, tags] = await Promise.all([
          getQuoteMaterialsByMethodId(serviceRole, methodId),
          getQuoteOperationsByMethodId(serviceRole, methodId),
          getTagsList(client, companyId, "operation")
        ]);

        return {
          methodMaterials:
            materials?.data?.map((m) => ({
              ...m,
              itemType: m.itemType as "Part",
              unitOfMeasureCode: m.unitOfMeasureCode ?? "",
              quoteOperationId: m.quoteOperationId ?? undefined
            })) ?? [],
          methodOperations:
            methodOperations.data?.map((o) => ({
              ...o,
              description: o.description ?? "",
              workCenterId: o.workCenterId ?? undefined,
              laborRate: o.laborRate ?? 0,
              machineRate: o.machineRate ?? 0,
              operationSupplierProcessId:
                o.operationSupplierProcessId ?? undefined,
              quoteMakeMethodId: o.quoteMakeMethodId ?? methodId,
              workInstruction: o.workInstruction as JSONContent,
              tags: o.tags ?? []
            })) ?? [],
          configurationParameters: getConfigurationParametersByQuoteLineId(
            serviceRole,
            lineId,
            companyId
          ),
          model: getModelByQuoteLineId(serviceRole, lineId),
          tags: tags.data ?? [],
          rootMethodId: methodId
        };
      })()
    : null;

  return {
    line: line.data,
    operations: operations?.data ?? [],
    files: getOpportunityLineDocuments(serviceRole, companyId, lineId, itemId),
    pricesByQuantity: (prices?.data ?? []).reduce<
      Record<number, QuotationPrice>
    >((acc, price) => {
      acc[price.quantity] = price;
      return acc;
    }, {}),
    relatedPrices: getRelatedPricesForQuoteLine(serviceRole, itemId, quoteId),
    methodData
  };
};

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    create: "sales"
  });

  const { quoteId, lineId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!lineId) throw new Error("Could not find lineId");

  const formData = await request.formData();

  const validation = await validator(quoteLineValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  const updateQuotationLine = await upsertQuoteLine(client, {
    id: lineId,
    ...d,
    updatedBy: userId,
    customFields: setCustomFields(formData)
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
  const {
    line,
    operations,
    files,
    pricesByQuantity,
    relatedPrices,
    methodData
  } = useLoaderData<typeof loader>();
  const permissions = usePermissions();
  const { quoteId, lineId } = useParams();
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!lineId) throw new Error("Could not find lineId");

  const { company } = useUser();
  const baseCurrency = company?.baseCurrencyCode ?? "USD";

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
    line
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
    methodType: line.methodType ?? "Make",
    modelUploadId: line.modelUploadId ?? undefined,
    noQuoteReason: line.noQuoteReason ?? undefined,
    status: line.status ?? "Not Started",
    quantity: line.quantity ?? [1],
    unitOfMeasureCode: line.unitOfMeasureCode ?? "",
    taxPercent: line.taxPercent ?? 0,
    ...getCustomFields(line.customFields)
  };

  return (
    <Fragment key={lineId}>
      <QuoteMakeMethodTools />
      <QuoteLineForm key={lineId} initialValues={initialValues} />
      <OpportunityLineNotes
        id={line.id}
        table="quoteLine"
        title="Notes"
        subTitle={line.itemReadableId ?? ""}
        internalNotes={line.internalNotes as JSONContent}
        externalNotes={line.externalNotes as JSONContent}
      />

      {methodData && (
        <VStack spacing={2}>
          <QuoteBillOfMaterial
            key={`bom:${methodData.rootMethodId}`}
            quoteMakeMethodId={methodData.rootMethodId}
            // @ts-ignore
            materials={methodData.methodMaterials}
            // @ts-expect-error
            operations={methodData.methodOperations}
          />
          <QuoteBillOfProcess
            key={`bop:${methodData.rootMethodId}`}
            quoteMakeMethodId={methodData.rootMethodId}
            // @ts-expect-error
            operations={methodData.methodOperations}
            tags={methodData.tags ?? []}
          />
        </VStack>
      )}

      {line.methodType === "Make" &&
        line.status !== "No Quote" &&
        permissions.is("employee") && (
          <QuoteLineCosting
            quantities={line.quantity ?? [1]}
            getLineCosts={getLineCosts}
            unitPricePrecision={line.unitPricePrecision ?? 2}
          />
        )}
      {line.status !== "No Quote" && (
        <>
          <Suspense fallback={null}>
            <Await resolve={relatedPrices}>
              {(resolvedPrices) => {
                const hasRelatedOrders =
                  resolvedPrices?.relatedSalesOrderLines &&
                  resolvedPrices.relatedSalesOrderLines.length > 0;
                const hasHistoricalPrices =
                  resolvedPrices?.historicalQuoteLinePrices &&
                  resolvedPrices.historicalQuoteLinePrices.length > 0;

                return (
                  (hasRelatedOrders || hasHistoricalPrices) && (
                    <QuoteLinePricingHistory
                      relatedSalesOrderLines={
                        resolvedPrices?.relatedSalesOrderLines ?? []
                      }
                      historicalQuoteLinePrices={
                        resolvedPrices?.historicalQuoteLinePrices ?? []
                      }
                      baseCurrency={baseCurrency}
                    />
                  )
                );
              }}
            </Await>
          </Suspense>
          <QuoteLinePricing
            key={lineId}
            line={line}
            exchangeRate={quoteData?.quote?.exchangeRate ?? 1}
            pricesByQuantity={pricesByQuantity}
            getLineCosts={getLineCosts}
          />
        </>
      )}

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
              itemId={line?.itemId}
              modelUpload={line ?? undefined}
              type="Quote"
            />
          )}
        </Await>
      </Suspense>

      {methodData ? (
        <Suspense fallback={null}>
          <Await resolve={methodData.model}>
            {(model) => (
              <CadModel
                key={`cad:${model?.itemId}`}
                isReadOnly={!permissions.can("update", "sales")}
                metadata={{
                  quoteLineId: lineId ?? undefined,
                  itemId: model?.itemId ?? undefined
                }}
                modelPath={model?.modelPath ?? null}
                title="CAD Model"
                uploadClassName="aspect-square min-h-[420px] max-h-[70vh]"
                viewerClassName="aspect-square min-h-[420px] max-h-[70vh]"
              />
            )}
          </Await>
        </Suspense>
      ) : (
        <CadModel
          isReadOnly={!permissions.can("update", "sales")}
          metadata={{
            quoteLineId: line.id ?? undefined,
            itemId: line.itemId ?? undefined
          }}
          modelPath={line?.modelPath ?? null}
          title="CAD Model"
          uploadClassName="aspect-square min-h-[420px] max-h-[70vh]"
          viewerClassName="aspect-square min-h-[420px] max-h-[70vh]"
        />
      )}

      <QuoteLineRiskRegister quoteLineId={lineId} itemId={line.itemId ?? ""} />

      <Outlet />
    </Fragment>
  );
}
