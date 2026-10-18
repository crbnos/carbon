// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { Fragment, Suspense, useMemo } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Await, useLoaderData, useParams } from "react-router";
import { CadModel, DeferredFiles } from "~/components";
import type { Tree } from "~/components/TreeView";
import { usePermissions, useRealtime, useRouteData, useUser } from "~/hooks";
import { quoteLineValidator } from "~/modules/sales/sales.models";
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
  getRootQuoteMakeMethod
} from "~/modules/sales/sales.service";
import type {
  Quotation,
  QuotationOperation,
  QuotationPrice,
  QuoteMethod
} from "~/modules/sales/types";
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
import type { SupplierPriceMap } from "~/modules/shared/shared.models";
import {
  getTagsList,
  requireCompanyRecord
} from "~/modules/shared/shared.service";
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
  // Every read below uses the service role and keys on the URL line id.
  await requireCompanyRecord(serviceRole, "quoteLine", companyId, {
    id: lineId,
    quoteId
  });

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
    line: {
      ...line.data,
      // Present quantity breaks least-to-greatest everywhere they're consumed
      // (line form, costing grid, pricing grid). Preserve null so the `?? [1]`
      // fallbacks downstream still apply. Distinct: a line saved with a
      // repeated break must not render twice (one price row per quantity).
      quantity: line.data.quantity
        ? [...new Set(line.data.quantity)].sort((a, b) => a - b)
        : line.data.quantity
    },
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

export async function action(args: ActionFunctionArgs) {
  const input = await validator(quoteLineValidator).request(args, {
    params: ["quoteId", "lineId"]
  });
  if ("invalid" in input) return input.invalid;
  const { quoteId, lineId } = input.params;
  const formData = input.formData ?? new FormData();
  const api = await carbon(args.request);
  const result = await api.sales.updateQuoteLine({
    ...input.data,
    id: lineId,
    quoteId,
    customFields: setCustomFields(formData),
    acknowledged: formData.get("acknowledged") === "true"
  });
  // An error is toasted; the violation modal reads `violations`.
  if (!result.data) return result;
  if ("violations" in result.data) return result.data;
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
        <VStack spacing={4}>
          <QuoteBillOfProcess
            key={`bop:${methodData.rootMethodId}`}
            quoteMakeMethodId={methodData.rootMethodId}
            itemId={line?.itemId ?? ""}
            // @ts-expect-error
            operations={methodData.methodOperations}
            tags={methodData.tags ?? []}
          />
          <QuoteBillOfMaterial
            key={`bom:${methodData.rootMethodId}`}
            quoteMakeMethodId={methodData.rootMethodId}
            // @ts-expect-error
            materials={methodData.methodMaterials}
            // @ts-expect-error
            operations={methodData.methodOperations}
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

      <RecordOutlet />
    </Fragment>
  );
}
