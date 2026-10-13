// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { DragEndEvent } from "@dnd-kit/core";
import { DndContext } from "@dnd-kit/core";
import { msg } from "@lingui/core/macro";
import type { FileObject } from "@supabase/storage-js";
import type { PostgrestResponse } from "@supabase/supabase-js";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams, useSubmit } from "react-router";
import { PanelProvider, ResizablePanels } from "~/components/Layout/Panels";
import { getExchangeRate } from "~/modules/accounting";
import { getSupplierPriceBreaksForItems } from "~/modules/items";
import type { SalesOrderLine } from "~/modules/sales";
import {
  getCustomer,
  getOpportunity,
  getOpportunityDocuments,
  getQuote,
  getQuoteLinePricesByQuoteId,
  getQuoteLines,
  getQuoteMethodTrees,
  getQuotePayment,
  getQuoteShipment,
  getSalesOrderLines
} from "~/modules/sales";
import {
  QuoteExplorer,
  QuoteHeader,
  QuoteProperties
} from "~/modules/sales/ui/Quotes";
import { useOptimisticDocumentDrag } from "~/modules/sales/ui/Quotes/QuoteExplorer";
import { getCompanySettings } from "~/modules/settings";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  appBarSubtitle: msg`Quote`,
  realtime: [
    { table: "quote", column: "id", param: "quoteId" },
    { table: "quoteLine", column: "quoteId", param: "quoteId" },
    { table: "quoteLinePrice", column: "quoteId", param: "quoteId" },
    { table: "quoteMaterial", column: "quoteId", param: "quoteId" },
    { table: "quoteOperation", column: "quoteId", param: "quoteId" },
    { table: "quoteMakeMethod", column: "quoteId", param: "quoteId" }
  ],
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Quotes`, to: path.to.quotes },
    (data) => data?.quote?.quoteId
  ),
  module: "sales"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales",
    bypassRls: true
  });

  const { quoteId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");

  // Three steps at most, not five. Everything that needs only the quote id is
  // read with the quote; what needs the quote's or those reads' values follows
  // together; sales order lines wait for the opportunity. `client` is the
  // service role, so nothing read here is returned unless the quote turns out
  // to be this company's.
  const [quote, shipment, payment, lines, prices, methods, companySettings] =
    await Promise.all([
      getQuote(client, quoteId),
      getQuoteShipment(client, quoteId),
      getQuotePayment(client, quoteId),
      getQuoteLines(client, quoteId),
      getQuoteLinePricesByQuoteId(client, quoteId),
      getQuoteMethodTrees(client, quoteId),
      getCompanySettings(client, companyId)
    ]);

  if (quote.error) {
    throw redirect(
      path.to.quotes,
      await flash(request, error(quote.error, "Failed to load quote"))
    );
  }

  if (companyId !== quote.data?.companyId) {
    throw redirect(path.to.quotes);
  }

  // Collect all Buy item IDs from method trees + top-level Buy lines
  const methodTrees = methods.data ?? [];
  const buyItemIds = new Set<string>();
  function collectBuyItems(tree: (typeof methodTrees)[number]) {
    if (tree.data.methodType === "Purchase to Order" && tree.data.itemId) {
      buyItemIds.add(tree.data.itemId);
    }
    tree.children?.forEach(collectBuyItems);
  }
  methodTrees.forEach(collectBuyItems);
  // Also include top-level Buy lines (non-Make lines)
  for (const line of lines.data ?? []) {
    if (line.methodType === "Purchase to Order" && line.itemId) {
      buyItemIds.add(line.itemId);
    }
  }

  const [customer, opportunity, presentationExchangeRate, supplierPriceMap] =
    await Promise.all([
      getCustomer(client, quote.data?.customerId ?? ""),
      getOpportunity(client, quote.data?.opportunityId),
      quote.data?.currencyCode
        ? getExchangeRate(client, companyId, quote.data.currencyCode)
        : null,
      getSupplierPriceBreaksForItems(client, Array.from(buyItemIds))
    ]);

  if (opportunity.error) {
    throw new Error(
      `Failed to get opportunity record for quote ${quoteId} (opportunityId: ${
        quote.data?.opportunityId ?? "null"
      }): ${opportunity.error.message}`
    );
  }

  if (!quote.data?.opportunityId) {
    throw new Error(
      `The quote ${quoteId} has no opportunityId; the opportunity record is missing`
    );
  }

  if (!opportunity.data) {
    throw new Error(
      `No opportunity found with id ${quote.data.opportunityId} referenced by quote ${quoteId}`
    );
  }

  if (shipment.error) {
    throw redirect(
      path.to.quotes,
      await flash(
        request,
        error(shipment.error, "Failed to load quote shipment")
      )
    );
  }

  if (payment.error) {
    throw redirect(
      path.to.quotes,
      await flash(request, error(payment.error, "Failed to load quote payment"))
    );
  }

  // A missing LIVE rate must not make the quote unopenable — this page hosts
  // the refresh button that fixes it. Fall back to the document's own stamped
  // snapshot (the PDF routes' policy); writes still refuse.
  const exchangeRate = !presentationExchangeRate
    ? 1
    : presentationExchangeRate.error || presentationExchangeRate.data === null
      ? (quote.data.exchangeRate ?? 1)
      : presentationExchangeRate.data;

  let salesOrderLines: PostgrestResponse<SalesOrderLine> | null = null;
  if (
    opportunity.data?.salesOrders.length &&
    opportunity.data.salesOrders[0]?.id
  ) {
    salesOrderLines = await getSalesOrderLines(
      client,
      opportunity.data.salesOrders[0]?.id
    );
  }

  const defaultCc =
    // @ts-expect-error TS18048 - TODO: fix type
    customer.data?.defaultCc?.length > 0
      ? // @ts-expect-error TS18047 - TODO: fix type
        customer.data.defaultCc
      : (companySettings.data?.defaultCustomerCc ?? []);

  return {
    quote: quote.data,
    customer: customer.data,
    lines: lines.data ?? [],
    methods: methodTrees,
    files: getOpportunityDocuments(client, companyId, quote.data.opportunityId),
    prices: prices.data ?? [],
    shipment: shipment.data,
    payment: payment.data,
    opportunity: opportunity.data,
    exchangeRate,
    salesOrderLines: salesOrderLines?.data ?? null,
    defaultCc,
    supplierPriceMap
  };
}

export default function QuoteRoute() {
  const params = useParams();
  const { quoteId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");
  const { methods } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const pendingItems = useOptimisticDocumentDrag();

  const handleDrop = (
    document: FileObject & { path: string },
    targetId: string
  ) => {
    if (
      pendingItems.find((item: any) => item.itemId === `pending-${document.id}`)
    )
      return;

    const formData = new FormData();
    const payload = {
      id: document.id,
      name: document.name,
      size: document.metadata?.size || 0,
      path: document.path,
      lineId: targetId.startsWith("quote-line-")
        ? targetId.replace("quote-line-", "")
        : undefined
    };

    formData.append("payload", JSON.stringify(payload));

    submit(formData, {
      method: "post",
      action: path.to.quoteDrag(quoteId),
      navigate: false,
      fetcherKey: `quote-drag:${document.name}`
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { over, active } = event;
    if (over && active.data.current?.type === "opportunityDocument") {
      handleDrop(
        active.data.current as unknown as FileObject & { path: string },
        over.id as string
      );
    }
  };

  return (
    <DndContext onDragEnd={handleDragEnd}>
      <PanelProvider key={quoteId}>
        <div className="flex flex-col h-[calc(100dvh-var(--topbar-height)-var(--content-inset))] overflow-hidden w-full ">
          <QuoteHeader />
          <div className="flex h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] overflow-hidden w-full">
            <div className="flex flex-grow overflow-hidden">
              <ResizablePanels
                explorer={<QuoteExplorer methods={methods} />}
                content={
                  <div className="bg-card h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] overflow-y-auto scrollbar-hide w-full">
                    <VStack spacing={4} className="p-4">
                      <RecordOutlet />
                    </VStack>
                  </div>
                }
                properties={<QuoteProperties key={quoteId} />}
              />
            </div>
          </div>
        </div>
      </PanelProvider>
    </DndContext>
  );
}
