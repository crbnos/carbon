import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  ClientOnly,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  ScrollArea,
  VStack,
} from "@carbon/react";
import { Outlet, useLoaderData, useParams } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { defer, redirect } from "@vercel/remix";
import { getCurrencyByCode } from "~/modules/accounting";
import {
  getCustomer,
  getOpportunityByQuote,
  getOpportunityDocuments,
  getQuote,
  getQuoteLinePricesByQuoteId,
  getQuoteLines,
  getQuoteMethodTrees,
  getQuotePayment,
  getQuoteShipment,
  QuoteBreadcrumbs,
  QuoteExplorer,
  QuoteHeader,
} from "~/modules/sales";
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
  });

  const { quoteId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");

  const [quote, shipment, payment, lines, prices, opportunity, methods] =
    await Promise.all([
      getQuote(client, quoteId),
      getQuoteShipment(client, quoteId),
      getQuotePayment(client, quoteId),
      getQuoteLines(client, quoteId),
      getQuoteLinePricesByQuoteId(client, quoteId),
      getOpportunityByQuote(client, quoteId),
      getQuoteMethodTrees(client, quoteId),
    ]);

  if (!opportunity.data) throw new Error("Failed to get opportunity record");

  if (quote.error) {
    throw redirect(
      path.to.quotes,
      await flash(request, error(quote.error, "Failed to load quote"))
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

  const customer = quote.data?.customerId
    ? await getCustomer(client, quote.data.customerId)
    : null;

  return defer({
    quote: quote.data,
    lines: lines.data ?? [],
    methods: methods.data ?? [],
    files: getOpportunityDocuments(client, companyId, opportunity.data.id),
    prices: prices.data ?? [],
    shipment: shipment.data,
    payment: payment.data,
    opportunity: opportunity.data,
    exchangeRate,
    customer: customer?.data ?? null,
  });
}

export default function QuoteRoute() {
  const params = useParams();
  const { quoteId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");
  const { methods } = useLoaderData<typeof loader>();

  return (
    <div className="flex flex-col h-[calc(100vh-49px)] w-full">
      <QuoteHeader />
      <div className="flex h-[calc(100vh-99px)] w-full">
        <div className="flex h-full w-full overflow-y-auto">
          <div className="flex flex-grow overflow-hidden">
            <ClientOnly fallback={null}>
              {() => (
                <ResizablePanelGroup direction="horizontal">
                  <ResizablePanel
                    order={1}
                    minSize={10}
                    defaultSize={20}
                    className="bg-card h-full shadow-lg"
                  >
                    <ScrollArea className="h-[calc(100vh-99px)]">
                      <div className="grid w-full h-full overflow-hidden">
                        <QuoteExplorer methods={methods} />
                      </div>
                    </ScrollArea>
                  </ResizablePanel>
                  <ResizableHandle withHandle />
                  <ResizablePanel order={2}>
                    <ScrollArea className="h-[calc(100vh-99px)]">
                      <VStack spacing={2} className="p-2">
                        <QuoteBreadcrumbs />
                        <Outlet />
                      </VStack>
                    </ScrollArea>
                  </ResizablePanel>
                </ResizablePanelGroup>
              )}
            </ClientOnly>
          </div>
        </div>
      </div>
    </div>
  );
}
