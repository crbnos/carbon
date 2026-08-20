import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import { VStack } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { Fragment, Suspense, useMemo } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Await,
  Outlet,
  redirect,
  useLoaderData,
  useParams
} from "react-router";
import { CadModel, DeferredFiles } from "~/components";
import type { Tree } from "~/components/TreeView";
import { usePermissions, useRealtime, useRouteData, useUser } from "~/hooks";
import type {
  Quotation,
  QuotationOperation,
  QuotationPrice,
  QuoteLinePriceRow,
  QuoteMethod
} from "~/modules/sales";
import {
  buildMakeToOrderPriceRows,
  buildPullFromInventoryPriceRows,
  buildPurchaseToOrderPriceRows,
  getConfigurationParametersByQuoteLineId,
  getModelByQuoteLineId,
  getOpportunityLineDocuments,
  getQuote,
  getQuoteLine,
  getQuoteLinePrices,
  getQuoteMaterialsByMethodId,
  getQuoteOperationsByLine,
  getQuoteOperationsByMethodId,
  getRelatedPricesForQuoteLine,
  getRootQuoteMakeMethod,
  isQuoteLocked,
  quoteLineValidator,
  reconcileQuantityBreaks
} from "~/modules/sales";
import { saveQuoteLineWithPrices } from "~/modules/sales/sales.server";
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
import { getTagsList, type SupplierPriceMap } from "~/modules/shared";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { requireUnlocked } from "~/utils/lockedGuard.server";
import { path } from "~/utils/path";
import { sanitize } from "~/utils/supabase";

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
  // Still the authorization gate, and load-bearing: the write below goes
  // through Kysely, which bypasses RLS entirely.
  const { companyId, userId } = await requirePermissions(request, {
    create: "sales"
  });

  const { quoteId, lineId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");
  if (!lineId) throw new Error("Could not find lineId");

  const { client: viewClient } = await requirePermissions(request, {
    view: "sales"
  });
  const quote = await getQuote(viewClient, quoteId);
  await requireUnlocked({
    request,
    isLocked: isQuoteLocked(quote.data?.status),
    redirectTo: path.to.quote(quoteId),
    message: "Cannot modify a locked quote. Reopen it first."
  });

  const formData = await request.formData();

  const validation = await validator(quoteLineValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  // The line update and its price reconciliation have to land together. Prices
  // are COMPUTED first (the builders only read), so a pricing failure aborts
  // before anything is written; the three writes then commit in one
  // transaction. Previously the line update committed on its own, and a
  // resolver failure left it saved with its new breaks unpriced.
  const serviceRole = getCarbonServiceRole();
  const existingPrices = await serviceRole
    .from("quoteLinePrice")
    .select("quantity")
    .eq("quoteLineId", lineId);

  if (existingPrices.error) {
    throw redirect(
      path.to.quoteLine(quoteId, lineId),
      await flash(
        request,
        error(existingPrices.error, "Failed to read existing quote line prices")
      )
    );
  }

  // Reconcile in both directions. Seeding is method-specific and only covers
  // the three types below, but PRUNING is unconditional: a break removed from a
  // Make to Stock line — or from a line whose breaks were all cleared — would
  // otherwise leave rows behind that render as selectable options on the
  // customer share page and trip the finalize validation.
  const { added: addedQuantities, removed: removedQuantities } =
    reconcileQuantityBreaks(
      (existingPrices.data ?? []).map((p) => p.quantity),
      d.quantity ?? []
    );

  const methodType = d.methodType;
  const needsSeed =
    methodType === "Make to Order" ||
    methodType === "Pull from Inventory" ||
    methodType === "Purchase to Order";

  let priceRows: QuoteLinePriceRow[] = [];
  if (needsSeed && addedQuantities.length > 0) {
    // The stored line still holds the OLD itemId — the new one is only in the
    // validated form data — so pass it through rather than let the builder read
    // a value this same request is about to change.
    const built =
      methodType === "Make to Order"
        ? await buildMakeToOrderPriceRows(
            serviceRole,
            quoteId,
            lineId,
            addedQuantities,
            userId,
            d.itemId
          )
        : methodType === "Pull from Inventory"
          ? await buildPullFromInventoryPriceRows(
              serviceRole,
              companyId,
              quoteId,
              lineId,
              addedQuantities,
              userId,
              d.itemId
            )
          : await buildPurchaseToOrderPriceRows(
              serviceRole,
              companyId,
              quoteId,
              lineId,
              addedQuantities,
              userId,
              d.itemId
            );

    if (built.error) {
      throw redirect(
        path.to.quoteLine(quoteId, lineId),
        await flash(
          request,
          error(
            built.error,
            `Failed to calculate ${methodType} prices for new quantities`
          )
        )
      );
    }
    priceRows = built.rows;
  }

  try {
    await saveQuoteLineWithPrices({
      lineId,
      line: {
        ...sanitize({ ...d, updatedBy: userId }),
        customFields: setCustomFields(formData)
      },
      removedQuantities,
      priceRows
    });
  } catch (err) {
    // Kysely throws on rollback — nothing was written.
    throw redirect(
      path.to.quoteLine(quoteId, lineId),
      await flash(request, error(err, "Failed to update quote line"))
    );
  }

  throw redirect(path.to.quoteLine(quoteId, lineId));
}

export default function QuoteLine() {
  const { t } = useLingui();
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
    supplierPriceMap: SupplierPriceMap;
  }>(path.to.quote(quoteId));

  const methodTree = useMemo(
    () => quoteData?.methods?.find((m) => m.data.quoteLineId === line.id),
    [quoteData, line.id]
  );

  const getLineCosts = useLineCosts({
    methodTree,
    operations: operations as QuotationOperation[],
    line,
    supplierPriceMap: quoteData?.supplierPriceMap ?? {}
  });

  const initialValues = {
    ...line,
    id: line.id ?? undefined,
    itemType: (line.itemType as "Part") ?? undefined,
    quoteId: line.quoteId ?? "",
    customerPartId: line.customerPartId ?? "",
    customerPartRevision: line.customerPartRevision ?? "",
    description: line.description ?? "",
    estimatorId: line.estimatorId ?? "",
    itemId: line.itemId ?? "",
    methodType: line.methodType ?? "Make to Order",
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
        title={t`Notes`}
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
            itemId={line?.itemId ?? ""}
            // @ts-expect-error
            operations={methodData.methodOperations}
            tags={methodData.tags ?? []}
          />
        </VStack>
      )}

      {line.methodType === "Make to Order" &&
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

      <DeferredFiles resolve={files}>
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
      </DeferredFiles>

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
                modelUpload={model ?? null}
                title={t`CAD Model`}
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
          modelUpload={line ?? null}
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
