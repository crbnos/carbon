import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { ClientOnly, VStack } from "@carbon/react";
import { Outlet, useParams } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { defer, redirect } from "@vercel/remix";
import { PanelProvider, ResizablePanels } from "~/components/Layout/Panels";
import {
  getCustomer,
  getOpportunityBySalesOrder,
  getOpportunityDocuments,
  getQuote,
  getSalesOrder,
  getSalesOrderLines,
} from "~/modules/sales";
import {
  SalesOrderExplorer,
  SalesOrderHeader,
  SalesOrderProperties,
} from "~/modules/sales/ui/SalesOrder";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Orders",
  to: path.to.salesOrders,
  module: "sales",
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales",
    bypassRls: true,
  });

  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  const [salesOrder, lines, opportunity] = await Promise.all([
    getSalesOrder(client, orderId),
    getSalesOrderLines(client, orderId),
    getOpportunityBySalesOrder(client, orderId),
  ]);

  if (companyId !== salesOrder.data?.companyId) {
    throw redirect(path.to.salesOrders);
  }

  if (!opportunity.data) throw new Error("Failed to get opportunity record");

  if (salesOrder.error) {
    throw redirect(
      path.to.items,
      await flash(request, error(salesOrder.error, "Failed to load salesOrder"))
    );
  }

  const [quote, customer] = await Promise.all([
    opportunity.data.quoteId
      ? getQuote(client, opportunity.data.quoteId)
      : Promise.resolve(null),
    salesOrder.data?.customerId
      ? getCustomer(client, salesOrder.data.customerId)
      : Promise.resolve(null),
  ]);

  return defer({
    salesOrder: salesOrder.data,
    lines: lines.data ?? [],
    files: getOpportunityDocuments(client, companyId, opportunity.data.id),
    opportunity: opportunity.data,
    customer: customer?.data ?? null,
    quote: quote?.data ?? null,
    originatedFromQuote: !!opportunity.data.quoteId,
  });
}

export default function SalesOrderRoute() {
  const params = useParams();
  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  return (
    <PanelProvider>
      <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
        <SalesOrderHeader />
        <div className="flex h-[calc(100dvh-99px)] overflow-hidden w-full">
          <div className="flex flex-grow overflow-hidden">
            <ClientOnly fallback={null}>
              {() => (
                <ResizablePanels
                  explorer={<SalesOrderExplorer />}
                  content={
                    <div className="h-[calc(100dvh-99px)] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                      <VStack spacing={2} className="p-2">
                        <Outlet />
                      </VStack>
                    </div>
                  }
                  properties={<SalesOrderProperties />}
                />
              )}
            </ClientOnly>
          </div>
        </div>
      </div>
    </PanelProvider>
  );
}
