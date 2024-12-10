import { error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { ClientOnly, VStack } from "@carbon/react";
import { Outlet, useParams } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { defer, redirect } from "@vercel/remix";
import { PanelProvider, ResizablePanels } from "~/components/Layout/Panels";
import {
  getPurchaseOrder,
  getPurchaseOrderLines,
  getSupplier,
  getSupplierInteractionByPurchaseOrder,
  getSupplierInteractionDocuments,
} from "~/modules/purchasing";
import { PurchaseOrderHeader } from "~/modules/purchasing/ui/PurchaseOrder";
import PurchaseOrderProperties from "~/modules/purchasing/ui/PurchaseOrder/PurchaseOrderProperties";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Orders",
  to: path.to.purchaseOrders,
  module: "purchasing",
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    view: "purchasing",
  });

  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  const serviceRole = await getCarbonServiceRole();

  const [purchaseOrder, lines, interaction] = await Promise.all([
    getPurchaseOrder(serviceRole, orderId),
    getPurchaseOrderLines(serviceRole, orderId),
    getSupplierInteractionByPurchaseOrder(serviceRole, orderId),
  ]);

  if (!interaction.data) throw new Error("Failed to get interaction record");

  if (purchaseOrder.error) {
    throw redirect(
      path.to.items,
      await flash(
        request,
        error(purchaseOrder.error, "Failed to load purchaseOrder")
      )
    );
  }

  const supplier = purchaseOrder.data?.supplierId
    ? await getSupplier(serviceRole, purchaseOrder.data.supplierId)
    : null;

  return defer({
    purchaseOrder: purchaseOrder.data,
    lines: lines.data ?? [],
    files: getSupplierInteractionDocuments(
      serviceRole,
      companyId,
      interaction.data.id
    ),
    interaction: interaction.data,
    supplier: supplier?.data ?? null,
  });
}

export default function PurchaseOrderRoute() {
  const params = useParams();
  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  return (
    <PanelProvider>
      <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
        <PurchaseOrderHeader />
        <div className="flex h-[calc(100dvh-99px)] overflow-hidden w-full">
          <div className="flex flex-grow overflow-hidden">
            <ClientOnly fallback={null}>
              {() => (
                <ResizablePanels
                  explorer={null}
                  content={
                    <div className="h-[calc(100dvh-99px)] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                      <VStack spacing={2} className="p-2">
                        <Outlet />
                      </VStack>
                    </div>
                  }
                  properties={<PurchaseOrderProperties />}
                />
              )}
            </ClientOnly>
          </div>
        </div>
      </div>
    </PanelProvider>
  );
}
