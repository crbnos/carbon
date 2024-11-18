import { error, getCarbonServiceRole } from "@carbon/auth";
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
import { defer, redirect } from "@vercel/remix";
import {
  getCustomer,
  getOpportunityBySalesOrder,
  getOpportunityDocuments,
  getSalesOrder,
  getSalesOrderLines,
  SalesOrderExplorer,
  SalesOrderHeader,
  SalesOrderProperties,
} from "~/modules/sales";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Orders",
  to: path.to.salesOrders,
  module: "sales",
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    view: "sales",
  });

  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  const serviceRole = await getCarbonServiceRole();

  const [salesOrder, lines, opportunity] = await Promise.all([
    getSalesOrder(serviceRole, orderId),
    getSalesOrderLines(serviceRole, orderId),
    getOpportunityBySalesOrder(serviceRole, orderId),
  ]);

  if (!opportunity.data) throw new Error("Failed to get opportunity record");

  if (salesOrder.error) {
    throw redirect(
      path.to.items,
      await flash(request, error(salesOrder.error, "Failed to load salesOrder"))
    );
  }

  const customer = salesOrder.data?.customerId
    ? await getCustomer(serviceRole, salesOrder.data.customerId)
    : null;

  return defer({
    salesOrder: salesOrder.data,
    lines: lines.data ?? [],
    files: getOpportunityDocuments(serviceRole, companyId, opportunity.data.id),
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
                    <div className="flex h-[calc(100vh-99px)] w-full">
                      <div className="flex h-full w-full overflow-y-auto">
                        <ScrollArea className="h-[calc(100vh-99px)] w-full">
                          <VStack spacing={2} className="p-2">
                            <Outlet />
                          </VStack>
                        </ScrollArea>
                      </div>
                      <SalesOrderProperties />
                    </div>
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
