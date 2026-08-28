import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useParams } from "react-router";
import { PanelProvider, ResizablePanels } from "~/components/Layout/Panels";
import {
  getPurchaseReturnOrder,
  getPurchaseReturnOrderLines,
  getPurchaseReturnOrderLineTrackedEntities
} from "~/modules/purchasing";
import {
  PurchaseReturnOrderExplorer,
  PurchaseReturnOrderHeader,
  PurchaseReturnOrderProperties
} from "~/modules/purchasing/ui/PurchaseReturnOrders";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Supplier Returns`, to: path.to.purchaseReturnOrders },
    (data) => data?.purchaseReturnOrder?.purchaseReturnOrderId
  ),
  module: "purchasing"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "purchasing"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [purchaseReturnOrder, lines] = await Promise.all([
    getPurchaseReturnOrder(client, id),
    getPurchaseReturnOrderLines(client, id, companyId)
  ]);

  if (purchaseReturnOrder.error) {
    throw redirect(
      path.to.purchaseReturnOrders,
      await flash(
        request,
        error(purchaseReturnOrder.error, "Failed to load purchase return order")
      )
    );
  }

  if (companyId !== purchaseReturnOrder.data?.companyId) {
    throw redirect(path.to.purchaseReturnOrders);
  }

  const lineIds = (lines.data ?? []).map((line) => line.id);
  const trackedEntities =
    lineIds.length > 0
      ? await getPurchaseReturnOrderLineTrackedEntities(client, lineIds)
      : { data: [], error: null };

  return {
    purchaseReturnOrder: purchaseReturnOrder.data,
    lines: lines.data ?? [],
    trackedEntities: trackedEntities.data ?? []
  };
}

export default function PurchaseReturnOrderRoute() {
  const params = useParams();
  const { id } = params;
  if (!id) throw new Error("Could not find id");

  return (
    <PanelProvider>
      <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
        <PurchaseReturnOrderHeader />
        <div className="flex h-[calc(100dvh-99px)] overflow-hidden w-full">
          <div className="flex flex-grow overflow-hidden">
            <ResizablePanels
              explorer={<PurchaseReturnOrderExplorer />}
              content={
                <div className="h-[calc(100dvh-99px)] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                  <VStack spacing={2} className="p-2">
                    <Outlet />
                  </VStack>
                </div>
              }
              properties={<PurchaseReturnOrderProperties key={id} />}
            />
          </div>
        </div>
      </div>
    </PanelProvider>
  );
}
