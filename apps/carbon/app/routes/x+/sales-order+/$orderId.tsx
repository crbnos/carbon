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
import { Outlet, useParams } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  getCustomer,
  getOpportunityBySalesOrder,
  getOpportunityDocuments,
  getSalesOrder,
  getSalesOrderLines,
  SalesOrderBreadcrumbs,
  SalesOrderExplorer,
  SalesOrderHeader,
} from "~/modules/sales";
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
  });

  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  const [salesOrder, lines, opportunity] = await Promise.all([
    getSalesOrder(client, orderId),
    getSalesOrderLines(client, orderId),
    getOpportunityBySalesOrder(client, orderId),
  ]);

  if (!opportunity.data) throw new Error("Failed to get opportunity record");
  const files = await getOpportunityDocuments(
    client,
    companyId,
    opportunity.data.id
  );

  if (salesOrder.error) {
    throw redirect(
      path.to.items,
      await flash(request, error(salesOrder.error, "Failed to load salesOrder"))
    );
  }

  const customer = salesOrder.data?.customerId
    ? await getCustomer(client, salesOrder.data.customerId)
    : null;

  return json({
    salesOrder: salesOrder.data,
    lines: lines.data ?? [],
    files: files.data ?? [],
    opportunity: opportunity.data,
    customer: customer?.data ?? null,
  });
}

export default function SalesOrderRoute() {
  const params = useParams();
  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  return (
    <div className="flex flex-col h-[calc(100vh-49px)] w-full">
      <SalesOrderHeader />
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
                        <SalesOrderExplorer />
                      </div>
                    </ScrollArea>
                  </ResizablePanel>
                  <ResizableHandle withHandle />
                  <ResizablePanel order={2}>
                    <ScrollArea className="h-[calc(100vh-99px)]">
                      <VStack spacing={2} className="p-2">
                        <SalesOrderBreadcrumbs />
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
