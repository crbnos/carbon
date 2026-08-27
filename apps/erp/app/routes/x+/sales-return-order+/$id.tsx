import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useParams } from "react-router";
import { PanelProvider, ResizablePanels } from "~/components/Layout/Panels";
import {
  getSalesReturnOrder,
  getSalesReturnOrderLines,
  getSalesReturnOrderLineTrackedEntities
} from "~/modules/sales";
import {
  SalesReturnOrderExplorer,
  SalesReturnOrderHeader,
  SalesReturnOrderProperties
} from "~/modules/sales/ui/SalesReturnOrders";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`RMAs`, to: path.to.salesReturnOrders },
    (data) => data?.salesReturnOrder?.salesReturnOrderId
  ),
  module: "sales"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [salesReturnOrder, lines] = await Promise.all([
    getSalesReturnOrder(client, id),
    getSalesReturnOrderLines(client, id, companyId)
  ]);

  if (salesReturnOrder.error) {
    throw redirect(
      path.to.salesReturnOrders,
      await flash(
        request,
        error(salesReturnOrder.error, "Failed to load sales return order")
      )
    );
  }

  if (companyId !== salesReturnOrder.data?.companyId) {
    throw redirect(path.to.salesReturnOrders);
  }

  const lineIds = (lines.data ?? []).map((line) => line.id);
  const trackedEntities =
    lineIds.length > 0
      ? await getSalesReturnOrderLineTrackedEntities(client, lineIds)
      : { data: [], error: null };

  return {
    salesReturnOrder: salesReturnOrder.data,
    lines: lines.data ?? [],
    trackedEntities: trackedEntities.data ?? []
  };
}

export default function SalesReturnOrderRoute() {
  const params = useParams();
  const { id } = params;
  if (!id) throw new Error("Could not find id");

  return (
    <PanelProvider>
      <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
        <SalesReturnOrderHeader />
        <div className="flex h-[calc(100dvh-99px)] overflow-hidden w-full">
          <div className="flex flex-grow overflow-hidden">
            <ResizablePanels
              explorer={<SalesReturnOrderExplorer />}
              content={
                <div className="h-[calc(100dvh-99px)] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                  <VStack spacing={2} className="p-2">
                    <Outlet />
                  </VStack>
                </div>
              }
              properties={<SalesReturnOrderProperties key={id} />}
            />
          </div>
        </div>
      </div>
    </PanelProvider>
  );
}
