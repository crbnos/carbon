import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import type { DragEndEvent } from "@dnd-kit/core";
import { DndContext } from "@dnd-kit/core";
import { Outlet, useLoaderData, useParams, useSubmit } from "@remix-run/react";
import type { PostgrestResponse } from "@supabase/supabase-js";
import type { FileObject } from "@supabase/storage-js";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { defer, redirect } from "@vercel/remix";
import { PanelProvider, ResizablePanels } from "~/components/Layout/Panels";
import { getCurrencyByCode } from "~/modules/accounting";
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
  getSalesOrderLines,
} from "~/modules/sales";
import {
  QuoteExplorer,
  QuoteHeader,
  QuoteProperties,
} from "~/modules/sales/ui/Quotes";
import { useOptimisticDocumentDrag } from "~/modules/sales/ui/Quotes/QuoteExplorer";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Quotes",
  to: path.to.quotes,
  module: "sales",
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales",
    bypassRls: true,
  });

  const { quoteId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");

  const quote = await getQuote(client, quoteId);

  if (quote.error) {
    throw redirect(
      path.to.quotes,
      await flash(request, error(quote.error, "Failed to load quote"))
    );
  }

  if (companyId !== quote.data?.companyId) {
    throw redirect(path.to.quotes);
  }

  const [customer, shipment, payment, lines, prices, opportunity, methods] =
    await Promise.all([
      getCustomer(client, quote.data?.customerId ?? ""),
      getQuoteShipment(client, quoteId),
      getQuotePayment(client, quoteId),
      getQuoteLines(client, quoteId),
      getQuoteLinePricesByQuoteId(client, quoteId),
      getOpportunity(client, quote.data?.opportunityId),
      getQuoteMethodTrees(client, quoteId),
      getOpportunityDocuments(
        client,
        companyId,
        quote.data?.opportunityId ?? ""
      ),
    ]);

  if (!opportunity.data) throw new Error("Failed to get opportunity record");

  if (companyId !== quote.data?.companyId) {
    throw redirect(path.to.quotes);
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

  let exchangeRate = 1;
  if (quote.data?.currencyCode) {
    const presentationCurrency = await getCurrencyByCode(
      client,
      companyId,
      quote.data.currencyCode
    );
    if (presentationCurrency.data?.exchangeRate) {
      exchangeRate = presentationCurrency.data.exchangeRate;
    }
  }

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

  return defer({
    quote: quote.data,
    customer: customer.data,
    lines: lines.data ?? [],
    methods: methods.data ?? [],
    files: getOpportunityDocuments(
      client,
      companyId,
      quote.data?.opportunityId ?? ""
    ),
    prices: prices.data ?? [],
    shipment: shipment.data,
    payment: payment.data,
    opportunity: opportunity.data,
    exchangeRate,
    salesOrderLines: salesOrderLines?.data ?? null,
  });
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
        : undefined,
    };

    formData.append("payload", JSON.stringify(payload));

    submit(formData, {
      method: "post",
      action: path.to.quoteDrag(quoteId),
      navigate: false,
      fetcherKey: `quote-drag:${document.name}`,
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
        <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full ">
          <QuoteHeader />
          <div className="flex h-[calc(100dvh-99px)] overflow-hidden w-full">
            <div className="flex flex-grow overflow-hidden">
              <ResizablePanels
                explorer={<QuoteExplorer methods={methods} />}
                content={
                  <div className="h-[calc(100dvh-99px)] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                    <VStack spacing={2} className="p-2">
                      <Outlet />
                    </VStack>
                  </div>
                }
                properties={<QuoteProperties />}
              />
            </div>
          </div>
        </div>
      </PanelProvider>
    </DndContext>
  );
}
