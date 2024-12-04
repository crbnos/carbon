import { error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Outlet, useParams } from "@remix-run/react";
import type { PostgrestResponse } from "@supabase/supabase-js";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { defer, redirect } from "@vercel/remix";
import { PanelProvider, ResizablePanels } from "~/components/Layout/Panels";
import { getCurrencyByCode } from "~/modules/accounting";
import type { PurchaseOrderLine } from "~/modules/purchasing";
import {
  getPurchaseOrderLines,
  getSupplierInteractionByQuote,
  getSupplierInteractionDocuments,
  getSupplierQuote,
  getSupplierQuoteLinePricesByQuoteId,
  getSupplierQuoteLines,
} from "~/modules/purchasing";
import SupplierQuoteExplorer from "~/modules/purchasing/ui/SupplierQuote/SupplierQuoteExplorer";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Supplier Quotes",
  to: path.to.supplierQuotes,
  module: "purchasing",
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    view: "purchasing",
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");
  const serviceRole = await getCarbonServiceRole();

  const [quote, lines, prices, interaction] = await Promise.all([
    getSupplierQuote(serviceRole, id),
    getSupplierQuoteLines(serviceRole, id),
    getSupplierQuoteLinePricesByQuoteId(serviceRole, id),
    getSupplierInteractionByQuote(serviceRole, id),
  ]);

  if (!interaction.data) throw new Error("Failed to get interaction record");

  if (quote.error) {
    throw redirect(
      path.to.supplierQuotes,
      await flash(request, error(quote.error, "Failed to load quote"))
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

  let purchaseOrderLines: PostgrestResponse<PurchaseOrderLine> | null = null;
  if (interaction.data?.purchaseOrderId) {
    purchaseOrderLines = await getPurchaseOrderLines(
      serviceRole,
      interaction.data.purchaseOrderId
    );
  }

  return defer({
    quote: quote.data,
    lines: lines.data ?? [],
    files: getSupplierInteractionDocuments(
      serviceRole,
      companyId,
      interaction.data.id
    ),
    prices: prices.data ?? [],
    interaction: interaction.data,
    exchangeRate,
    purchaseOrderLines: purchaseOrderLines?.data ?? null,
  });
}

export default function SupplierQuoteRoute() {
  const params = useParams();
  const { id } = params;
  if (!id) throw new Error("Could not find id");

  return (
    <PanelProvider>
      <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
        {/* <SupplierQuoteHeader />
         */}
        <div className="flex h-[calc(100dvh-99px)] overflow-hidden w-full">
          <div className="flex flex-grow overflow-hidden">
            <ResizablePanels
              explorer={<SupplierQuoteExplorer />}
              content={
                <div className="h-[calc(100dvh-99px)] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                  <VStack spacing={2} className="p-2">
                    <Outlet />
                  </VStack>
                </div>
              }
              properties={null}
            />
          </div>
        </div>
      </div>
    </PanelProvider>
  );
}
