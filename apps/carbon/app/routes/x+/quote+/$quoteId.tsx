import { error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { ClientOnly, VStack } from "@carbon/react";
import { Outlet, useLoaderData, useParams } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { defer, redirect } from "@vercel/remix";
import { PanelProvider, ResizablePanels } from "~/components/Layout/Panels";
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
  QuoteExplorer,
  QuoteHeader,
  QuoteProperties,
} from "~/modules/sales";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Quotes",
  to: path.to.quotes,
  module: "sales",
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    view: "sales",
  });

  const { quoteId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");
  const serviceRole = await getCarbonServiceRole();

  const [quote, shipment, payment, lines, prices, opportunity, methods] =
    await Promise.all([
      getQuote(serviceRole, quoteId),
      getQuoteShipment(serviceRole, quoteId),
      getQuotePayment(serviceRole, quoteId),
      getQuoteLines(serviceRole, quoteId),
      getQuoteLinePricesByQuoteId(serviceRole, quoteId),
      getOpportunityByQuote(serviceRole, quoteId),
      getQuoteMethodTrees(serviceRole, quoteId),
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
      serviceRole,
      companyId,
      quote.data.currencyCode
    );
    if (presentationCurrency.data?.exchangeRate) {
      exchangeRate = presentationCurrency.data.exchangeRate;
    }
  }

  const customer = quote.data?.customerId
    ? await getCustomer(serviceRole, quote.data.customerId)
    : null;

  return defer({
    quote: quote.data,
    lines: lines.data ?? [],
    methods: methods.data ?? [],
    files: getOpportunityDocuments(serviceRole, companyId, opportunity.data.id),
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
    <PanelProvider>
      <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
        <QuoteHeader />
        <div className="flex h-[calc(100dvh-99px)] overflow-hidden w-full">
          <div className="flex flex-grow overflow-hidden">
            <ClientOnly fallback={null}>
              {() => (
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
              )}
            </ClientOnly>
          </div>
        </div>
      </div>
    </PanelProvider>
  );
}
